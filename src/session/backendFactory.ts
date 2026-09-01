import { Pool } from 'pg'
import { PgDb } from './db'
import { PostgresBackend } from './postgresBackend'
import { runMigrations } from './migrations'
import { SessionStore } from './sessionStore'
import type { SessionBackend } from './sessionBackend'
import { DEFAULT_TENANT_ID, resolveTenantId } from './tenant'

export { DEFAULT_TENANT_ID }

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
  return new PostgresBackend(db)
}

export async function createSessionBackendForTenant(tenantId: string = DEFAULT_TENANT_ID): Promise<SessionBackend> {
  const base = await createSessionBackend()
  return backendForTenant(base, tenantId)
}

export function backendForTenant(base: SessionBackend, tenantId: string = DEFAULT_TENANT_ID): SessionBackend {
  if (typeof (base as SessionBackend & { withTenant?: (t: string) => SessionBackend }).withTenant === 'function') {
    return (base as SessionBackend & { withTenant: (t: string) => SessionBackend }).withTenant(tenantId)
  }
  return base
}

export function tenantIdFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  return resolveTenantId(headers)
}