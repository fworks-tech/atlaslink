export type SessionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface SessionEvent {
  type:
    | 'session.created'
    | 'session.running'
    | 'session.succeeded'
    | 'session.failed'
    | 'session.cancelled'
  sessionId: string
  correlationId: string
  at: string
  member?: string
  prompt?: string
  tweaks?: Record<string, unknown>
  output?: string
  error?: string
  durationMs?: number
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
  task: { member: string; prompt: string }
  tweaks?: Record<string, unknown>
  output?: string
  error?: string
  durationMs?: number
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