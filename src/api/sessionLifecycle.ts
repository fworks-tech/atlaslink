import { randomUUID } from 'node:crypto'
import type { Session as AggregateSession, SessionEvent } from '../session/types'
import { VersionConflictError } from '../session/types'
import type { IngressDeps, ActionResult } from './sessionActions'
import { isTerminal } from './sessionActions'
import { checkpointIdFor } from '../session/checkpointStore'
import type { ProviderChoice } from '../config'
import { log } from '../log'

export interface CreateSessionArgs {
  member: string
  prompt: string
  tenantId: string
  projectId?: string
  provider?: string
  tweaks?: Record<string, unknown>
}

export interface CreateTweaks {
  provider?: string
  member?: Record<string, unknown>
}

/**
 * Create-edge pick-list checks shared by POST /tasks and task.createTask —
 * a stale provider list must 400 at creation instead of stalling a queued
 * session at run time. Returns the error message, or null when the edge
 * passes.
 */
export function validateCreateEdge(providers: ProviderChoice[], tweaks?: CreateTweaks): string | null {
  if (
    providers.length > 0 &&
    tweaks?.provider !== undefined &&
    (tweaks.provider.length === 0 || !providers.some((p) => p.name === tweaks.provider))
  ) {
    return `unknown provider, choose from ${providers.map((p) => p.name).join(', ')}`
  }
  const model = tweaks?.member?.model
  if (model !== undefined && (typeof model !== 'string' || model.trim().length === 0 || model.length > 200)) {
    return 'tweaks.member.model must be a non-empty string up to 200 chars'
  }
  return null
}

export type CancelResult =
  | { code: 202; status: 'running' | 'cancelled'; cancel?: 'best-effort'; session: AggregateSession }
  | { code: 404 | 409; error: string }

/**
 * Session creation shared by POST /tasks and the graph's createSession:
 * commit `session.created` first, then register + queue by the same ids, so
 * the aggregate exists before any runner can start (spec §3).
 * Edge validation (provider roster, tweak caps) stays with the transport.
 */
export async function createSessionAction(deps: IngressDeps, args: CreateSessionArgs): Promise<ActionResult> {
  if (!args.member.trim()) return { code: 400, error: 'member must not be blank' }
  if (!args.prompt.trim()) return { code: 400, error: 'prompt must not be blank' }
  const sessionId = `ses-${randomUUID()}`
  const correlationId = `cor-${randomUUID()}`
  const event: SessionEvent = {
    type: 'session.created',
    sessionId,
    correlationId,
    at: new Date().toISOString(),
    member: args.member,
    prompt: args.prompt,
    tenantId: args.tenantId,
    ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
    ...(args.tweaks !== undefined ? { tweaks: args.tweaks } : {}),
  }
  await deps.backend.append(event)
  const created = deps.registry.create({
    member: args.member,
    prompt: args.prompt,
    ...(args.provider !== undefined ? { provider: args.provider } : {}),
    id: sessionId,
    correlationId,
  })
  deps.queue.declareSession(created)
  log.info('task created', { sessionId, correlationId, member: args.member, projectId: args.projectId, tenantId: args.tenantId })
  const aggregate = await deps.backend.get(sessionId)
  if (!aggregate) return { code: 500, error: 'session not readable after creation' }
  return { code: 201, session: aggregate }
}

/**
 * Cancel a session: re-read until the state settles (a VersionConflictError
 * means the lifecycle moved between read and write), abort a live run,
 * commit `session.cancelled` otherwise, prune the parked checkpoint, and
 * fan out on SSE. Shared by POST /tasks/:id/cancel and the graph.
 */
export async function cancelSessionAction(
  deps: Pick<IngressDeps, 'backend' | 'registry' | 'broadcaster'>,
  sessionId: string
): Promise<CancelResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await deps.backend.get(sessionId)
    if (!current) return { code: 404, error: 'unknown session' }
    if (isTerminal(current.status)) return { code: 409, error: 'session already terminated' }
    if (current.status === 'running') {
      try {
        deps.registry.abort(sessionId)
      } catch {
        // no live run tracked — the ack still holds; a concurrent finalize owns the outcome
      }
      return { code: 202, status: 'running', cancel: 'best-effort', session: current }
    }
    try {
      await deps.backend.readModifyWrite(sessionId, current.version, () => [
        { type: 'session.cancelled', correlationId: current.correlationId, at: new Date().toISOString() },
      ])
      try {
        deps.registry.cancel(sessionId)
      } catch {
        // registry entry may be gone — the store commit is the truth
      }
      const after = await deps.backend.get(sessionId)
      if (!after) return { code: 404, error: 'unknown session' }
      try {
        await deps.backend.deleteCheckpoint(checkpointIdFor(current.correlationId))
      } catch {
        // prune is hygiene; the store commit above is the truth
      }
      try {
        deps.broadcaster.emit({
          eventId: after.version,
          type: 'session.cancelled',
          sessionId,
          correlationId: current.correlationId,
          at: new Date().toISOString(),
        })
      } catch {
        // best-effort; store is truth
      }
      return { code: 202, status: 'cancelled', session: after }
    } catch (err) {
      if (err instanceof VersionConflictError) continue
      throw err
    }
  }
  return { code: 409, error: 'session state changed' }
}
