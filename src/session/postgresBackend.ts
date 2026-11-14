import type { Session, SessionEvent, SessionDelta, SessionSnapshot, Project, ProjectInvite, ProjectMember, ProjectRole, DurabilityMode, Notification, NotificationInput, CustomAgent, CustomAgentInput } from './types'
import { VersionConflictError } from './types'
import { rehydrate } from './sessionStore'
import { deepFreeze } from './deepFreeze'
import type { SessionBackend, SessionFilter, SessionList, CostUsageRow, DailyCostFilter } from './sessionBackend'
import type { Db } from './db'
import { isUniqueViolation } from './db'
import { DEFAULT_TENANT_ID } from './migrations'
import { reconstructRows } from './deltaChannel'

interface EventRow {
  sessionId?: string
  event: string | SessionEvent
}

interface VersionRow {
  version: number
}

interface ProjectRow {
  id: string
  name: string
  created_at: string
}

interface SessionDirectoryRow {
  session_id: string
  project_id: string
  title: string
  status: string
  created_at: string
}

function parseEvent(raw: string | SessionEvent): SessionEvent {
  return typeof raw === 'string' ? (JSON.parse(raw) as SessionEvent) : raw
}

/** Sentinel for the owner-quorum rollback in setProjectMemberGuarded. */
const LAST_OWNER_ERROR = Symbol('last-owner')

