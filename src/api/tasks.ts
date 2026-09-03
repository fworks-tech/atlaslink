import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { SessionBackend, SessionFilter } from '../session/sessionBackend'
import type { Session as AggregateSession, SessionDelta, SessionEvent } from '../session/types'
import { SessionTerminatedError, VersionConflictError } from '../session/types'
import type { BridgeEnvelope } from '../bridge/EventLogStore'
import type { SessionQueue } from '../bridge/SessionQueue'
import type { SseHandler } from '../bridge/sseEndpoint'
import type { TaskRegistry } from '../tasks/taskRegistry'
import { tenantBackendForRequest } from './tenant'
import { log } from '../log'
import { ASK_HUMAN_MAX_CONTEXT_LENGTH, ASK_HUMAN_MAX_QUESTION_LENGTH } from 'agenthood/dist/tools/human/AskHumanTool.js'

export interface TaskDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
}

const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const

function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

interface CasAppendOptions {
  backend: SessionBackend
  sessionId: string
  /** Fast reject on the pre-read aggregate; return an error message or null to proceed. */
  guard: (current: AggregateSession) => string | null
  /** Events to append; the terminal check is re-enforced inside the write. */
  deltas: (current: AggregateSession, at: string) => SessionDelta[]
  /** SSE envelope fanned out after commit. */
  sseEvent: (current: AggregateSession, at: string, version: number) => BridgeEnvelope
}

type CasAppendResult = { code: 201; session: AggregateSession } | { code: 404 | 409; error: string }

/**
 * Shared CAS-append loop for the reply/message-style routes: pre-read guard,
 * 2-attempt readModifyWrite with VersionConflictError retry, write-time
 * terminal re-check (a cancel/finish landing between read and commit still
 * rejects instead of polluting a closed session), best-effort SSE fan-out,
 * and 201/404/409 mapping. The store is truth; SSE is projection.
 */
async function casAppendSessionEvents(
  broadcaster: { emit: (envelope: BridgeEnvelope) => void },
  opts: CasAppendOptions
): Promise<CasAppendResult> {
  const { backend, sessionId, guard, deltas, sseEvent } = opts
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await backend.get(sessionId)
    if (!current) return { code: 404, error: 'unknown session' }
    const rejection = guard(current)
    if (rejection) return { code: 409, error: rejection }
    const at = new Date().toISOString()
    try {
      await backend.readModifyWrite(sessionId, current.version, (writeTime) => {
        if (writeTime && isTerminal(writeTime.status)) throw new SessionTerminatedError(sessionId)
        return deltas(writeTime ?? current, at)
      })
    } catch (err) {
      if (err instanceof VersionConflictError) continue
      if (err instanceof SessionTerminatedError) return { code: 409, error: 'session already terminated' }
      throw err
    }
    const after = await backend.get(sessionId)
    if (!after) return { code: 404, error: 'unknown session' }
    try {
      broadcaster.emit(sseEvent(current, at, after.version))
    } catch {
      // best-effort; store is truth
    }
    return { code: 201, session: after }
  }
  return { code: 409, error: 'session state changed' }
}

/** Caps: the fold lands in a fresh model prompt, so one park cannot blow past context on resume. */
export const MAX_FOLD_QUESTION = ASK_HUMAN_MAX_QUESTION_LENGTH
export const MAX_FOLD_CONTEXT = ASK_HUMAN_MAX_CONTEXT_LENGTH
export const MAX_FOLD_REPLY = 4000
/** Anytime chat is unbounded by lifecycle, so the log itself carries the bound. */
export const MAX_SESSION_MESSAGES = 500

function truncateFold(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text
}

/**
 * Follow-up prompt: the original prompt plus the answered Q&A. Delimited so
 * the model cannot mistake human text for instructions; capped so a hostile
 * or verbose reply cannot smuggle an unbounded prompt into the resumed run;
 * the closing tag is neutralized in both halves so a crafted reply cannot
 * break out of the delimiter and inject instructions after it.
 */
