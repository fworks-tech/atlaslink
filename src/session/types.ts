export type SessionStatus = 'queued' | 'running' | 'awaiting_input' | 'succeeded' | 'failed' | 'cancelled'

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
  question?: string
  reply?: string
  // session.message / session.steer human-authored text
  message?: string
  iteration?: number
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