async function upsertProjectMember(
  db: Db,
  dialect: Db['dialect'],
  tenantId: string,
  projectId: string,
  userId: string,
  role: ProjectRole
): Promise<void> {
  if (dialect === 'postgres') {
    await db.query(
      `INSERT INTO project_members (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [tenantId, projectId, userId, role]
    )
  } else {
    await db.query(`DELETE FROM project_members WHERE tenant_id = $1 AND project_id = $2 AND user_id = $3`, [tenantId, projectId, userId])
    await db.query(`INSERT INTO project_members (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, $4)`, [tenantId, projectId, userId, role])
  }
}
/** Chat/steer/reply and member.event mirrors append to history without moving
 * the lifecycle — the sessions directory keeps its status and only `updated_at`
 * advances. Single source for both the directory projection and the ranked-CTE
 * exclusion below. */
const STATUS_PRESERVING_EVENTS: ReadonlySet<SessionEvent['type']> = new Set(['session.message', 'session.steer', 'session.user_reply', 'member.event'])

/** SQL literal list derived from STATUS_PRESERVING_EVENTS — never hand-edit. */
const STATUS_PRESERVING_SQL = [...STATUS_PRESERVING_EVENTS].map((t) => `'${t}'`).join(', ')

/**
 * The `SessionBackend` over Postgres event tables (ADR-006 Decisions 4–5).
 * Event append is the commit; `version` is the optimistic CAS token held inside
 * a `FOR UPDATE` transaction so two writers holding the same `expectedVersion`
 * cannot both commit (the #32 class of bug). `tenant_id` is set per row now so
 * the auth ADR's tenant scoping is additive, not a schema rewrite.
 *
 * Snapshot cache: `#snapshots` holds the frozen aggregate per session;
 * `#versions` is the local commit counter that enables zero-I/O hits — `get()`
 * returns the cached snapshot when `#versions` matches the snapshot version
 * without touching Postgres. The two maps are updated together in `append()` and
 * after a DB-backed `get()`. They are single-process in-memory state; across
 * processes the DB is the source of truth and a stale `#versions` falls through
 * to the DB path and re-syncs.
 *
 * Sessions directory table is a maintained projection for fast
 * project-scoped listing — upserted transactionally on each append.
 */
export class PostgresBackend implements SessionBackend {
  #snapshots = new Map<string, SessionSnapshot>()
  #versions = new Map<string, number>()
  #exitBuffers = new Map<string, SessionEvent[]>()
  #db: Db
  #tenantId: string
  #durability: DurabilityMode

  #cachedSnapshot(sessionId: string): Session | null {
    const version = this.#versions.get(sessionId)
    if (version === undefined) return null
    const snap = this.#snapshots.get(sessionId)
    return snap !== undefined && snap.version === version ? snap.session : null
  }

  constructor(db: Db, tenantId: string = DEFAULT_TENANT_ID, durability: DurabilityMode = 'sync') {
    this.#db = db
    this.#tenantId = tenantId
    this.#durability = durability
  }

  /** Sessions-directory projection for one committed event. Shared by append
   * and readModifyWrite so the two paths cannot diverge on new event types. */
  private async projectDirectory(
    tx: { query: (text: string, params: unknown[]) => Promise<unknown> },
    event: SessionEvent,
    sessionId: string
  ): Promise<void> {
    if (event.type === 'session.created' && event.projectId) {
      const title = (event.prompt ?? sessionId).slice(0, 500)
      await tx.query(
        `INSERT INTO sessions (tenant_id, session_id, project_id, title, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'queued', $5, $5)
         ON CONFLICT (tenant_id, session_id) DO UPDATE SET
           project_id = EXCLUDED.project_id,
           title = EXCLUDED.title,
           updated_at = EXCLUDED.updated_at`,
        [this.#tenantId, sessionId, event.projectId, title, event.at]
      )
    } else if (STATUS_PRESERVING_EVENTS.has(event.type)) {
      await tx.query(
        `UPDATE sessions SET updated_at = $3
         WHERE tenant_id = $1 AND session_id = $2`,
        [this.#tenantId, sessionId, event.at]
      )
    } else if (event.type !== 'session.created') {
      // status mapping is exhaustive; unknown types fail-fast to surface new SessionEvent variants
      const statusMap: Record<string, string> = {
        'session.running': 'running',
        'session.succeeded': 'succeeded',
        'session.failed': 'failed',
        'session.cancelled': 'cancelled',
        'session.awaiting_input': 'awaiting_input',
        }
      const status = statusMap[event.type]
      if (!status) throw new Error(`unknown session event type for directory projection: ${event.type}`)
      // For sessions not in the directory (no projectId), this UPDATE is a no-op
      // but still touches the index; acceptable for expected scale (<1k sessions/project).
      await tx.query(
        `UPDATE sessions SET status = $3, updated_at = $4
         WHERE tenant_id = $1 AND session_id = $2`,
        [this.#tenantId, sessionId, status, event.at]
      )
    }
  }

  get db(): Db {
    return this.#db
  }

  withTenant(tenantId: string): PostgresBackend {
    if (tenantId === this.#tenantId) return this
    return new PostgresBackend(this.#db, tenantId, this.#durability)
  }

  get tenant(): string {
    return this.#tenantId
  }

  get mode(): DurabilityMode {
    return this.#durability
  }

  async append(event: SessionEvent): Promise<void> {
    if (this.#durability === 'exit') {
      const buf = this.#exitBuffers.get(event.sessionId) ?? []
      buf.push(event)
      this.#exitBuffers.set(event.sessionId, buf)
      const terminal = event.type === 'session.succeeded' || event.type === 'session.failed' || event.type === 'session.cancelled'
      if (terminal) await this.flush(event.sessionId)
      return
    }

    const promise = this.db.transaction(async (tx) => {
      const { rows } = await tx.query<VersionRow>(
        `SELECT version FROM session_events
         WHERE tenant_id = $1 AND session_id = $2
         ORDER BY version DESC LIMIT 1${ROW_LOCK_CLAUSE(this.#db.dialect)}`,
        [this.#tenantId, event.sessionId]
      )
      const next = (rows[0]?.version ?? 0) + 1
      await tx.query(
        `INSERT INTO session_events (tenant_id, session_id, version, correlation_id, at, event)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.#tenantId, event.sessionId, next, event.correlationId, event.at, JSON.stringify(event)]
      )

      await this.projectDirectory(tx, event, event.sessionId)
    })

    if (this.#durability === 'sync') await promise
    else promise.catch(() => {}) // async: fire-and-forget

    this.#snapshots.delete(event.sessionId)
    const prev = this.#versions.get(event.sessionId) ?? 0
    this.#versions.set(event.sessionId, prev + 1)
  }

  async flush(sessionId: string): Promise<void> {
    const buf = this.#exitBuffers.get(sessionId)
    if (!buf || buf.length === 0) return
    this.#exitBuffers.delete(sessionId)
    for (const event of buf) {
      await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<VersionRow>(
          `SELECT version FROM session_events
           WHERE tenant_id = $1 AND session_id = $2
           ORDER BY version DESC LIMIT 1${ROW_LOCK_CLAUSE(this.#db.dialect)}`,
          [this.#tenantId, sessionId]
        )
        const next = (rows[0]?.version ?? 0) + 1
        await tx.query(
          `INSERT INTO session_events (tenant_id, session_id, version, correlation_id, at, event)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [this.#tenantId, sessionId, next, event.correlationId, event.at, JSON.stringify(event)]
        )
        await this.projectDirectory(tx, event, sessionId)
      })
    }
  }

  async get(sessionId: string): Promise<Session | null> {
    const hit = this.#cachedSnapshot(sessionId)
    if (hit !== null) return hit

    const { rows } = await this.db.query<EventRow>(
      `SELECT event FROM session_events
       WHERE tenant_id = $1 AND session_id = $2
       ORDER BY version`,
      [this.#tenantId, sessionId]
    )
    if (rows.length === 0) return null

    const currentVersion = rows.length
    const cached = this.#snapshots.get(sessionId)
    if (cached !== undefined && cached.version === currentVersion) {
      // re-sync #versions if it drifted (e.g. after restart or cross-process write)
      this.#versions.set(sessionId, currentVersion)
      return cached.session
    }

    const session = rehydrate(rows.map((r) => parseEvent(r.event)))
    if (session === null) throw new Error(`rehydrate returned null for non-empty rows: ${sessionId}`)
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
    try {
      await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<VersionRow>(
          `SELECT version FROM session_events
           WHERE tenant_id = $1 AND session_id = $2
           ORDER BY version DESC LIMIT 1${ROW_LOCK_CLAUSE(this.#db.dialect)}`,
          [this.#tenantId, sessionId]
        )
        const actual = rows[0]?.version ?? 0
        if (actual !== expectedVersion) {
          throw new VersionConflictError(sessionId, expectedVersion, actual)
        }

        const { rows: eventRows } = await tx.query<EventRow>(
          `SELECT event FROM session_events
           WHERE tenant_id = $1 AND session_id = $2
           ORDER BY version`,
          [this.#tenantId, sessionId]
        )
        const current = eventRows.length > 0 ? rehydrate(eventRows.map((r) => parseEvent(r.event))) : null

        let version = actual
        for (const delta of mutator(current)) {
          version += 1
          const event: SessionEvent = { ...delta, sessionId }
          await tx.query(
            `INSERT INTO session_events (tenant_id, session_id, version, correlation_id, at, event)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [this.#tenantId, sessionId, version, event.correlationId, event.at, JSON.stringify(event)]
          )
          // Maintain sessions directory for each delta (same logic as append)
          await this.projectDirectory(tx, event, sessionId)
        }
      })
      // Invalidate snapshot cache after successful commit (mirrors append)
      this.#snapshots.delete(sessionId)
      this.#versions.delete(sessionId)
    } catch (err) {
      // A brand-new session has no row to lock, so two first writers can both
      // compute version 1 and collide on the UNIQUE constraint — surface the
      // typed rejection the contract promises instead of a raw unique violation.
      if (isUniqueViolation(err)) {
        const { rows } = await this.db.query<VersionRow>(
          `SELECT COALESCE(MAX(version), 0) AS version FROM session_events
           WHERE tenant_id = $1 AND session_id = $2`,
          [this.#tenantId, sessionId]
        )
        throw new VersionConflictError(sessionId, expectedVersion, rows[0]?.version ?? 0)
      }
      throw err
    }
  }

  /**
   * List applies the filters in SQL (bound parameters only — the task-rest
   * route never concatenates), then rehydrates the matching sessions from their
   * event rows. When `projectId` is provided, uses the sessions directory
   * for a fast project-scoped listing.
   */
  async list(filter: SessionFilter): Promise<SessionList> {
    if (filter.projectId) {
      return this.listByProject(filter)
    }
    return this.listAll(filter)
  }

  private async listByProject(filter: SessionFilter): Promise<SessionList> {
    const projectId = filter.projectId!
    const { status, since } = normalizeFilter(filter)
    // RDS needs the casts to infer null filter types; SQLite rejects `::`.
    const textCast = this.#db.dialect === 'postgres' ? '::text' : ''
    const tsCast = this.#db.dialect === 'postgres' ? '::timestamptz' : ''

    const [countRes, pageRes] = await Promise.all([
      this.db.query<{ total: number }>(
        `SELECT count(*) AS total FROM sessions
         WHERE tenant_id = $1 AND project_id = $2
           AND ($3${textCast} IS NULL OR status = $3${textCast})
           AND ($4${tsCast} IS NULL OR created_at >= $4${tsCast})`,
        [this.#tenantId, projectId, status, since]
      ),
      this.db.query<SessionDirectoryRow>(
        `SELECT session_id, project_id, title, status, created_at FROM sessions
         WHERE tenant_id = $1 AND project_id = $2
           AND ($3${textCast} IS NULL OR status = $3${textCast})
           AND ($4${tsCast} IS NULL OR created_at >= $4${tsCast})
         ORDER BY created_at DESC
         LIMIT $5 OFFSET $6`,
        [this.#tenantId, projectId, status, since, filter.limit, filter.offset]
      ),
    ])

    const ids = pageRes.rows.map((r) => r.session_id)
    const total = Number(countRes.rows[0]?.total ?? 0)
    if (ids.length === 0) return { sessions: [], total }

    return this.fetchAndRehydrate(ids, total)
  }

  private async listAll(filter: SessionFilter): Promise<SessionList> {
    const { status, since } = normalizeFilter(filter)

    const [countRes, pageRes] = await Promise.all([
      this.db.query<{ total: number }>(
        `${rankedSessionCte(this.#db.dialect)} SELECT count(*) AS total FROM ranked${rankedMatchClause(this.#db.dialect)}`,
        [this.#tenantId, status, since]
      ),
      this.db.query<{ sessionId: string }>(
        `${rankedSessionCte(this.#db.dialect)} SELECT session_id AS "sessionId" FROM ranked${rankedMatchClause(this.#db.dialect)} ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
        [this.#tenantId, status, since, filter.limit, filter.offset]
      ),
    ])

    const ids = pageRes.rows.map((r) => r.sessionId)
    const total = Number(countRes.rows[0]?.total ?? 0)
    if (ids.length === 0) return { sessions: [], total }

    return this.fetchAndRehydrate(ids, total)
  }

  private async fetchAndRehydrate(ids: string[], totalOverride?: number): Promise<SessionList> {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ')
    const { rows } = await this.db.query<EventRow>(
      `SELECT session_id AS "sessionId", event FROM session_events
       WHERE tenant_id = $1 AND session_id IN (${placeholders})
       ORDER BY session_id, version`,
      [this.#tenantId, ...ids]
    )
    const bySession = new Map<string, SessionEvent[]>()
    for (const row of rows) {
      if (row.sessionId === undefined) continue
      const events = bySession.get(row.sessionId) ?? []
      events.push(parseEvent(row.event))
      bySession.set(row.sessionId, events)
    }
    const sessions = [...bySession.values()]
      .map((events) => rehydrate(events))
      .filter((s): s is Session => s !== null)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    return { sessions, total: totalOverride ?? ids.length }
  }

  async listProjects(): Promise<Project[]> {
    const { rows } = await this.db.query<ProjectRow>(
      `SELECT id, name, created_at FROM projects
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [this.#tenantId]
    )
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }))
  }

  async getProject(id: string): Promise<Project | null> {
    const { rows } = await this.db.query<ProjectRow>(
      `SELECT id, name, created_at FROM projects
       WHERE tenant_id = $1 AND id = $2`,
      [this.#tenantId, id]
    )
    if (rows.length === 0) return null
    return { id: rows[0].id, name: rows[0].name, createdAt: rows[0].created_at }
  }

  async createProject(id: string, name: string): Promise<Project> {
    const at = new Date().toISOString()
    await this.db.query(
      `INSERT INTO projects (tenant_id, id, name, created_at)
       VALUES ($1, $2, $3, $4)`,
      [this.#tenantId, id, name, at]
    )
    return { id, name, createdAt: at }
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `DELETE FROM projects WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [this.#tenantId, id]
      )
      if (rows.length === 0) return false
      await tx.query(`DELETE FROM project_members WHERE tenant_id = $1 AND project_id = $2`, [this.#tenantId, id])
      await tx.query(`DELETE FROM project_invites WHERE tenant_id = $1 AND project_id = $2`, [this.#tenantId, id])
      await tx.query(`DELETE FROM notifications WHERE tenant_id = $1 AND session_id IN (SELECT session_id FROM sessions WHERE tenant_id = $1 AND project_id = $2)`, [this.#tenantId, id])
      // Delete events by session_id — projectId only lives on session.created, so direct
      // event->>'projectId' leaves orphans. Collect session_ids first, then delete events, then directory.
      await tx.query(
        `DELETE FROM session_events WHERE tenant_id = $1 AND session_id IN (SELECT session_id FROM sessions WHERE tenant_id = $1 AND project_id = $2)`,
        [this.#tenantId, id]
      )
      await tx.query(`DELETE FROM sessions WHERE tenant_id = $1 AND project_id = $2`, [
        this.#tenantId,
        id,
      ])
      return true
    })
  }

  async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
    const { rows } = await this.db.query<{ project_id: string; user_id: string; role: string }>(
      `SELECT project_id, user_id, role FROM project_members WHERE tenant_id = $1 AND project_id = $2`,
      [this.#tenantId, projectId]
    )
    return rows.map((r) => ({ projectId: r.project_id, userId: r.user_id, role: r.role as ProjectRole, tenantId: this.#tenantId }))
  }

  async getProjectMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    const { rows } = await this.db.query<{ project_id: string; user_id: string; role: string }>(
      `SELECT project_id, user_id, role FROM project_members WHERE tenant_id = $1 AND project_id = $2 AND user_id = $3`,
      [this.#tenantId, projectId, userId]
    )
    if (rows.length === 0) return null
    return { projectId: rows[0].project_id, userId: rows[0].user_id, role: rows[0].role as ProjectRole, tenantId: this.#tenantId }
  }

  async setProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMember> {
    await upsertProjectMember(this.db, this.#db.dialect, this.#tenantId, projectId, userId, role)
    return { projectId, userId, role, tenantId: this.#tenantId }
  }

  async removeProjectMember(projectId: string, userId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ user_id: string }>(
      `DELETE FROM project_members WHERE tenant_id = $1 AND project_id = $2 AND user_id = $3 RETURNING user_id`,
      [this.#tenantId, projectId, userId]
    )
    return rows.length > 0
  }

  async setProjectMemberGuarded(
    projectId: string,
    userId: string,
    role: ProjectRole
  ): Promise<{ member: ProjectMember } | { error: 'last-owner' }> {
    // Upsert then verify ≥1 owner inside one transaction: concurrent demotes
    // serialize, and the throw rolls back the stranding write.
    try {
      const member = await this.db.transaction(async (tx) => {
        await upsertProjectMember(tx, tx.dialect, this.#tenantId, projectId, userId, role)
        const { rows } = await tx.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM project_members WHERE tenant_id = $1 AND project_id = $2 AND role = 'owner'`,
          [this.#tenantId, projectId]
        )
        if (Number(rows[0]?.n ?? 0) === 0) throw LAST_OWNER_ERROR
        return { projectId, userId, role, tenantId: this.#tenantId } as ProjectMember
      })
      return { member }
    } catch (err) {
      if (err === LAST_OWNER_ERROR) return { error: 'last-owner' }
      throw err
    }
  }

  async listProjectInvites(projectId: string): Promise<ProjectInvite[]> {
    const { rows } = await this.db.query<{ id: string; project_id: string; role: string; token_hash: string; expires_at: string | Date; created_by: string }>(
      `SELECT id, project_id, role, token_hash, expires_at, created_by FROM project_invites
       WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [this.#tenantId, projectId]
    )
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      role: r.role as ProjectRole,
      tokenHash: r.token_hash,
      expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
      createdBy: r.created_by,
      tenantId: this.#tenantId,
    }))
  }

  async createProjectInvite(invite: ProjectInvite): Promise<ProjectInvite> {
    await this.db.query(
      `INSERT INTO project_invites (tenant_id, id, project_id, role, token_hash, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [this.#tenantId, invite.id, invite.projectId, invite.role, invite.tokenHash, invite.expiresAt, invite.createdBy ?? '']
    )
    return { ...invite, tenantId: this.#tenantId }
  }

  async getProjectInviteByTokenHash(tokenHash: string): Promise<ProjectInvite | null> {
    const { rows } = await this.db.query<{ id: string; project_id: string; role: string; token_hash: string; expires_at: string | Date; created_by: string }>(
      `SELECT id, project_id, role, token_hash, expires_at, created_by FROM project_invites WHERE tenant_id = $1 AND token_hash = $2`,
      [this.#tenantId, tokenHash]
    )
    if (rows.length === 0) return null
    const r = rows[0]
    const expiresAt = r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at)
    return { id: r.id, projectId: r.project_id, role: r.role as ProjectRole, tokenHash: r.token_hash, expiresAt, createdBy: r.created_by, tenantId: this.#tenantId }
  }

  async deleteProjectInvite(id: string, projectId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `DELETE FROM project_invites WHERE tenant_id = $1 AND id = $2 AND project_id = $3 RETURNING id`,
      [this.#tenantId, id, projectId]
    )
    return rows.length > 0
  }

  async acceptProjectInvite(
    tokenHash: string,
    userId: string
  ): Promise<{ projectId: string; role: ProjectRole } | null> {
    // DELETE..RETURNING consumes the link atomically: exactly one of two
    // concurrent accepts deletes the row. The member upsert joins the same
    // transaction so a failed insert restores the invite.
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ project_id: string; role: string; expires_at: string | Date }>(
        `DELETE FROM project_invites WHERE tenant_id = $1 AND token_hash = $2
         RETURNING project_id, role, expires_at`,
        [this.#tenantId, tokenHash]
      )
      if (rows.length === 0) return null
      const expiresAt = rows[0].expires_at instanceof Date ? rows[0].expires_at.toISOString() : String(rows[0].expires_at)
      if (Date.parse(expiresAt) < Date.now()) return null
      const role = rows[0].role as ProjectRole
      await upsertProjectMember(tx, tx.dialect, this.#tenantId, rows[0].project_id, userId, role)
      return { projectId: rows[0].project_id, role }
    })
  }

  async createNotification(input: NotificationInput): Promise<Notification> {
    const createdAt = new Date().toISOString()
    await this.db.query(
      `INSERT INTO notifications (tenant_id, id, user_id, session_id, kind, excerpt, read_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
      [this.#tenantId, input.id, input.userId, input.sessionId, input.kind, input.excerpt.slice(0, 280), createdAt]
    )
    return { ...input, excerpt: input.excerpt.slice(0, 280), readAt: null, createdAt, tenantId: this.#tenantId }
  }

  async listNotifications(userId: string, filter: { unreadOnly?: boolean; limit: number; offset: number }): Promise<{ notifications: Notification[]; total: number }> {
    const cond = filter.unreadOnly ? 'AND read_at IS NULL' : ''
    const { rows } = await this.db.query<{ id: string; user_id: string; session_id: string; kind: string; excerpt: string; read_at: string | Date | null; created_at: string | Date }>(
      `SELECT id, user_id, session_id, kind, excerpt, read_at, created_at FROM notifications WHERE tenant_id = $1 AND user_id = $2 ${cond} ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [this.#tenantId, userId, filter.limit, filter.offset]
    )
    const { rows: totalRows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE tenant_id = $1 AND user_id = $2 ${cond}`,
      [this.#tenantId, userId]
    )
    return {
      notifications: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        sessionId: r.session_id,
        kind: r.kind as Notification['kind'],
        excerpt: r.excerpt,
        readAt: r.read_at === null ? null : (r.read_at instanceof Date ? r.read_at.toISOString() : String(r.read_at)),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        tenantId: this.#tenantId,
      })),
      total: Number(totalRows[0]?.count ?? 0),
    }
  }

  async countUnread(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [this.#tenantId, userId]
    )
    return Number(rows[0]?.count ?? 0)
  }

  async countUnreadBySession(userId: string): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ session_id: string; count: string }>(
      `SELECT session_id, COUNT(*) AS count FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL GROUP BY session_id`,
      [this.#tenantId, userId]
    )
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.session_id] = Number(r.count)
    return counts
  }

  async markNotificationRead(id: string, userId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM notifications WHERE tenant_id = $1 AND id = $2 AND user_id = $3`,
      [this.#tenantId, id, userId]
    )
    if (rows.length === 0) return false
    await this.db.query(
      `UPDATE notifications SET read_at = $1 WHERE tenant_id = $2 AND id = $3 AND read_at IS NULL`,
      [new Date().toISOString(), this.#tenantId, id]
    )
    return true
  }

  async listAgents(): Promise<CustomAgent[]> {
    const { rows } = await this.db.query<{ name: string; display_name: string; persona: string; base_member: string; provider: string | null; model: string | null }>(
      `SELECT name, display_name, persona, base_member, provider, model FROM agents WHERE tenant_id = $1 ORDER BY name ASC`,
      [this.#tenantId]
    )
    return rows.map((r) => ({
      name: r.name,
      displayName: r.display_name,
      persona: r.persona,
      baseMember: r.base_member,
      ...(r.provider !== null ? { provider: r.provider } : {}),
      ...(r.model !== null ? { model: r.model } : {}),
      tenantId: this.#tenantId,
    }))
  }

  async getAgent(name: string): Promise<CustomAgent | null> {
    const { rows } = await this.db.query<{ name: string; display_name: string; persona: string; base_member: string; provider: string | null; model: string | null }>(
      `SELECT name, display_name, persona, base_member, provider, model FROM agents WHERE tenant_id = $1 AND name = $2`,
      [this.#tenantId, name]
    )
    if (rows.length === 0) return null
    const r = rows[0]
    return {
      name: r.name,
      displayName: r.display_name,
      persona: r.persona,
      baseMember: r.base_member,
      ...(r.provider !== null ? { provider: r.provider } : {}),
      ...(r.model !== null ? { model: r.model } : {}),
      tenantId: this.#tenantId,
    }
  }

  async createAgent(input: CustomAgentInput): Promise<CustomAgent> {
    try {
      await this.db.query(
        `INSERT INTO agents (tenant_id, name, display_name, persona, base_member, provider, model) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [this.#tenantId, input.name, input.displayName ?? input.name, input.persona, input.baseMember, input.provider ?? null, input.model ?? null]
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(`agent '${input.name}' already exists`, { cause: err })
      throw err
    }
    return (await this.getAgent(input.name))!
  }

  async updateAgent(name: string, patch: { displayName?: string; persona?: string; baseMember?: string; provider?: string; model?: string }): Promise<CustomAgent | null> {
    const current = await this.getAgent(name)
    if (!current) return null
    await this.db.query(
      `UPDATE agents SET display_name = $1, persona = $2, base_member = $3, provider = $4, model = $5, updated_at = $6 WHERE tenant_id = $7 AND name = $8`,
      [
        patch.displayName ?? current.displayName,
        patch.persona ?? current.persona,
        patch.baseMember ?? current.baseMember,
        patch.provider ?? current.provider ?? null,
        patch.model ?? current.model ?? null,
        new Date().toISOString(),
        this.#tenantId,
        name,
      ]
    )
    return this.getAgent(name)
  }

  async deleteAgent(name: string): Promise<boolean> {
    const { rows } = await this.db.query<{ name: string }>(
      `DELETE FROM agents WHERE tenant_id = $1 AND name = $2 RETURNING name`,
      [this.#tenantId, name]
    )
    return rows.length > 0
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.#exitBuffers.delete(sessionId)
    this.#snapshots.delete(sessionId)
    this.#versions.delete(sessionId)
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM session_events WHERE tenant_id = $1 AND session_id = $2`, [
        this.#tenantId,
        sessionId,
      ])
      await tx.query(`DELETE FROM sessions WHERE tenant_id = $1 AND session_id = $2`, [
        this.#tenantId,
        sessionId,
      ])
    })
  }

  async saveCheckpoint(id: string, sessionId: string, data: string): Promise<void> {
    await this.#insertCheckpointRow(id, sessionId, 'full', data)
  }

  async saveCheckpointDelta(id: string, sessionId: string, data: string): Promise<void> {
    await this.#insertCheckpointRow(id, sessionId, 'delta', data)
  }

  async #insertCheckpointRow(id: string, sessionId: string, kind: 'full' | 'delta', data: string): Promise<void> {
    // rows chain by (id, step); step numbering is read-then-insert, so two
    // writers of one id can compute the same step — the unique violation
    // is the guard: fail the read, recompute, retry, and only give up after
    // sustained contention
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { rows } = await this.db.query<{ next: number }>(
        `SELECT COALESCE(MAX(step), -1) + 1 AS next FROM run_checkpoints WHERE tenant_id = $1 AND id = $2`,
        [this.#tenantId, id]
      )
      const step = Number(rows[0]?.next ?? 0)
      try {
        await this.db.query(
          `INSERT INTO run_checkpoints (tenant_id, id, session_id, kind, step, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [this.#tenantId, id, sessionId, kind, step, data, new Date().toISOString()]
        )
        return
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
      }
    }
    throw new Error(`checkpoint step contention for ${id}; too many concurrent writers`)
  }

  async loadCheckpoint(id: string): Promise<{ sessionId: string; data: string } | null> {
    const { rows } = await this.db.query<{ session_id: string; kind: string; data: string }>(
      `SELECT session_id, kind, data FROM run_checkpoints
       WHERE tenant_id = $1 AND id = $2
       ORDER BY step ASC`,
      [this.#tenantId, id]
    )
    if (rows.length === 0) return null
    const sessionId = rows[0].session_id
    const value = reconstructRows(
      rows.map((r) => ({ kind: r.kind === 'delta' ? 'delta' : 'full', step: 0, data: r.data })),
    )
    if (value === null) return null
    return { sessionId, data: JSON.stringify(value) }
  }

  async getDeltaChannelHistory(id: string): Promise<Array<{ kind: 'full' | 'delta'; step: number; bytes: number }>> {
    const { rows } = await this.db.query<{ kind: string; step: number; bytes: number }>(
      `SELECT kind, step, LENGTH(data) AS bytes FROM run_checkpoints
       WHERE tenant_id = $1 AND id = $2
       ORDER BY step ASC`,
      [this.#tenantId, id]
    )
    return rows.map((r) => ({ kind: r.kind === 'delta' ? 'delta' : 'full', step: Number(r.step), bytes: Number(r.bytes) }))
  }

  async deleteCheckpoint(id: string): Promise<void> {
    await this.db.query(`DELETE FROM run_checkpoints WHERE tenant_id = $1 AND id = $2`, [
      this.#tenantId,
      id,
    ])
  }

  async recordCostUsage(row: CostUsageRow): Promise<void> {
    await this.#db.query(
      `INSERT INTO daily_cost_buckets (tenant_id, day, agent, model, prompt_tokens, completion_tokens, step_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, day, agent, model) DO UPDATE SET
         prompt_tokens = daily_cost_buckets.prompt_tokens + EXCLUDED.prompt_tokens,
         completion_tokens = daily_cost_buckets.completion_tokens + EXCLUDED.completion_tokens,
         step_cost = daily_cost_buckets.step_cost + EXCLUDED.step_cost`,
      [this.#tenantId, row.day, row.agent, row.model, row.promptTokens, row.completionTokens, row.stepCost]
    )
  }

  async listDailyCost(filter: DailyCostFilter): Promise<CostUsageRow[]> {
    // Same untyped-parameter issue as the list filters: RDS cannot infer $2/$3.
    const textCast = this.#db.dialect === 'postgres' ? '::text' : ''
    const { rows } = await this.#db.query<{
      day: string
      agent: string
      model: string
      prompt_tokens: number
      completion_tokens: number
      step_cost: number
    }>(
      `SELECT day, agent, model, prompt_tokens, completion_tokens, step_cost FROM daily_cost_buckets
       WHERE tenant_id = $1
         AND ($2${textCast} IS NULL OR day >= $2${textCast})
         AND ($3${textCast} IS NULL OR day <= $3${textCast})
       ORDER BY day ASC`,
      [this.#tenantId, filter.since ?? null, filter.until ?? null]
    )
    return rows.map((r) => ({
      day: r.day,
      agent: r.agent,
      model: r.model,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      stepCost: r.step_cost,
    }))
  }
}

/** Ranked rows carry each session's latest status-bearing event type and
 * first-event `at`. Chat/steer never move the lifecycle, so they are excluded
 * from the ranking — otherwise a trailing message would hide the session from
 * every status filter. */
function jsonExtract(dialect: Db['dialect'], field: string, path: string): string {
  // Postgres `->>` takes an unqualified key; SQLite json_extract takes the path.
  return dialect === 'postgres'
    ? `${field}->>'${path.replace(/^\$\./, '')}'`
    : `json_extract(${field}, '${path}')`
}

/** Serialize concurrent first-writers on the version SELECT. Postgres uses a
 * row lock; SQLite is single-writer so the clause is noise there. */
function ROW_LOCK_CLAUSE(dialect: Db['dialect']): string {
  return dialect === 'postgres' ? ' FOR UPDATE' : ''
}

function rankedSessionCte(dialect: Db['dialect']): string {
  const typeExpr = jsonExtract(dialect, 'event', '$.type')
  const atExpr = jsonExtract(dialect, 'e2.event', '$.at')
  return `
    WITH ranked AS (
      SELECT tenant_id, session_id, ${typeExpr} AS last_type,
        (SELECT ${atExpr} FROM session_events e2
          WHERE e2.tenant_id = se.tenant_id AND e2.session_id = se.session_id
          ORDER BY e2.version ASC LIMIT 1) AS created_at,
        ROW_NUMBER() OVER (PARTITION BY tenant_id, session_id ORDER BY version DESC) AS rn
      FROM session_events se
      WHERE tenant_id = $1
        AND ${typeExpr} NOT IN (${STATUS_PRESERVING_SQL})
    )`
}

/** Row-selection predicate shared by the count and page queries. */
function rankedMatchClause(dialect: Db['dialect']): string {
  // Explicit casts: Postgres cannot infer a parameter used only in an IS NULL
  // branch, and the RDS planner rejects the untyped query. The ranked CTE's
  // created_at is text (event timestamps), so the since filter stays text.
  const textCast = dialect === 'postgres' ? '::text' : ''
  return `
    WHERE rn = 1
      AND ($2${textCast} IS NULL
           OR last_type = 'session.' || $2${textCast}
           OR ($2${textCast} = 'queued' AND last_type = 'session.created'))
      AND ($3${textCast} IS NULL OR created_at >= $3${textCast})`
}

function normalizeFilter(filter: SessionFilter): { status: string | null; since: string | null } {
  return {
    status: filter.status ?? null,
    // The ranked CTE compares created_at as text: canonical UTC keeps that
    // text order equal to time order for any accepted offset.
    since: filter.since ? new Date(filter.since).toISOString() : null,
  }
}
