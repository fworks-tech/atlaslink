import type { Session, SessionEvent, SessionDelta, SessionSnapshot } from './types'
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

function parseEvent(raw: string | SessionEvent): SessionEvent {
  return typeof raw === 'string' ? (JSON.parse(raw) as SessionEvent) : raw
}

/**
 * The `SessionBackend` over Postgres event tables (ADR-006 Decisions 4–5).
 * Event append is the commit; `version` is the optimistic CAS token held inside
 * a `FOR UPDATE` transaction so two writers holding the same `expectedVersion`
 * cannot both commit (the #32 class of bug). `tenant_id` is set per row now so
 * the auth ADR's tenant scoping is additive, not a schema rewrite.
 */
export class PostgresBackend implements SessionBackend {
  #snapshots = new Map<string, SessionSnapshot>()
  #versions = new Map<string, number>()

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
    })
    this.#snapshots.delete(event.sessionId)
    const prev = this.#versions.get(event.sessionId) ?? 0
    this.#versions.set(event.sessionId, prev + 1)
  }

  async get(sessionId: string): Promise<Session | null> {
    const cachedVersion = this.#versions.get(sessionId)
    if (cachedVersion !== undefined) {
      const cached = this.#snapshots.get(sessionId)
      if (cached !== undefined && cached.version === cachedVersion) {
        return cached.session
      }
    }

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
      return cached.session
    }

    const session = rehydrate(rows.map((r) => parseEvent(r.event)))!
    this.#snapshots.set(sessionId, { session: deepFreeze(session), version: currentVersion })
    this.#versions.set(sessionId, currentVersion)
    return session
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
        }
      })
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
   * event rows. The latest event per session decides the status filter; the
   * first event's `at` decides the `since` filter; ordering is newest-first.
   */
  async list(filter: SessionFilter): Promise<SessionList> {
    const status = filter.status ?? null
    const since = filter.since ?? null

    const [countRes, pageRes] = await Promise.all([
      this.db.query<{ total: number }>(
        `${rankedSessionCte()} SELECT count(*)::int AS total FROM ranked${rankedMatchClause()}`,
        [this.tenantId, status, since]
      ),
      this.db.query<{ sessionId: string }>(
        `${rankedSessionCte()} SELECT session_id AS "sessionId" FROM ranked${rankedMatchClause()} ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
        [this.tenantId, status, since, filter.limit, filter.offset]
      ),
    ])

    const ids = pageRes.rows.map((r) => r.sessionId)
    const total = countRes.rows[0]?.total ?? 0
    if (ids.length === 0) return { sessions: [], total }

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
      // the event fetch is ordered by session_id, so re-apply the page order here
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    return { sessions, total }
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