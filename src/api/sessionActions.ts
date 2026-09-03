import { randomUUID } from 'node:crypto'
import type { SessionBackend } from '../session/sessionBackend'
import type { Session as AggregateSession, SessionDelta } from '../session/types'
import { SessionTerminatedError, VersionConflictError } from '../session/types'
import type { BridgeEnvelope } from '../bridge/EventLogStore'
import type { SessionQueue } from '../bridge/SessionQueue'
import type { TaskRegistry } from '../tasks/taskRegistry'
import { log } from '../log'
import { ASK_HUMAN_MAX_CONTEXT_LENGTH, ASK_HUMAN_MAX_QUESTION_LENGTH } from 'agenthood/dist/tools/human/AskHumanTool.js'

/**
 * Session ingress actions shared by the HTTP task routes and the WS room
 * channel (Stage 5): the store commit, registry/queue coordination, CAS
 * retry, and SSE fan-out live here exactly once, so POST and WS cannot
 * diverge on guards, caps, or compensation. Transports only adapt results
 * to their wire (HTTP codes vs WS ack frames).
 */
export interface IngressDeps {
  /** Tenant-scoped backend — resolved per request/connection, never the root. */
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  broadcaster: { emit: (envelope: BridgeEnvelope) => void }
}

export type ActionOk = { code: 201; session: AggregateSession }
export type ActionError = { code: 400 | 404 | 409 | 500; error: string }
export type ActionResult = ActionOk | ActionError

const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const

export function isTerminal(status: string): boolean {
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
  deps: IngressDeps,
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

function rejectBlank(content: string): ActionError | null {
  return content.trim().length === 0 ? { code: 400, error: 'content must not be blank' } : null
}

/**
 * Anytime human↔human chat: appends to interaction[] without moving the
 * lifecycle (no awaiting_input gate — allowed in any non-terminal state).
 * Contract: store raw, escape at render — the thread path must never use
 * dangerouslySetInnerHTML (stored XSS would fire for every viewer).
 */
export async function appendChatMessage(
  deps: IngressDeps,
  sessionId: string,
  content: string
): Promise<ActionResult> {
  const blank = rejectBlank(content)
  if (blank) return blank
  const result = await casAppendSessionEvents(deps.broadcaster, {
    backend: deps.backend,
    sessionId,
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
      sessionId,
      correlationId: current.correlationId,
      at,
      message: content,
    }),
  })
  return result
}

export type ReplyResult =
  | { code: 201; session: AggregateSession; followupId: string }
  | ActionError

/**
 * Answer a parked agent question: records `session.user_reply` on the parked
 * original (which stays `awaiting_input`, still cancellable) and spawns the
 * linked follow-up. Single-reply-per-park: the original parks exactly once,
 * so a second reply would fork a second follow-up (double LLM spend, lane
 * flood). Multi-turn Q&A still works — the follow-up can park and ask again.
 */
export async function replyToParked(
  deps: IngressDeps,
  sessionId: string,
  tenantId: string,
  content: string
): Promise<ReplyResult> {
  const blank = rejectBlank(content)
  if (blank) return blank
  const result = await casAppendSessionEvents(deps.broadcaster, {
    backend: deps.backend,
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
  if (result.code !== 201) return result
  const original = result.session
  const resumed = await spawnResumeFollowup(deps, { sessionId, tenantId, original, content })
  if ('error' in resumed) return { code: 500, error: resumed.error }
  log.info('task resumed', { sessionId, followupId: resumed.followupId, member: original.task.member, tenantId })
  return { code: 201, session: original, followupId: resumed.followupId }
}

export type SteerResult =
  | { code: 201; session: AggregateSession; interrupted: boolean }
  | ActionError

/**
 * Human steer / interrupt: queued → the mission is rewritten before the run
 * starts (registry reprompt + CAS session.steer, rollback on CAS failure);
 * running → the new direction is recorded as session.user_reply and the
 * in-flight run is aborted (runSession finalizes CANCELLED, slot freed).
 * awaiting_input takes a reply, not a steer.
 */
export async function steerSession(
  deps: IngressDeps,
  sessionId: string,
  content: string
): Promise<SteerResult> {
  const blank = rejectBlank(content)
  if (blank) return blank
  const current = await deps.backend.get(sessionId)
  if (!current) return { code: 404, error: 'unknown session' }
  if (isTerminal(current.status)) return { code: 409, error: 'session already terminated' }
  if (current.status === 'awaiting_input') {
    return { code: 409, error: 'session awaiting input; reply instead of steering' }
  }
  if (current.status === 'queued') {
    // the pump reads the registry copy at start, so the registry moves
    // first and the store CAS commits second — a CAS failure rolls the
    // registry back rather than diverging execution from history
    const reg = deps.registry.get(sessionId)
    if (!reg || reg.status !== 'queued') return { code: 409, error: 'session already started' }
    const previousPrompt = reg.task.prompt
    try {
      deps.registry.reprompt(sessionId, content)
    } catch {
      return { code: 409, error: 'session already started' }
    }
    const result = await casAppendSessionEvents(deps.broadcaster, {
      backend: deps.backend,
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
      return result
    }
    return { code: 201, session: result.session, interrupted: false }
  }
  if (current.status === 'running') {
    // abort first, record second: firing the controller is synchronous and
    // idempotent, so a run finalizing in the same tick either gets
    // interrupted or fails the abort — never a user_reply on a corpse.
    // The registry is execution truth here; a stale store read must not
    // resurrect anything.
    if (!deps.registry.abort(sessionId)) return { code: 409, error: 'session not running' }
    const result = await casAppendSessionEvents(deps.broadcaster, {
      backend: deps.backend,
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
    if (result.code !== 201) return result
    return { code: 201, session: result.session, interrupted: true }
  }
  return { code: 409, error: 'session cannot be steered from its current state' }
}
