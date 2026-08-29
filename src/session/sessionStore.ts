import type { Session, SessionEvent, SessionDelta } from './types'
import { StreamIntegrityError, VersionConflictError } from './types'
import type { SessionBackend, SessionFilter, SessionList } from './sessionBackend'
import { deepFreeze } from './deepFreeze'

export { StreamIntegrityError, VersionConflictError }

/**
 * Shared list filter for every backend: status and `since` (createdAt) match,
 * newest-first, with `total` counted before pagination. Keeps the task-rest
 * list endpoint semantics identical regardless of the backend underneath.
 */
export function filterSessions(sessions: Session[], filter: SessionFilter): SessionList {
  const matched = sessions
    .filter((s) => filter.status === undefined || s.status === filter.status)
    .filter((s) => filter.since === undefined || (s.createdAt !== undefined && s.createdAt >= filter.since))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return {
    sessions: matched.slice(filter.offset, filter.offset + filter.limit),
    total: matched.length,
  }
}

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

interface Snapshot {
  session: Session
  version: number
}

export class SessionStore implements SessionBackend {
  private readonly events = new Map<string, SessionEvent[]>()
  private readonly versions = new Map<string, number>()
  #snapshots = new Map<string, Snapshot>()

  async append(event: SessionEvent): Promise<void> {
    const list = this.events.get(event.sessionId) ?? []
    list.push(event)
    this.events.set(event.sessionId, list)
    this.versions.set(event.sessionId, list.length)
    this.#snapshots.delete(event.sessionId)
  }

  async get(sessionId: string): Promise<Session | null> {
    const list = this.events.get(sessionId)
    if (!list || list.length === 0) return null

    const cached = this.#snapshots.get(sessionId)
    const currentVersion = this.versions.get(sessionId) ?? 0
    if (cached !== undefined && cached.version === currentVersion) {
      return cached.session
    }

    const session = rehydrate(list)
    this.#snapshots.set(sessionId, { session: deepFreeze(session), version: currentVersion })
    return session
  }

  async list(filter: SessionFilter): Promise<SessionList> {
    const sessions: Session[] = []
    for (const events of this.events.values()) {
      const session = rehydrate(events)
      if (session !== null) sessions.push(session)
    }
    return filterSessions(sessions, filter)
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