import { EventLogStore } from '../bridge/EventLogStore'
import { rehydrate, filterSessions } from './sessionStore'
import { deepFreeze } from './deepFreeze'
import type { SessionBackend, SessionFilter, SessionList, CostUsageRow, DailyCostFilter } from './sessionBackend'
import type { Session, SessionEvent, SessionDelta, SessionSnapshot, Project, ProjectInvite, ProjectMember, ProjectRole, Notification, NotificationInput } from './types'
import { VersionConflictError } from './types'
import { DEFAULT_TENANT_ID } from './migrations'
import { reconstructRows, type CheckpointRow } from './deltaChannel'

function tenantOfSession(session: Session | null): string {
  return session?.tenantId ?? DEFAULT_TENANT_ID
}

/** The store vocabulary. The queue broadcasts `session.queued`/`session.started`
 * into the same log; only the aggregate event types count as store events,
 * or list/get would inflate version with the bridge narration. */
const STORE_EVENT_TYPES = new Set([
  'session.created',
  'session.running',
  'session.succeeded',
  'session.failed',
  'session.cancelled',
  'session.awaiting_input',
  'session.user_reply',
  'session.message',
  'session.steer',
  'member.event',
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
  private readonly _members: Map<string, ProjectMember>
  private readonly _invites: Map<string, ProjectInvite>
  private readonly _invitesByHash: Map<string, ProjectInvite>
  private readonly _notifications: Map<string, Notification>
  /** Checkpoints ride in memory only — same durability as this backend's projects. */
  private readonly _checkpoints: Map<string, { sessionId: string; rows: CheckpointRow[] }>
  /** Cost counters ride in memory only — same durability as this backend's projects. */
  private readonly _costUsage: Map<string, CostUsageRow & { tenant: string }>

  constructor(log: EventLogStore, tenantId: string = DEFAULT_TENANT_ID, shared?: { snapshots: Map<string, SessionSnapshot>; versions: Map<string, number>; projects: Map<string, Project>; deletedProjects: Set<string>; members: Map<string, ProjectMember>; invites: Map<string, ProjectInvite>; invitesByHash: Map<string, ProjectInvite>; notifications: Map<string, Notification>; checkpoints: Map<string, { sessionId: string; rows: CheckpointRow[] }>; costUsage: Map<string, CostUsageRow & { tenant: string }> }) {
    this.log = log
    this._tenantId = tenantId
    if (shared) {
      this._snapshots = shared.snapshots
      this._versions = shared.versions
      this._projects = shared.projects
      this._deletedProjects = shared.deletedProjects
      this._members = shared.members
      this._invites = shared.invites
      this._invitesByHash = shared.invitesByHash
      this._notifications = shared.notifications
      this._checkpoints = shared.checkpoints
      this._costUsage = shared.costUsage
    } else {
      this._snapshots = new Map<string, SessionSnapshot>()
      this._versions = new Map<string, number>()
      this._projects = new Map<string, Project>()
      this._deletedProjects = new Set<string>()
      this._members = new Map<string, ProjectMember>()
      this._invites = new Map<string, ProjectInvite>()
      this._invitesByHash = new Map<string, ProjectInvite>()
      this._notifications = new Map<string, Notification>()
      this._checkpoints = new Map<string, { sessionId: string; rows: CheckpointRow[] }>()
      this._costUsage = new Map<string, CostUsageRow & { tenant: string }>()
    }
  }

  withTenant(tenantId: string): SessionBackend {
    if (tenantId === this._tenantId) return this
    return new EventLogBackend(this.log, tenantId, {
      snapshots: this._snapshots,
      versions: this._versions,
      projects: this._projects,
      deletedProjects: this._deletedProjects,
      members: this._members,
      invites: this._invites,
      invitesByHash: this._invitesByHash,
      notifications: this._notifications,
      checkpoints: this._checkpoints,
      costUsage: this._costUsage,
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
    const markers = new Map<string, number>()
    const bySession = new Map<string, { eventId: number; event: SessionEvent }[]>()
    for (const { eventId, envelope } of this.log.replay(-1)) {
      if (
        envelope.type === 'session.deleted' &&
        typeof envelope.sessionId === 'string' &&
        ((envelope.tenantId as string) ?? DEFAULT_TENANT_ID) === this._tenantId
      ) {
        markers.set(envelope.sessionId, eventId)
      } else if (isStoreSessionEvent(envelope.type) && typeof envelope.sessionId === 'string') {
        const events = bySession.get(envelope.sessionId) ?? []
        events.push({ eventId, event: envelope as unknown as SessionEvent })
        bySession.set(envelope.sessionId, events)
      }
    }
    const sessions = [...bySession.entries()]
      .map(([sessionId, entries]) => {
        const marker = markers.get(sessionId) ?? -1
        const events = entries.filter((e) => e.eventId > marker).map((e) => e.event)
        return events.length > 0 ? rehydrate(events) : null
      })
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
    for (const [key] of this._members.entries()) {
      if (key.startsWith(`${this._tenantId}:${id}:`)) this._members.delete(key)
    }
    for (const [key, inv] of this._invites.entries()) {
      if (inv.tenantId === this._tenantId && inv.projectId === id) {
        this._invites.delete(key)
        this._invitesByHash.delete(inv.tokenHash)
      }
    }
    for (const [sessionId, snap] of this._snapshots.entries()) {
      if (snap.session.projectId === id && tenantOfSession(snap.session) === this._tenantId) {
        this._snapshots.delete(sessionId)
        this._versions.delete(sessionId)
        for (const [key, n] of this._notifications.entries()) {
          if (n.tenantId === this._tenantId && n.sessionId === sessionId) this._notifications.delete(key)
        }
      }
    }
    return existed
  }

  async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
    return [...this._members.values()].filter((m) => m.tenantId === this._tenantId && m.projectId === projectId)
  }

  async getProjectMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    return this._members.get(`${this._tenantId}:${projectId}:${userId}`) ?? null
  }

  async setProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMember> {
    const member: ProjectMember = { projectId, userId, role, tenantId: this._tenantId }
    this._members.set(`${this._tenantId}:${projectId}:${userId}`, member)
    return member
  }

  async removeProjectMember(projectId: string, userId: string): Promise<boolean> {
    return this._members.delete(`${this._tenantId}:${projectId}:${userId}`)
  }

  async setProjectMemberGuarded(
    projectId: string,
    userId: string,
    role: ProjectRole
  ): Promise<{ member: ProjectMember } | { error: 'last-owner' }> {
    // Synchronous map ops with no await between mutate and check: atomic on
    // the Node event loop, so concurrent demotes cannot strand the project.
    const key = `${this._tenantId}:${projectId}:${userId}`
    const prior = this._members.get(key) ?? null
    const member: ProjectMember = { projectId, userId, role, tenantId: this._tenantId }
    this._members.set(key, member)
    const hasOwner = [...this._members.values()].some(
      (m) => m.tenantId === this._tenantId && m.projectId === projectId && m.role === 'owner'
    )
    if (!hasOwner) {
      if (prior) this._members.set(key, prior)
      else this._members.delete(key)
      return { error: 'last-owner' }
    }
    return { member }
  }

  async listProjectInvites(projectId: string): Promise<ProjectInvite[]> {
    return [...this._invites.values()].filter((i) => i.tenantId === this._tenantId && i.projectId === projectId)
  }

  async createProjectInvite(invite: ProjectInvite): Promise<ProjectInvite> {
    const row: ProjectInvite = { ...invite, tenantId: this._tenantId }
    this._invites.set(`${this._tenantId}:${invite.id}`, row)
    this._invitesByHash.set(invite.tokenHash, row)
    return row
  }

  async getProjectInviteByTokenHash(tokenHash: string): Promise<ProjectInvite | null> {
    const inv = this._invitesByHash.get(tokenHash) ?? null
    return inv && inv.tenantId === this._tenantId ? inv : null
  }

  async acceptProjectInvite(
    tokenHash: string,
    userId: string
  ): Promise<{ projectId: string; role: ProjectRole } | null> {
    // No await between lookup, consume, and insert: atomic on the event loop,
    // so a double-submitted single-use link admits exactly one member.
    const inv = this._invitesByHash.get(tokenHash) ?? null
    if (!inv || inv.tenantId !== this._tenantId) return null
    if (Date.parse(inv.expiresAt) < Date.now()) {
      this._invites.delete(`${this._tenantId}:${inv.id}`)
      this._invitesByHash.delete(inv.tokenHash)
      return null
    }
    this._invites.delete(`${this._tenantId}:${inv.id}`)
    this._invitesByHash.delete(inv.tokenHash)
    this._members.set(`${this._tenantId}:${inv.projectId}:${userId}`, {
      projectId: inv.projectId,
      userId,
      role: inv.role,
      tenantId: this._tenantId,
    })
    return { projectId: inv.projectId, role: inv.role }
  }

  async deleteProjectInvite(id: string, projectId: string): Promise<boolean> {
    const row = this._invites.get(`${this._tenantId}:${id}`)
    if (!row || row.projectId !== projectId) return false
    this._invites.delete(`${this._tenantId}:${id}`)
    this._invitesByHash.delete(row.tokenHash)
    return true
  }

  async createNotification(input: NotificationInput): Promise<Notification> {
    const row: Notification = {
      ...input,
      excerpt: input.excerpt.slice(0, 280),
      readAt: null,
      createdAt: new Date().toISOString(),
      tenantId: this._tenantId,
    }
    this._notifications.set(`${this._tenantId}:${input.id}`, row)
    return row
  }

  async listNotifications(userId: string, filter: { unreadOnly?: boolean; limit: number; offset: number }): Promise<{ notifications: Notification[]; total: number }> {
    const all = [...this._notifications.values()]
      .filter((n) => n.tenantId === this._tenantId && n.userId === userId && (!filter.unreadOnly || n.readAt === null))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { notifications: all.slice(filter.offset, filter.offset + filter.limit), total: all.length }
  }

  async countUnread(userId: string): Promise<number> {
    let count = 0
    for (const n of this._notifications.values()) {
      if (n.tenantId === this._tenantId && n.userId === userId && n.readAt === null) count++
    }
    return count
  }

  async countUnreadBySession(userId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const n of this._notifications.values()) {
      if (n.tenantId === this._tenantId && n.userId === userId && n.readAt === null) {
        counts[n.sessionId] = (counts[n.sessionId] ?? 0) + 1
      }
    }
    return counts
  }

  async markNotificationRead(id: string, userId: string): Promise<boolean> {
    const row = this._notifications.get(`${this._tenantId}:${id}`)
    if (!row || row.userId !== userId) return false
    if (row.readAt === null) row.readAt = new Date().toISOString()
    return true
  }

  /**
   * Deletion is a tombstone, not a purge: the NDJSON log is append-only, so a
   * `session.deleted` envelope marks a cut-off and every event for the session
   * with a smaller eventId disappears from get/list. Rotation is safe because
   * the oldest records — which the tombstone already hides — leave first.
   * Re-appending after the tombstone yields a fresh version-1 stream.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const eventId = this.log.nextEventId
    const persisted = this.log.append({
      eventId,
      type: 'session.deleted',
      sessionId,
      correlationId: '',
      at: new Date().toISOString(),
      tenantId: this._tenantId,
    })
    if (!persisted) return
    this._snapshots.delete(sessionId)
    this._versions.delete(sessionId)
  }

  async saveCheckpoint(id: string, sessionId: string, data: string): Promise<void> {
    this.#appendCheckpointRow(id, sessionId, 'full', data)
  }

  async saveCheckpointDelta(id: string, sessionId: string, data: string): Promise<void> {
    this.#appendCheckpointRow(id, sessionId, 'delta', data)
  }

  #appendCheckpointRow(id: string, sessionId: string, kind: 'full' | 'delta', data: string): void {
    const key = `${this._tenantId}:${id}`
    const existing = this._checkpoints.get(key)
    const rows = existing?.rows ?? []
    rows.push({ kind, step: rows.length, data })
    this._checkpoints.set(key, { sessionId, rows })
  }

  async loadCheckpoint(id: string): Promise<{ sessionId: string; data: string } | null> {
    const entry = this._checkpoints.get(`${this._tenantId}:${id}`)
    if (!entry) return null
    const value = reconstructRows(entry.rows)
    if (value === null) return null
    return { sessionId: entry.sessionId, data: JSON.stringify(value) }
  }

  async getDeltaChannelHistory(id: string): Promise<Array<{ kind: 'full' | 'delta'; step: number; bytes: number }>> {
    const entry = this._checkpoints.get(`${this._tenantId}:${id}`)
    if (!entry) return []
    return entry.rows.map((r) => ({ kind: r.kind, step: r.step, bytes: r.data.length }))
  }

  async deleteCheckpoint(id: string): Promise<void> {
    this._checkpoints.delete(`${this._tenantId}:${id}`)
  }

  async recordCostUsage(row: CostUsageRow): Promise<void> {
    const key = `${this._tenantId}:${row.day}:${row.agent}:${row.model}`
    const prev = this._costUsage.get(key)
    if (prev) {
      prev.promptTokens += row.promptTokens
      prev.completionTokens += row.completionTokens
      prev.stepCost += row.stepCost
    } else {
      this._costUsage.set(key, { tenant: this._tenantId, ...row })
    }
  }

  async listDailyCost(filter: DailyCostFilter): Promise<CostUsageRow[]> {
    return [...this._costUsage.values()]
      .filter((r) => r.tenant === this._tenantId
        && (filter.since === undefined || r.day >= filter.since)
        && (filter.until === undefined || r.day <= filter.until))
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .map((r) => ({ day: r.day, agent: r.agent, model: r.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, stepCost: r.stepCost }))
  }

  private _deletedMarker(sessionId: string): number {
    let marker = -1
    for (const { eventId, envelope } of this.log.replay(-1)) {
      if (
        envelope.type === 'session.deleted' &&
        envelope.sessionId === sessionId &&
        ((envelope.tenantId as string) ?? DEFAULT_TENANT_ID) === this._tenantId
      ) {
        marker = eventId
      }
    }
    return marker
  }

  private _sessionEvents(sessionId: string): SessionEvent[] {
    const marker = this._deletedMarker(sessionId)
    const events: SessionEvent[] = []
    for (const { eventId, envelope } of this.log.replay(-1)) {
      if (eventId <= marker) continue
      if (isStoreSessionEvent(envelope.type) && envelope.sessionId === sessionId) {
        events.push(envelope as unknown as SessionEvent)
      }
    }
    return events
  }
}
