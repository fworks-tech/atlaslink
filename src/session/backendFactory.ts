import { Pool } from 'pg'
import { PgDb } from './db'
import { PostgresBackend } from './postgresBackend'
import { rollbackMigrations, runMigrations } from './migrations'
import { SessionStore } from './sessionStore'
import type { SessionBackend } from './sessionBackend'
import type { DurabilityMode } from './types'
import { DEFAULT_TENANT_ID, resolveTenantId } from './tenant'

export { DEFAULT_TENANT_ID }

function resolveDurability(): DurabilityMode {
  const mode = process.env.ATLASLINK_DURABILITY
  if (mode === 'exit' || mode === 'async' || mode === 'sync') return mode
  return 'sync'
}

/**
 * Rollback escape hatch for operators: `SESSION_MIGRATE_DOWN_TO=<n>` rolls the
 * schema back to version n at boot. Absent = no rollback. Refuses to run in
 * production without the explicit `SESSION_MIGRATE_ALLOW_DOWN=1` second key —
 * rolling back drops tables, so the default is fail-closed.
 */
export function resolveRollbackTarget(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.SESSION_MIGRATE_DOWN_TO
  if (raw === undefined || raw === '') return undefined
  const target = Number(raw)
  if (!Number.isInteger(target) || target < 0) {
    throw new Error(`SESSION_MIGRATE_DOWN_TO must be a non-negative integer, got ${JSON.stringify(raw)}`)
  }
  if (env.NODE_ENV === 'production' && env.SESSION_MIGRATE_ALLOW_DOWN !== '1') {
    throw new Error('refusing schema rollback in production without SESSION_MIGRATE_ALLOW_DOWN=1')
  }
  return target
}

/**
 * Session backend for the daemon: the in-memory store by default (hermetic,
 * zero setup); Postgres when `ATLASLINK_DATABASE_URL` is set (ADR-006 Decisions
 * 4–5). Migrations run against the target database before the backend is used.
 * The pool is process-lifetime (like the NDJSON log handle); pg reaps idle
 * connections on process exit.
 */
export async function createSessionBackend(): Promise<SessionBackend> {
  const url = process.env.ATLASLINK_DATABASE_URL
  if (!url) return new SessionStore()

  const db = new PgDb(new Pool({ connectionString: url }))
  await runMigrations(db)
  const rollbackTo = resolveRollbackTarget()
  if (rollbackTo !== undefined) await rollbackMigrations(db, rollbackTo)
  return new PostgresBackend(db, DEFAULT_TENANT_ID, resolveDurability())
}

export async function createSessionBackendForTenant(tenantId: string = DEFAULT_TENANT_ID): Promise<SessionBackend> {
  const base = await createSessionBackend()
  return backendForTenant(base, tenantId)
}

export function backendForTenant(base: SessionBackend, tenantId: string = DEFAULT_TENANT_ID): SessionBackend {
  return base.withTenant(tenantId)
}

export function tenantIdFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  return resolveTenantId(headers)
}