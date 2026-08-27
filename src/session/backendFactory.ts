import { Client } from 'pg'
import { PgDb } from './db'
import { PostgresBackend } from './postgresBackend'
import { runMigrations } from './migrations'
import { SessionStore } from './sessionStore'
import type { SessionBackend } from './sessionBackend'

/**
 * Session backend for the daemon: the in-memory store by default (hermetic,
 * zero setup); Postgres when `ATLASLINK_DATABASE_URL` is set (ADR-006 Decisions
 * 4–5). Migrations run against the target database before the backend is used.
 */
export async function createSessionBackend(): Promise<SessionBackend> {
  const url = process.env.ATLASLINK_DATABASE_URL
  if (!url) return new SessionStore()

  const client = new Client({ connectionString: url })
  await client.connect()
  const db = new PgDb(client, url)
  await runMigrations(db)
  return new PostgresBackend(db)
}