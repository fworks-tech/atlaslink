import { EventLogStore } from '../bridge/EventLogStore'
import { rehydrate, filterSessions } from './sessionStore'
import { deepFreeze } from './deepFreeze'
import type { SessionBackend, SessionFilter, SessionList } from './sessionBackend'
import type { Session, SessionEvent, SessionDelta } from './types'
import { VersionConflictError } from './types'

/** The store vocabulary. The queue broadcasts `session.queued`/`session.started`
 * into the same log; only the five aggregate event types count as store events,
 * or list/get would inflate version with the bridge narration. */
const STORE_EVENT_TYPES = new Set([
  'session.created',
  'session.running',
  'session.succeeded',
  'session.failed',
  'session.cancelled',
])

function isStoreSessionEvent(type: unknown): type is string {
  return typeof type === 'string' && STORE_EVENT_TYPES.has(type)
}

interface Snapshot {
  session: Session
  version: number
}

/**
 * SessionBackend over the shared NDJSON EventLogStore (ADR-004): session events
 * are persisted as bridge envelopes in the same log as the run stream, and each
 * read rebuilds the aggregate from the log. A snapshot cache serves repeated
 * reads without touching disk; the cache is keyed per-session and invalidated on
 * each append to that session — only quiescent streams benefit.
 */
export class EventLogBackend implements SessionBackend {
  readonly log: EventLogStore
  #snapshots = new Map<string, Snapshot>()

  constructor(log: EventLogStore) {
    this.log = log
  }

  /**
   * Resolves even when EventLogStore swallowed a disk-write failure (ADR-005:
   * the live stream never blocks on disk). The version is derived from the log,
   * so a failed commit never advances it — the next readModifyWrite carrying the
   * old expectedVersion rejects, which is how the caller notices.
   */
  append(event: SessionEvent): Promise<void> {
    this.log.append({ ...event, eventId: this.log.nextEventId, type: event.type })
    this.#snapshots.delete(event.sessionId)
    return Promise.resolve()
  }

  async get(sessionId: string): Promise<Session | null> {
    const events = this.#sessionEvents(sessionId)
    const currentVersion = events.length

    const cached = this.#snapshots.get(sessionId)
    if (cached !== undefined && cached.version === currentVersion) {
      return cached.session
    }

    const session = events.length > 0 ? rehydrate(events) : null
    if (session === null) {
      this.#snapshots.delete(sessionId)
      return null
    }
    this.#snapshots.set(sessionId, { session: deepFreeze(session), version: currentVersion })
    return session
  }

  async readModifyWrite(
    sessionId: string,
    expectedVersion: number,
    mutator: (current: Session | null) => SessionDelta[]
  ): Promise<void> {
    const events = this.#sessionEvents(sessionId)
    const actual = events.length
    if (actual !== expectedVersion) {
      throw new VersionConflictError(sessionId, expectedVersion, actual)
    }

    const current = events.length > 0 ? rehydrate(events) : null
    for (const delta of mutator(current)) {
      await this.append({ ...delta, sessionId })
    }
  }

  async list(filter: SessionFilter): Promise<SessionList> {
    const bySession = new Map<string, SessionEvent[]>()
    for (const { envelope } of this.log.replay(-1)) {
      if (isStoreSessionEvent(envelope.type) && typeof envelope.sessionId === 'string') {
        const events = bySession.get(envelope.sessionId) ?? []
        events.push(envelope as unknown as SessionEvent)
        bySession.set(envelope.sessionId, events)
      }
    }
    const sessions = [...bySession.values()]
      .map((events) => rehydrate(events))
      .filter((s): s is Session => s !== null)
    return filterSessions(sessions, filter)
  }

  #sessionEvents(sessionId: string): SessionEvent[] {
    const events: SessionEvent[] = []
    for (const { envelope } of this.log.replay(-1)) {
      if (isStoreSessionEvent(envelope.type) && envelope.sessionId === sessionId) {
        events.push(envelope as unknown as SessionEvent)
      }
    }
    return events
  }
}