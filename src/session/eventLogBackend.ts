import { EventLogStore, type BridgeEnvelope } from '../bridge/EventLogStore'
import { rehydrate } from './sessionStore'
import type { SessionBackend } from './sessionBackend'
import type { Session, SessionEvent, SessionDelta } from './types'
import { VersionConflictError } from './types'

interface Snapshot {
  session: Session
  logVersion: number
}

/**
 * SessionBackend over the shared NDJSON EventLogStore (ADR-004): session events
 * are persisted as bridge envelopes in the same log as the run stream, and each
 * read rebuilds the aggregate from the log. A snapshot cache keyed by the log
 * cursor serves repeated reads without touching disk until the next append.
 */
export class EventLogBackend implements SessionBackend {
  readonly log: EventLogStore
  #snapshots = new Map<string, Snapshot>()

  constructor(log: EventLogStore) {
    this.log = log
  }

  append(event: SessionEvent): Promise<void> {
    this.log.append({ ...event, eventId: this.log.nextEventId, type: event.type })
    this.#snapshots.delete(event.sessionId)
    return Promise.resolve()
  }

  async get(sessionId: string): Promise<Session | null> {
    const cached = this.#snapshots.get(sessionId)
    if (cached !== undefined && cached.logVersion === this.log.nextEventId) {
      return cached.session
    }

    const events = this.#sessionEvents(sessionId)
    const session = events.length > 0 ? rehydrate(events) : null
    if (session === null) {
      this.#snapshots.delete(sessionId)
      return null
    }
    this.#snapshots.set(sessionId, { session, logVersion: this.log.nextEventId })
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

  #envelope(event: SessionEvent): BridgeEnvelope {
    return { ...event, eventId: this.log.nextEventId, type: event.type }
  }

  #sessionEvents(sessionId: string): SessionEvent[] {
    const events: SessionEvent[] = []
    for (const { envelope } of this.log.replay(-1)) {
      if (
        typeof envelope.type === 'string' &&
        envelope.type.startsWith('session.') &&
        envelope.sessionId === sessionId
      ) {
        events.push(envelope as unknown as SessionEvent)
      }
    }
    return events
  }
}