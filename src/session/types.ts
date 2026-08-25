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

export interface Session {
  id: string
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
