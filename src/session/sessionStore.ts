import type { Session, SessionEvent, SessionDelta } from './types'
import { StreamIntegrityError, VersionConflictError } from './types'
import type { SessionBackend } from './sessionBackend'

export { StreamIntegrityError, VersionConflictError }

export function rehydrate(events: SessionEvent[]): Session | null {
  if (events.length === 0) return null

  const first = events[0]
  for (const e of events) {
    if (e.sessionId !== first.sessionId || e.correlationId !== first.correlationId) {
      throw new StreamIntegrityError(first.sessionId, e.sessionId, e.correlationId)
    }
  }

  const session: Session = {
    sessionId: first.sessionId,
    correlationId: first.correlationId,
    status: 'queued',
    version: events.length,
    task: { member: first.member ?? '', prompt: first.prompt ?? '' },
  }

  let createdAt: string | undefined
  let startedAt: string | undefined
  let finishedAt: string | undefined

  for (const e of events) {
    switch (e.type) {
      case 'session.created':
        createdAt = e.at
        if (e.member !== undefined) session.task.member = e.member
        if (e.prompt !== undefined) session.task.prompt = e.prompt
        if (e.tweaks !== undefined) session.tweaks = e.tweaks
        break
      case 'session.running':
        startedAt = e.at
        session.status = 'running'
        break
      case 'session.succeeded':
        finishedAt = e.at
        session.status = 'succeeded'
        if (e.output !== undefined) session.output = e.output
        if (e.durationMs !== undefined) session.durationMs = e.durationMs
        break
      case 'session.failed':
        finishedAt = e.at
        session.status = 'failed'
        if (e.error !== undefined) session.error = e.error
        break
      case 'session.cancelled':
        finishedAt = e.at
        session.status = 'cancelled'
        break
    }
  }

  session.createdAt = createdAt
  session.startedAt = startedAt
  session.finishedAt = finishedAt
  return session
}

export class SessionStore implements SessionBackend {
  private readonly events = new Map<string, SessionEvent[]>()
  private readonly versions = new Map<string, number>()

  async append(event: SessionEvent): Promise<void> {
    const list = this.events.get(event.sessionId) ?? []
    list.push(event)
    this.events.set(event.sessionId, list)
    this.versions.set(event.sessionId, list.length)
  }

  async get(sessionId: string): Promise<Session | null> {
    const list = this.events.get(sessionId)
    if (!list || list.length === 0) return null
    return rehydrate(list)
  }

  async readModifyWrite(
    sessionId: string,
    expectedVersion: number,
    mutator: (current: Session | null) => SessionDelta[]
  ): Promise<void> {
    const list = this.events.get(sessionId) ?? []
    const actual = this.versions.get(sessionId) ?? 0
    if (actual !== expectedVersion) {
      throw new VersionConflictError(sessionId, expectedVersion, actual)
    }

    const current = list.length > 0 ? rehydrate(list) : null
    for (const delta of mutator(current)) {
      await this.append({ ...delta, sessionId })
    }
  }
}