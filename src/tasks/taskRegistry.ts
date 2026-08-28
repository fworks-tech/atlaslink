import { randomUUID } from 'node:crypto'

/** Session states per ADR-003: a session is one user-initiated task run. */
export const SessionStatus = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const)

export type SessionStatusType = (typeof SessionStatus)[keyof typeof SessionStatus]

export function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * In-memory task/session store (persisted in M3). A session always carries a
 * dedicated correlationId that is stamped onto the run's ExecutionContext so
 * events, traces, decisions, and provenance can be joined by it.
 */
export class TaskRegistry {
  #sessions = new Map<string, Session>()

  static #assert(status: SessionStatusType, step: string): void {
    if (status !== SessionStatus.QUEUED) {
      throw new Error(`cannot ${step} session in status "${status}"`)
    }
  }

  create(params: {
    member: string
    prompt: string
    provider?: string
    id?: string
    correlationId?: string
  }): Session {
    if (!params.member || typeof params.member !== 'string') {
      throw new Error('member is required')
    }
    if (!params.prompt || typeof params.prompt !== 'string') {
      throw new Error('prompt is required')
    }
    const session: Session = {
      id: params.id ?? `ses-${randomUUID()}`,
      correlationId: params.correlationId ?? `cor-${randomUUID()}`,
      status: SessionStatus.QUEUED,
      task: { member: params.member, prompt: params.prompt, ...(params.provider ? { provider: params.provider } : {}) },
      createdAt: new Date().toISOString(),
      startedAt: undefined,
      finishedAt: undefined,
      output: undefined,
      error: undefined,
      durationMs: undefined,
    }
    this.#sessions.set(session.id, session)
    return session
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id)
  }

  has(id: string): boolean {
    return this.#sessions.has(id)
  }

  list(): Session[] {
    return [...this.#sessions.values()]
  }

  start(id: string): Session {
    const session = this.#sessions.get(id)
    if (!session) throw new Error(`unknown session "${id}"`)
    TaskRegistry.#assert(session.status, 'start')
    session.status = SessionStatus.RUNNING
    session.startedAt = new Date().toISOString()
    return session
  }

  succeed(id: string, { output, durationMs }: { output: string; durationMs?: number }): Session {
    const session = this.#sessions.get(id)
    if (!session) throw new Error(`unknown session "${id}"`)
    if (session.status !== SessionStatus.RUNNING) {
      throw new Error(`cannot succeed session in status "${session.status}"`)
    }
    session.status = SessionStatus.SUCCEEDED
    session.output = output
    session.durationMs = durationMs
    session.finishedAt = new Date().toISOString()
    return session
  }

  fail(id: string, { error, durationMs }: { error: string; durationMs?: number }): Session {
    const session = this.#sessions.get(id)
    if (!session) throw new Error(`unknown session "${id}"`)
    if (session.status !== SessionStatus.RUNNING) {
      throw new Error(`cannot fail session in status "${session.status}"`)
    }
    session.status = SessionStatus.FAILED
    session.error = error
    session.durationMs = durationMs
    session.finishedAt = new Date().toISOString()
    return session
  }
}

export interface Session {
  id: string
  correlationId: string
  status: SessionStatusType
  task: { member: string; prompt: string; provider?: string }
  createdAt: string
  startedAt: string | undefined
  finishedAt: string | undefined
  output: string | undefined
  error: string | undefined
  durationMs: number | undefined
}
