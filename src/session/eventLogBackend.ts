import { EventLogStore } from '../bridge/EventLogStore'
import { rehydrate, filterSessions } from './sessionStore'
import { deepFreeze } from './deepFreeze'
import type { SessionBackend, SessionFilter, SessionList } from './sessionBackend'
import type { Session, SessionEvent, SessionDelta, SessionSnapshot, Project } from './types'
import { VersionConflictError } from './types'
import { DEFAULT_TENANT_ID } from './migrations'

function tenantOfSession(session: Session | null): string {
  return session?.tenantId ?? DEFAULT_TENANT_ID
}

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
  private readonly _snapshots: Map<string, SessionSnapshot>
  private readonly _versions: Map<string, number>
  /** In-memory projects — lost on restart; PostgresBackend is durable. */
  private readonly _projects: Map<string, Project>
  private readonly _deletedProjects: Set<string>
  private readonly _tenantId: string

  constructor(log: EventLogStore, tenantId: string = DEFAULT_TENANT_ID, shared?: { snapshots: Map<string, SessionSnapshot>; versions: Map<string, number>; projects: Map<string, Project>; deletedProjects: Set<string> }) {
    this.log = log
    this._tenantId = tenantId
    if (shared) {
      this._snapshots = shared.snapshots
      this._versions = shared.versions
      this._projects = shared.projects
      this._deletedProjects = shared.deletedProjects
    } else {
      this._snapshots = new Map<string, SessionSnapshot>()
      this._versions = new Map<string, number>()
      this._projects = new Map<string, Project>()
      this._deletedProjects = new Set<string>()
    }
  }

  withTenant(tenantId: string): SessionBackend {
    if (tenantId === this._tenantId) return this
    return new EventLogBackend(this.log, tenantId, {
      snapshots: this._snapshots,
      versions: this._versions,
      projects: this._projects,
      deletedProjects: this._deletedProjects,
    })
  }

  get tenant(): string {
    return this._tenantId
  }

  /**
   * Resolves even when EventLogStore swallowed a disk-write failure (ADR-005:
   * the live stream never blocks on disk). The version is derived from the log,
   * so a failed commit never advances it — the next readModifyWrite carrying the
   * old expectedVersion rejects, which is how the caller notices.
   */
  async append(event: SessionEvent): Promise<void> {
    const tenantId = event.tenantId ?? this._tenantId
    const stored: SessionEvent = { ...event, tenantId }
    const persisted = this.log.append({ ...stored, eventId: this.log.nextEventId, type: stored.type })
    if (!persisted) return
    this._snapshots.delete(event.sessionId)
    const prev = this._versions.get(event.sessionId) ?? 0
    this._versions.set(event.sessionId, prev + 1)
  }

  async get(sessionId: string): Promise<Session | null> {
    const cached = this._snapshots.get(sessionId)
    const cachedVersion = this._versions.get(sessionId)
    if (cached !== undefined && cachedVersion !== undefined && cached.version === cachedVersion) {
      if (cached.session.projectId !== undefined && this._deletedProjects.has(cached.session.projectId)) return null
      if (tenantOfSession(cached.session) !== this._tenantId) return null
      return cached.session
    }

    const events = this._sessionEvents(sessionId)
    const currentVersion = events.length

    if (cached !== undefined && cached.version === currentVersion) {
      if (cached.session.projectId !== undefined && this._deletedProjects.has(cached.session.projectId)) return null
      if (tenantOfSession(cached.session) !== this._tenantId) return null
      return cached.session
    }

    const session = events.length > 0 ? rehydrate(events) : null
    if (session === null) {
      this._snapshots.delete(sessionId)
      return null
    }
    if (tenantOfSession(session) !== this._tenantId) return null
    if (session.projectId !== undefined && this._deletedProjects.has(session.projectId)) {
      this._snapshots.delete(sessionId)
      return null
    }
    const frozen = deepFreeze(session)
    this._snapshots.set(sessionId, { session: frozen, version: currentVersion })
    this._versions.set(sessionId, currentVersion)
    return frozen
  }

  async readModifyWrite(
    sessionId: string,
    expectedVersion: number,
    mutator: (current: Session | null) => SessionDelta[]
  ): Promise<void> {
    const events = this._sessionEvents(sessionId)
    // if existing session belongs to another tenant, treat as not found for this tenant
    if (events.length > 0) {
      const owner = (events[0] as SessionEvent).tenantId ?? DEFAULT_TENANT_ID
      if (owner !== this._tenantId) throw new VersionConflictError(sessionId, expectedVersion, 0)
    }
    const actual = events.length
    if (actual !== expectedVersion) {
      throw new VersionConflictError(sessionId, expectedVersion, actual)
    }

    const current = events.length > 0 ? rehydrate(events) : null
    if (current !== null && tenantOfSession(current) !== this._tenantId) {
      throw new VersionConflictError(sessionId, expectedVersion, 0)
    }
    // invalidation flows through append() — each delta append deletes the snapshot and bumps #versions
    for (const delta of mutator(current)) {
      const tenantDelta: SessionDelta = delta.tenantId !== undefined ? delta : { ...delta, tenantId: this._tenantId }
      await this.append({ ...tenantDelta, sessionId } as SessionEvent)
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
      .filter((s) => tenantOfSession(s) === this._tenantId)
      .filter((s) => s.projectId === undefined || !this._deletedProjects.has(s.projectId))
    const tenantFilter: SessionFilter = { ...filter, tenantId: this._tenantId }
    return filterSessions(sessions, tenantFilter)
  }

  async listProjects(): Promise<Project[]> {
    return [...this._projects.values()]
      .filter((p) => (p.tenantId ?? DEFAULT_TENANT_ID) === this._tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getProject(id: string): Promise<Project | null> {
    const p = this._projects.get(id) ?? null
    if (!p) return null
    return (p.tenantId ?? DEFAULT_TENANT_ID) === this._tenantId ? p : null
  }

  async createProject(id: string, name: string): Promise<Project> {
    const project: Project = { id, name, createdAt: new Date().toISOString(), tenantId: this._tenantId }
    this._projects.set(id, project)
    return project
  }

  async deleteProject(id: string): Promise<boolean> {
    const p = this._projects.get(id)
    if (!p || (p.tenantId ?? DEFAULT_TENANT_ID) !== this._tenantId) return false
    const existed = this._projects.delete(id)
    if (existed) this._deletedProjects.add(id)
    for (const [sessionId, snap] of this._snapshots.entries()) {
      if (snap.session.projectId === id && tenantOfSession(snap.session) === this._tenantId) {
        this._snapshots.delete(sessionId)
        this._versions.delete(sessionId)
      }
    }
    return existed
  }

  private _sessionEvents(sessionId: string): SessionEvent[] {
    const events: SessionEvent[] = []
    for (const { envelope } of this.log.replay(-1)) {
      if (isStoreSessionEvent(envelope.type) && envelope.sessionId === sessionId) {
        events.push(envelope as unknown as SessionEvent)
      }
    }
    return events
  }
}