export function foldReplyPrompt(originalPrompt: string, question: string, context: string | undefined, reply: string): string {
  const q = truncateFold(question, MAX_FOLD_QUESTION)
    .replace(/"/g, "'")
    .replace(/[<>\r\n]+/g, ' ')
    .replace(/<\/human_reply/gi, '</ human_reply')
    .trim()
  const c = (context === undefined ? '' : truncateFold(context, MAX_FOLD_CONTEXT))
    .replace(/"/g, "'")
    .replace(/[<>\r\n]+/g, ' ')
    .replace(/<\/human_reply/gi, '</ human_reply')
    .trim()
  const a = truncateFold(reply, MAX_FOLD_REPLY).replace(/<\/human_reply/gi, '</ human_reply')
  return `${originalPrompt}\n\n<human_reply${q ? ` question="${q}"` : ''}${c ? ` context="${c}"` : ''}>\n${a}\n</human_reply>`
}

interface PostBody {
  member: string
  prompt: string
  projectId?: string
  tweaks?: { provider?: string; member?: Record<string, unknown>; team?: Record<string, unknown> }
}

/**
 * Linked follow-up for a replied-to park: the original prompt plus the Q&A
 * folded in, so the new run sees the answer without sharing the parked run's
 * scratchpad. Committed to the store first, then created + enqueued to the
 * interactive lane (a human is waiting on this answer). The provider override
 * rides along — a pinned provider must not silently revert on resume;
 * member/team tweaks persist on the store entry but the registry runner takes
 * only provider today, same as the create route (pre-existing gap, not
 * something resume may diverge on). A declare failure after the store commit
 * cancels the follow-up instead of orphaning it queued-forever.
 */
async function spawnResumeFollowup(
  deps: Pick<TaskDeps, 'registry' | 'queue'> & { backend: SessionBackend },
  args: { sessionId: string; tenantId: string; original: AggregateSession; content: string }
): Promise<{ followupId: string } | { error: string }> {
  const { sessionId, tenantId, original, content } = args
  const followupId = `ses-${randomUUID()}`
  const followupCorrelationId = `cor-${randomUUID()}`
  const at = new Date().toISOString()
  const prompt = foldReplyPrompt(original.task.prompt, original.question?.question ?? '', original.question?.context, content)
  const resumeProvider = typeof original.tweaks?.provider === 'string' ? original.tweaks.provider : undefined
  await deps.backend.append({
    type: 'session.created',
    sessionId: followupId,
    correlationId: followupCorrelationId,
    at,
    member: original.task.member,
    prompt,
    tenantId,
    ...(original.projectId !== undefined ? { projectId: original.projectId } : {}),
    ...(original.tweaks !== undefined ? { tweaks: original.tweaks } : {}),
    resumeOf: sessionId,
  })
  try {
    const created = deps.registry.create({
      member: original.task.member,
      prompt,
      ...(resumeProvider !== undefined ? { provider: resumeProvider } : {}),
      id: followupId,
      correlationId: followupCorrelationId,
    })
    deps.queue.declareSession(created, { lane: 'interactive' })
  } catch (err) {
    try {
      deps.registry.cancel(followupId)
    } catch {
      // registry entry missing — nothing to withdraw
    }
    try {
      await deps.backend.append({
        type: 'session.cancelled',
        sessionId: followupId,
        correlationId: followupCorrelationId,
        at: new Date().toISOString(),
      })
    } catch {
      // store truth stays queued; it surfaces in listing but never runs
    }
    log.error('task resume failed after commit; follow-up cancelled', {
      sessionId,
      followupId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { error: 'resume failed after commit; follow-up cancelled' }
  }
  return { followupId }
}

/** Wire form of the store aggregate — same shape the spec §3 defines. */
export function sessionToWire(s: AggregateSession): AggregateSession {
  return s
}

/**
 * The M3 Task API on Fastify (spec §3): create + enqueue, list with
 * backend-applied filters, aggregate read, and queued-cancel. The pre-auth
 * bearer gate and rate limit are installed once in `createAppServer` on the
 * scope that owns /runs, /events, and these routes (spec §7) — this module
 * stays a declarative route list.
 */
export function registerTaskRoutes(app: FastifyInstance, deps: TaskDeps): void {
  app.post<{ Body: PostBody }>(
    '/tasks',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['member', 'prompt'],
          properties: {
            member: { type: 'string', minLength: 1 },
            prompt: { type: 'string', minLength: 1, maxLength: 10000 },
            projectId: { type: 'string', maxLength: 200 },
            tweaks: {
              type: 'object',
              additionalProperties: false,
              properties: {
                provider: { type: 'string' },
                member: { type: 'object' },
                team: { type: 'object' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const tenantId = tenantCtx.tenantId!
      const backend = tenantCtx.backend
      const { member, prompt, projectId, tweaks } = request.body
      const sessionId = `ses-${randomUUID()}`
      const correlationId = `cor-${randomUUID()}`
      const event: SessionEvent = {
        type: 'session.created',
        sessionId,
        correlationId,
        at: new Date().toISOString(),
        member,
        prompt,
        tenantId,
        ...(projectId !== undefined ? { projectId } : {}),
        ...(tweaks !== undefined ? { tweaks } : {}),
      }
      // the aggregate is committed first; the queue then runs by the same ids
      await backend.append(event)
      const created = deps.registry.create({
        member,
        prompt,
        provider: tweaks?.provider,
        id: sessionId,
        correlationId,
      })
      deps.queue.declareSession(created)
      log.info('task created', { sessionId, correlationId, member, projectId, tenantId })
      const aggregate = await backend.get(sessionId)
      return reply.code(201).send({ ok: true, session: sessionToWire(aggregate!) })
    }
  )

  app.get<{ Querystring: { projectId?: string; status?: string; since?: string; limit?: number; offset?: number } }>(
    '/tasks',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string' },
            status: { type: 'string', enum: ['queued', 'running', 'awaiting_input', 'succeeded', 'failed', 'cancelled'] },
            since: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
            offset: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const tenantId = tenantCtx.tenantId!
      const backend = tenantCtx.backend
      const query = request.query
      if (query.since !== undefined && Number.isNaN(Date.parse(query.since))) {
        return reply.code(400).send({ ok: false, error: 'since must be an ISO-8601 date-time' })
      }
      const filter: SessionFilter = {
        projectId: query.projectId ?? undefined,
        tenantId,
        status: (query.status as SessionFilter['status']) ?? undefined,
        since: query.since ?? undefined,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      }
      const { sessions, total } = await backend.list(filter)
      return reply.send({
        ok: true,
        sessions: sessions.map(sessionToWire),
        total,
        limit: filter.limit,
        offset: filter.offset,
      })
    }
  )

  app.get<{ Params: { sessionId: string } }>('/tasks/:sessionId', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const aggregate = await tenantCtx.backend.get(request.params.sessionId)
    if (!aggregate) return reply.code(404).send({ ok: false, error: 'unknown session' })
    return reply.send({ ok: true, session: sessionToWire(aggregate) })
  })

  app.post<{ Params: { sessionId: string } }>('/tasks/:sessionId/cancel', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const backend = tenantCtx.backend
    const sessionId = request.params.sessionId

    // Re-evaluate against a fresh aggregate until the state is stable: a
    // VersionConflictError means the lifecycle moved between our read and
    // write (the queue started the run) — resolve rather than 500.
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await backend.get(sessionId)
      if (!current) return reply.code(404).send({ ok: false, error: 'unknown session' })
      if (isTerminal(current.status)) {
        return reply.code(409).send({ ok: false, error: 'session already terminated' })
      }
      if (current.status === 'running') {
        // M3 best-effort contract (spec §3): acknowledge now, cancel lands with the runtime.
        // M5: the abort is real — runSession races the in-flight call against
        // the session controller and finalizes CANCELLED + mirrors it, so the
        // 202 only means "finalization is async", not "maybe".
        try {
          deps.registry.abort(sessionId)
        } catch {
          // no live run tracked — the ack below still holds; a concurrent
          // finalize owns the outcome
        }
        return reply.code(202).send({ ok: true, status: 'running', cancel: 'best-effort', session: sessionToWire(current) })
      }
      try {
        await backend.readModifyWrite(sessionId, current.version, () => [
          { type: 'session.cancelled', correlationId: current.correlationId, at: new Date().toISOString() },
        ])
        // dequeue from execution so the pump never runs a cancelled session
        try {
          deps.registry.cancel(sessionId)
        } catch {
          // the registry entry may already be gone or terminal — the store commit is the truth
        }
        const after = await backend.get(sessionId)
        if (!after) return reply.code(404).send({ ok: false, error: 'unknown session' })
        // the store commit is truth, but live subscribers (dashboard thread,
        // queue watchers) only move on SSE — fan out like every other route
        try {
          deps.sse.broadcaster.emit({
            eventId: after.version,
            type: 'session.cancelled',
            sessionId,
            correlationId: current.correlationId,
            at: new Date().toISOString(),
          })
        } catch {
          // best-effort; store is truth
        }
        return reply.code(202).send({ ok: true, status: 'cancelled', session: sessionToWire(after) })
      } catch (err) {
        if (err instanceof VersionConflictError) continue
        throw err
      }
    }
    return reply.code(409).send({ ok: false, error: 'session state changed' })
  })

  // Full DAG: Atlas asks follow-up in the latest card → user replies → diagram grows
  app.post<{ Params: { sessionId: string }; Body: { content: string } }>(
    '/tasks/:sessionId/reply',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const backend = tenantCtx.backend
      const tenantId = tenantCtx.tenantId!
      const sessionId = request.params.sessionId
      const content = request.body.content
      if (content.trim().length === 0) {
        return reply.code(400).send({ ok: false, error: 'content must not be blank' })
      }
      // the reply is recorded on the parked original, which stays
      // awaiting_input (still cancellable) — resume spawns a linked follow-up.
      // Single-reply-per-park: the original parks exactly once, so a second
      // reply would fork a second follow-up (double LLM spend, lane flood).
      // Multi-turn Q&A still works — the follow-up can park and ask again.
      const result = await casAppendSessionEvents(deps.sse.broadcaster, {
        backend,
        sessionId,
        guard: (current) => {
          if (current.status !== 'awaiting_input') {
            return isTerminal(current.status) ? 'session already terminated' : 'session not awaiting input'
          }
          if (current.replyCount > 0) return 'session already answered'
          return null
        },
        deltas: (current, at) => [
          { type: 'session.user_reply', correlationId: current.correlationId, at, reply: content },
        ],
        sseEvent: (current, at, version) => ({
          eventId: version,
          type: 'session.user_reply',
          sessionId,
          correlationId: current.correlationId,
          at,
          reply: content,
        }),
      })
      if (result.code !== 201) return reply.code(result.code).send({ ok: false, error: result.error })
      const original = result.session
      const resumed = await spawnResumeFollowup(deps, {
        sessionId,
        tenantId,
        original,
        content,
      })
      if ('error' in resumed) {
        return reply.code(500).send({ ok: false, error: resumed.error })
      }
      log.info('task resumed', { sessionId, followupId: resumed.followupId, member: original.task.member, tenantId })
      const followup = await backend.get(resumed.followupId)
      if (!followup) return reply.code(404).send({ ok: false, error: 'unknown session' })
      return reply.code(201).send({ ok: true, session: sessionToWire(original), resumedSession: sessionToWire(followup) })
    }
  )

  // Human steer / interrupt: queued → the mission is rewritten before the run
  // starts (registry reprompt + CAS session.steer, rollback on CAS failure);
  // running → the new direction is recorded as session.user_reply and the
  // in-flight run is aborted (runSession finalizes CANCELLED, slot freed).
  // awaiting_input takes a reply, not a steer — 409 points there.
  app.post<{ Params: { sessionId: string }; Body: { content: string } }>(
    '/tasks/:sessionId/steer',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const backend = tenantCtx.backend
      const sessionId = request.params.sessionId
      const content = request.body.content
      if (content.trim().length === 0) {
        return reply.code(400).send({ ok: false, error: 'content must not be blank' })
      }
      const current = await backend.get(sessionId)
      if (!current) return reply.code(404).send({ ok: false, error: 'unknown session' })
      if (isTerminal(current.status)) {
        return reply.code(409).send({ ok: false, error: 'session already terminated' })
      }
      if (current.status === 'awaiting_input') {
        return reply.code(409).send({ ok: false, error: 'session awaiting input; reply instead of steering' })
      }
      if (current.status === 'queued') {
        // the pump reads the registry copy at start, so the registry moves
        // first and the store CAS commits second — a CAS failure rolls the
        // registry back rather than diverging execution from history
        const reg = deps.registry.get(sessionId)
        if (!reg || reg.status !== 'queued') {
          return reply.code(409).send({ ok: false, error: 'session already started' })
        }
        const previousPrompt = reg.task.prompt
        try {
          deps.registry.reprompt(sessionId, content)
        } catch {
          return reply.code(409).send({ ok: false, error: 'session already started' })
        }
        const result = await casAppendSessionEvents(deps.sse.broadcaster, {
          backend,
          sessionId,
          guard: (fresh) => {
            if (isTerminal(fresh.status)) return 'session already terminated'
            if (fresh.status !== 'queued') return 'session already started'
            return null
          },
          deltas: (fresh, at) => [
            { type: 'session.steer', correlationId: fresh.correlationId, at, message: content },
          ],
          sseEvent: (fresh, at, version) => ({
            eventId: version,
            type: 'session.steer',
            sessionId,
            correlationId: fresh.correlationId,
            at,
            message: content,
          }),
        })
        if (result.code !== 201) {
          try {
            deps.registry.reprompt(sessionId, previousPrompt)
          } catch {
            // still queued with the new prompt while history shows the old —
            // surfaces on the next read; the run itself is unaffected
          }
          return reply.code(result.code).send({ ok: false, error: result.error })
        }
        return reply.code(201).send({ ok: true, session: sessionToWire(result.session) })
      }
      if (current.status === 'running') {
        // abort first, record second: firing the controller is synchronous and
        // idempotent, so a run finalizing in the same tick either gets
        // interrupted or fails the abort — never a user_reply on a corpse.
        // The registry is execution truth here; a stale store read must not
        // resurrect anything.
        if (!deps.registry.abort(sessionId)) {
          return reply.code(409).send({ ok: false, error: 'session not running' })
        }
        const result = await casAppendSessionEvents(deps.sse.broadcaster, {
          backend,
          sessionId,
          guard: (fresh) => {
            if (isTerminal(fresh.status)) return 'session already terminated'
            if (fresh.status !== 'running') return 'session not running'
            return null
          },
          deltas: (fresh, at) => [
            { type: 'session.user_reply', correlationId: fresh.correlationId, at, reply: content },
          ],
          sseEvent: (fresh, at, version) => ({
            eventId: version,
            type: 'session.user_reply',
            sessionId,
            correlationId: fresh.correlationId,
            at,
            reply: content,
          }),
        })
        // the abort already fired even on CAS failure — the run still
        // finalizes CANCELLED; only the new direction failed to record
        if (result.code !== 201) return reply.code(result.code).send({ ok: false, error: result.error })
        return reply.code(201).send({ ok: true, session: sessionToWire(result.session), interrupted: true })
      }
      return reply.code(409).send({ ok: false, error: 'session cannot be steered from its current state' })
    }
  )

  // Anytime human↔human chat: appends to interaction[] without moving the
  // lifecycle (no awaiting_input gate — allowed in any non-terminal state).
  // Contract: store raw, escape at render — the thread path must never use
  // dangerouslySetInnerHTML (stored XSS would fire for every viewer).
  app.post<{ Params: { sessionId: string }; Body: { content: string } }>(
    '/tasks/:sessionId/message',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const { content } = request.body
      if (content.trim().length === 0) {
        return reply.code(400).send({ ok: false, error: 'content must not be blank' })
      }
      const result = await casAppendSessionEvents(deps.sse.broadcaster, {
        backend: tenantCtx.backend,
        sessionId: request.params.sessionId,
        guard: (current) => {
          if (isTerminal(current.status)) return 'session already terminated'
          if (current.interaction.length >= MAX_SESSION_MESSAGES) return 'message log full'
          return null
        },
        deltas: (current, at) => [
          { type: 'session.message', correlationId: current.correlationId, at, message: content },
        ],
        sseEvent: (current, at, version) => ({
          eventId: version,
          type: 'session.message',
          sessionId: request.params.sessionId,
          correlationId: current.correlationId,
          at,
          message: content,
        }),
      })
      if (result.code !== 201) return reply.code(result.code).send({ ok: false, error: result.error })
      return reply.code(201).send({ ok: true, session: sessionToWire(result.session) })
    }
  )

  // Persist editor drag positions (ephemeral) — diagram is a projection, but user wins position
  app.post<{ Params: { sessionId: string }; Body: { diagram: { nodes: { id: string; type: string; position: { x: number; y: number } }[]; edges: { id: string; source: string; target: string }[]; mode: string } } }>(
    '/tasks/:sessionId/diagram',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['diagram'],
          properties: {
            diagram: {
              type: 'object',
              additionalProperties: false,
              required: ['nodes', 'edges', 'mode'],
              properties: {
                nodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
                edges: { type: 'array', items: { type: 'object', additionalProperties: true } },
                mode: { type: 'string', enum: ['chain', 'fanout', 'full'] },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const backend = tenantCtx.backend
      const sessionId = request.params.sessionId
      const { diagram } = request.body
      const current = await backend.get(sessionId)
      if (!current) return reply.code(404).send({ ok: false, error: 'unknown session' })
      // ephemeral: frontend localStorage is truth for drag positions; backend echoes for now
      // until diagram persistence migrates to event-sourced overlay (not swallowing success as durable)
      return reply.send({ ok: true, diagram, persisted: false })
    }
  )

  // Per-session SSE (spec §3/§4): replay-then-live for one session's events,
  // filtered by correlationId over the global bridge projection.
  app.get<{ Params: { sessionId: string } }>('/events/:sessionId', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const aggregate = await tenantCtx.backend.get(request.params.sessionId)
    if (!aggregate) return reply.code(404).send({ ok: false, error: 'unknown session' })
    reply.hijack()
    deps.sse.handleForSession(request.raw, reply.raw, aggregate.correlationId)
  })

  // Per-project SSE: replay-then-live for all sessions belonging to a project,
  // filtered by the set of correlation IDs for that project's sessions. The live
  // set grows on `session.created` for the same project so the stream is live.
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/events', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const backend = tenantCtx.backend
    const tenantId = tenantCtx.tenantId!
    const project = await backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    const { sessions } = await backend.list({ projectId: request.params.projectId, tenantId, limit: 500, offset: 0 })
    const correlationIds = new Set(sessions.map((s) => s.correlationId))
    reply.hijack()
    deps.sse.handleForProject(request.raw, reply.raw, request.params.projectId, correlationIds)
  })
}