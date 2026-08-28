import type { Db } from './db'

export const DEFAULT_TENANT_ID = 'default'

export interface Migration {
  version: number
  name: string
  up: string
}

/**
 * Migration history — standard SQL by design so the same statements run on
 * pglite (hermetic CI) and managed Postgres (ADR-006 Decisions 4–5). Keep the
 * dialect portable: no extensions, no vendor types, no `IF NOT EXISTS` beyond
 * the runner's own guard rails.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'session_events',
    up: `
      CREATE TABLE session_events (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seq BIGSERIAL,
        version INTEGER NOT NULL,
        correlation_id TEXT NOT NULL,
        at TIMESTAMPTZ NOT NULL,
        event JSONB NOT NULL,
        PRIMARY KEY (tenant_id, session_id, seq),
        UNIQUE (tenant_id, session_id, version)
      );
      CREATE INDEX session_events_correlation ON session_events (tenant_id, correlation_id);
    `,
  },
]

// Advisory lock key serializing the migrate loop across processes; two daemons
// booting against a fresh database cannot both apply migration 1 (postgres
// 23505 would crash the loser). pg_advisory_xact_lock releases at commit.
const MIGRATION_LOCK_KEY = 715228429

/**
 * Applies pending migrations in version order inside one transaction guarded by
 * an advisory xact lock. The runner table makes the set idempotent across
 * restarts and lets both drivers share one migration list.
 */
export async function runMigrations(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [MIGRATION_LOCK_KEY])

    await tx.execRawDdl(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      )
    `)

    const { rows } = await tx.query<{ version: number }>(`SELECT version FROM schema_migrations`)
    const applied = new Set(rows.map((r) => r.version))

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      await tx.execRawDdl(migration.up)
      await tx.query(`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, [
        migration.version,
        migration.name,
      ])
    }
  })
}