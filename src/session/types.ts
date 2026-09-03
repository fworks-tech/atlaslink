export type SessionStatus = 'queued' | 'running' | 'awaiting_input' | 'succeeded' | 'failed' | 'cancelled'

/** fx-style question payload (ADR-007): what the agent asked the human. */
export interface AskHumanQuestionItem {
  label: string
  description?: string
  options?: string[]
}

export interface AskHumanQuestion {
  questions: AskHumanQuestionItem[]
}

/** First question label — the human-readable summary kept in nextStep/interaction. */
export function firstQuestionLabel(question: AskHumanQuestion | undefined): string | undefined {
  return question?.questions[0]?.label
}

export interface SessionEvent {
  type:
    | 'session.created'
    | 'session.running'
    | 'session.succeeded'
    | 'session.failed'
    | 'session.cancelled'
    | 'session.awaiting_input'
    | 'session.user_reply'
    | 'session.message'
    | 'session.steer'
  sessionId: string
  correlationId: string
  at: string
  projectId?: string
  tenantId?: string
  member?: string
  prompt?: string
  tweaks?: Record<string, unknown>
  output?: string
  error?: string
  durationMs?: number
  // awaiting_input / user_reply
  question?: AskHumanQuestion
  reply?: string
  // session.message / session.steer human-authored text
  message?: string
  iteration?: number
  // session.created on a reply-resumed follow-up: the parked session it continues
  resumeOf?: string
}

/** What a readModifyWrite mutator may produce: a session event with the identity left to the store. */
export type SessionDelta = Omit<SessionEvent, 'sessionId'>

export interface Session {
  sessionId: string
  correlationId: string
  status: SessionStatus
  version: number
  createdAt?: string
  startedAt?: string
  finishedAt?: string
  projectId?: string
  tenantId?: string
  task: { member: string; prompt: string }
  tweaks?: Record<string, unknown>
  output?: string
  error?: string
  durationMs?: number
  // conversational + next-step projection (M4)
  interaction: { role: 'user' | 'atlas' | 'member'; member?: string; at: string; content: string }[]
  nextStep: { awaiting_input: boolean; prompt?: string; member?: string } | null
  // full fx question payload behind nextStep.prompt (first label); set on awaiting_input
  question?: AskHumanQuestion
  // parked session this follow-up continues (linked-session resume)
  resumeOf?: string
  // user_reply events recorded on this session; nonzero means already answered
  replyCount: number
  diagram: { nodes: { id: string; type: string; position: { x: number; y: number } }[]; edges: { id: string; source: string; target: string }[]; mode: string } | null
}

export interface Project {
  id: string
  name: string
  createdAt: string
  tenantId?: string
}

export class VersionConflictError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly expected: number,
    public readonly actual: number
  ) {
    super(`version conflict for ${sessionId}: expected ${expected}, actual ${actual}`)
    this.name = 'VersionConflictError'
  }
}

/** Thrown by a readModifyWrite mutator when the write-time aggregate is
 * terminal — lets routes reject late writes that raced a cancel/finish. */
export class SessionTerminatedError extends Error {
  constructor(public readonly sessionId: string) {
    super(`session already terminated: ${sessionId}`)
    this.name = 'SessionTerminatedError'
  }
}

/** Per-session snapshot cache entry shared by all SessionBackend implementations. */
export interface SessionSnapshot {
  session: Session
  /** Number of store events for the session — the version/CAS token used by `rehydrate`. */
  version: number
}

export class StreamIntegrityError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly eventSessionId: string,
    public readonly eventCorrelationId: string
  ) {
    super(
      `stream integrity violation for ${sessionId}: event carries sessionId=${eventSessionId}, correlationId=${eventCorrelationId}`
    )
    this.name = 'StreamIntegrityError'
  }
}