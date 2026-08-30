import { EventLogStore } from '../bridge/EventLogStore'
import { rehydrate, filterSessions } from './sessionStore'
import { deepFreeze } from './deepFreeze'
import type { SessionBackend, SessionFilter, SessionList } from './sessionBackend'
import type { Session, SessionEvent, SessionDelta, SessionSnapshot, Project } from './types'
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
  'session.awaiting_input',
  'session.user_reply',
])

function isStoreSessionEvent(type: unknown): type is string {
  return typeof type === 'string' && STORE_EVENT_TYPES.has(type)
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
  #snapshots = new Map<string, SessionSnapshot>()
  #versions = new Map<string, number>()
  /** In-memory projects — lost on restart; PostgresBackend is durable. */
  #projects = new Map<string, Project>()
  #deletedProjects = new Set<string>()

  constructor(log: EventLogStore) {
    this.log = log
  }

  /**
   * Resolves even when EventLogStore swallowed a disk-write failure (ADR-005:
   * the live stream never blocks on disk). The version is derived from the log,
   * so a failed commit never advances it — the next readModifyWrite carrying the
   * old expectedVersion rejects, which is how the caller notices.
   */
  async append(event: SessionEvent): Promise<void> {
    const persisted = this.log.append({ ...event, eventId: this.log.nextEventId, type: event.type })
    if (!persisted) return
    this.#snapshots.delete(event.sessionId)
    const prev = this.#versions.get(event.sessionId) ?? 0
    this.#versions.set(event.sessionId, prev + 1)
  }

  async get(sessionId: string): Promise<Session | null> {
    const cached = this.#snapshots.get(sessionId)
    const cachedVersion = this.#versions.get(sessionId)
    if (cached !== undefined && cachedVersion !== undefined && cached.version === cachedVersion) {
      if (cached.session.projectId !== undefined && this.#deletedProjects.has(cached.session.projectId)) return null
      return cached.session
    }

    const events = this.#sessionEvents(sessionId)
    const currentVersion = events.length

    if (cached !== undefined && cached.version === currentVersion) {
      if (cached.session.projectId !== undefined && this.#deletedProjects.has(cached.session.projectId)) return null
      return cached.session
    }

    const session = events.length > 0 ? rehydrate(events) : null
    if (session === null) {
      this.#snapshots.delete(sessionId)
      return null
    }
    if (session.projectId !== undefined && this.#deletedProjects.has(session.projectId)) {
      this.#snapshots.delete(sessionId)
      return null
    }
    const frozen = deepFreeze(session)
    this.#snapshots.set(sessionId, { session: frozen, version: currentVersion })
    this.#versions.set(sessionId, currentVersion)
    return frozen
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
    // invalidation flows through append() — each delta append deletes the snapshot and bumps #versions
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
      .filter((s) => s.projectId === undefined || !this.#deletedProjects.has(s.projectId))
    return filterSessions(sessions, filter)
  }

  async listProjects(): Promise<Project[]> {
    return [...this.#projects.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt)
    )
  }

  async getProject(id: string): Promise<Project | null> {
    return this.#projects.get(id) ?? null
  }

  async createProject(id: string, name: string): Promise<Project> {
    const project: Project = { id, name, createdAt: new Date().toISOString() }
    this.#projects.set(id, project)
    return project
  }

  async deleteProject(id: string): Promise<boolean> {
    const existed = this.#projects.delete(id)
    if (existed) this.#deletedProjects.add(id)
    for (const [sessionId, snap] of this.#snapshots.entries()) {
      if (snap.session.projectId === id) {
        this.#snapshots.delete(sessionId)
        this.#versions.delete(sessionId)
      }
    }
    return existed
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
