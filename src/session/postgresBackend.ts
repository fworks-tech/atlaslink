import type { Session, SessionEvent, SessionDelta, SessionSnapshot, Project } from './types'
import { VersionConflictError } from './types'
import { rehydrate } from './sessionStore'
import { deepFreeze } from './deepFreeze'
import type { SessionBackend, SessionFilter, SessionList } from './sessionBackend'
import type { Db } from './db'
import { DEFAULT_TENANT_ID } from './migrations'

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

  #cachedSnapshot(sessionId: string): Session | null {
    const version = this.#versions.get(sessionId)
    if (version === undefined) return null
    const snap = this.#snapshots.get(sessionId)
    return snap !== undefined && snap.version === version ? snap.session : null
  }

  constructor(
    private readonly db: Db,
    private readonly tenantId: string = DEFAULT_TENANT_ID
  ) {}

  async append(event: SessionEvent): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<VersionRow>(
        `SELECT version FROM session_events
         WHERE tenant_id = $1 AND session_id = $2
         ORDER BY version DESC LIMIT 1
         FOR UPDATE`,
        [this.tenantId, event.sessionId]
      )
      const next = (rows[0]?.version ?? 0) + 1
      await tx.query(
        `INSERT INTO session_events (tenant_id, session_id, version, correlation_id, at, event)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.tenantId, event.sessionId, next, event.correlationId, event.at, JSON.stringify(event)]
      )

      // Maintain the sessions directory projection (transactionally consistent with event commit)
      if (event.type === 'session.created' && event.projectId) {
        const title = (event.prompt ?? event.sessionId).slice(0, 500)
        await tx.query(
          `INSERT INTO sessions (tenant_id, session_id, project_id, title, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'queued', $5, $5)
           ON CONFLICT (tenant_id, session_id) DO UPDATE SET
             project_id = EXCLUDED.project_id,
             title = EXCLUDED.title,
             updated_at = EXCLUDED.updated_at`,
          [this.tenantId, event.sessionId, event.projectId, title, event.at]
        )
      } else if (event.type !== 'session.created') {
        // status mapping is exhaustive; unknown types fail-fast to surface new SessionEvent variants
        const statusMap: Record<string, string> = {
          'session.running': 'running',
          'session.succeeded': 'succeeded',
          'session.failed': 'failed',
          'session.cancelled': 'cancelled',
        }
        const status = statusMap[event.type]
        if (!status) throw new Error(`unknown session event type for directory projection: ${event.type}`)
        // For sessions not in the directory (no projectId), this UPDATE is a no-op
        // but still touches the index; acceptable for expected scale (<1k sessions/project).
        await tx.query(
          `UPDATE sessions SET status = $3, updated_at = $4
           WHERE tenant_id = $1 AND session_id = $2`,
          [this.tenantId, event.sessionId, status, event.at]
        )
      }
    })
    this.#snapshots.delete(event.sessionId)
    const prev = this.#versions.get(event.sessionId) ?? 0
    this.#versions.set(event.sessionId, prev + 1)
  }

  async get(sessionId: string): Promise<Session | null> {
    const hit = this.#cachedSnapshot(sessionId)
    if (hit !== null) return hit

    const { rows } = await this.db.query<EventRow>(
      `SELECT event FROM session_events
       WHERE tenant_id = $1 AND session_id = $2
       ORDER BY version`,
      [this.tenantId, sessionId]
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
           ORDER BY version DESC LIMIT 1
           FOR UPDATE`,
          [this.tenantId, sessionId]
        )
        const actual = rows[0]?.version ?? 0
        if (actual !== expectedVersion) {
          throw new VersionConflictError(sessionId, expectedVersion, actual)
        }

        const { rows: eventRows } = await tx.query<EventRow>(
          `SELECT event FROM session_events
           WHERE tenant_id = $1 AND session_id = $2
           ORDER BY version`,
          [this.tenantId, sessionId]
        )
        const current = eventRows.length > 0 ? rehydrate(eventRows.map((r) => parseEvent(r.event))) : null

        let version = actual
        for (const delta of mutator(current)) {
          version += 1
          const event: SessionEvent = { ...delta, sessionId }
          await tx.query(
            `INSERT INTO session_events (tenant_id, session_id, version, correlation_id, at, event)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [this.tenantId, sessionId, version, event.correlationId, event.at, JSON.stringify(event)]
          )
          // Maintain sessions directory for each delta (same logic as append)
          if (event.type === 'session.created' && (event as SessionEvent).projectId) {
            const title = ((event as SessionEvent).prompt ?? sessionId).slice(0, 500)
            await tx.query(
              `INSERT INTO sessions (tenant_id, session_id, project_id, title, status, created_at, updated_at)
               VALUES ($1, $2, $3, $4, 'queued', $5, $5)
               ON CONFLICT (tenant_id, session_id) DO UPDATE SET
                 project_id = EXCLUDED.project_id,
                 title = EXCLUDED.title,
                 updated_at = EXCLUDED.updated_at`,
              [this.tenantId, sessionId, (event as SessionEvent).projectId!, title, event.at]
            )
          } else if (event.type !== 'session.created') {
            const statusMap: Record<string, string> = {
              'session.running': 'running',
              'session.succeeded': 'succeeded',
              'session.failed': 'failed',
              'session.cancelled': 'cancelled',
            }
            const status = statusMap[event.type]
            if (!status) throw new Error(`unknown session event type for directory projection: ${event.type}`)
            await tx.query(
              `UPDATE sessions SET status = $3, updated_at = $4
               WHERE tenant_id = $1 AND session_id = $2`,
              [this.tenantId, sessionId, status, event.at]
            )
          }
        }
      })
      // Invalidate snapshot cache after successful commit (mirrors append)
      this.#snapshots.delete(sessionId)
      this.#versions.delete(sessionId)
    } catch (err) {
      // a brand-new session has no row to `FOR UPDATE`, so two first writers can
      // both compute version 1 and collide on the UNIQUE constraint — surface the
      // typed rejection the contract promises instead of a raw unique violation
      if ((err as { code?: string }).code === '23505') {
        const { rows } = await this.db.query<VersionRow>(
          `SELECT COALESCE(MAX(version), 0) AS version FROM session_events
           WHERE tenant_id = $1 AND session_id = $2`,
          [this.tenantId, sessionId]
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

    const [countRes, pageRes] = await Promise.all([
      this.db.query<{ total: number }>(
        `SELECT count(*) AS total FROM sessions
         WHERE tenant_id = $1 AND project_id = $2
           AND ($3::text IS NULL OR status = $3)
           AND ($4::text IS NULL OR created_at >= $4::timestamptz)`,
        [this.tenantId, projectId, status, since]
      ),
      this.db.query<SessionDirectoryRow>(
        `SELECT session_id, project_id, title, status, created_at FROM sessions
         WHERE tenant_id = $1 AND project_id = $2
           AND ($3::text IS NULL OR status = $3)
           AND ($4::text IS NULL OR created_at >= $4::timestamptz)
         ORDER BY created_at DESC
         LIMIT $5 OFFSET $6`,
        [this.tenantId, projectId, status, since, filter.limit, filter.offset]
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
        `${rankedSessionCte()} SELECT count(*) AS total FROM ranked${rankedMatchClause()}`,
        [this.tenantId, status, since]
      ),
      this.db.query<{ sessionId: string }>(
        `${rankedSessionCte()} SELECT session_id AS "sessionId" FROM ranked${rankedMatchClause()} ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
        [this.tenantId, status, since, filter.limit, filter.offset]
      ),
    ])

    const ids = pageRes.rows.map((r) => r.sessionId)
    const total = Number(countRes.rows[0]?.total ?? 0)
    if (ids.length === 0) return { sessions: [], total }

    return this.fetchAndRehydrate(ids, total)
  }

  private async fetchAndRehydrate(ids: string[], totalOverride?: number): Promise<SessionList> {
    const { rows } = await this.db.query<EventRow>(
      `SELECT session_id AS "sessionId", event FROM session_events
       WHERE tenant_id = $1 AND session_id = ANY($2::text[])
       ORDER BY session_id, version`,
      [this.tenantId, ids]
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
      [this.tenantId]
    )
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }))
  }

  async getProject(id: string): Promise<Project | null> {
    const { rows } = await this.db.query<ProjectRow>(
      `SELECT id, name, created_at FROM projects
       WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, id]
    )
    if (rows.length === 0) return null
    return { id: rows[0].id, name: rows[0].name, createdAt: rows[0].created_at }
  }

  async createProject(id: string, name: string): Promise<Project> {
    const at = new Date().toISOString()
    await this.db.query(
      `INSERT INTO projects (tenant_id, id, name, created_at)
       VALUES ($1, $2, $3, $4)`,
      [this.tenantId, id, name, at]
    )
    return { id, name, createdAt: at }
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `DELETE FROM projects WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [this.tenantId, id]
      )
      if (rows.length === 0) return false
      await tx.query(`DELETE FROM sessions WHERE tenant_id = $1 AND project_id = $2`, [
        this.tenantId,
        id,
      ])
      await tx.query(
        `DELETE FROM session_events WHERE tenant_id = $1 AND (event->>'projectId') = $2`,
        [this.tenantId, id]
      )
      return true
    })
  }
}

/** Ranked rows carry each session's latest event type and first-event `at`. */
function rankedSessionCte(): string {
  return `
    WITH ranked AS (
      SELECT tenant_id, session_id, (event->>'type')::text AS last_type,
        (SELECT (e2.event->>'at') FROM session_events e2
          WHERE e2.tenant_id = se.tenant_id AND e2.session_id = se.session_id
          ORDER BY e2.version ASC LIMIT 1) AS created_at,
        ROW_NUMBER() OVER (PARTITION BY tenant_id, session_id ORDER BY version DESC) AS rn
      FROM session_events se
      WHERE tenant_id = $1
    )`
}

/** Row-selection predicate shared by the count and page queries. */
function rankedMatchClause(): string {
  return `
    WHERE rn = 1
      AND ($2::text IS NULL
           OR last_type = 'session.' || $2
           OR ($2 = 'queued' AND last_type = 'session.created'))
      AND ($3::text IS NULL OR created_at >= $3)`
}

function normalizeFilter(filter: SessionFilter): { status: string | null; since: string | null } {
  return { status: filter.status ?? null, since: filter.since ?? null }
}
