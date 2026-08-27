import type { Session, SessionEvent, SessionDelta } from './types'
import { VersionConflictError } from './types'
import { rehydrate } from './sessionStore'
import type { SessionBackend } from './sessionBackend'
import type { Db } from './db'
import { DEFAULT_TENANT_ID } from './migrations'

interface EventRow {
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
  }

  async get(sessionId: string): Promise<Session | null> {
    const { rows } = await this.db.query<EventRow>(
      `SELECT event FROM session_events
       WHERE tenant_id = $1 AND session_id = $2
       ORDER BY version`,
      [this.tenantId, sessionId]
    )
    if (rows.length === 0) return null
    return rehydrate(rows.map((r) => parseEvent(r.event)))
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
}