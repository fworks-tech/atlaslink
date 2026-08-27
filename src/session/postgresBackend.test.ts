import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { PgliteDb } from './db'
import { migrations, runMigrations } from './migrations'
import { PostgresBackend } from './postgresBackend'
import { createSessionBackend } from './backendFactory'
import { SessionStore } from './sessionStore'
import { backendContract } from './backendContract'
import type { SessionEvent } from './types'

async function backendWithMigrations(): Promise<PostgresBackend> {
  const db = new PGlite()
  await runMigrations(new PgliteDb(db))
  return new PostgresBackend(new PgliteDb(db))
}

test('migrations apply once and are idempotent on a fresh database', async () => {
  const db = new PGlite()
  const adapter = new PgliteDb(db)
  await runMigrations(adapter)
  await runMigrations(adapter)

  const { rows } = await adapter.query<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`)
  assert.deepEqual(
    rows.map((r) => r.version),
    migrations.map((m) => m.version)
  )

  const { rows: tables } = await adapter.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  )
  assert.deepEqual(tables.map((t) => t.name), ['schema_migrations', 'session_events'])
})

test('session events persist across backend instances (durability over the same database)', async () => {
  const db = new PGlite()
  const adapter = new PgliteDb(db)
  await runMigrations(adapter)

  await new PostgresBackend(adapter).append({
    type: 'session.created',
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    at: '2026-01-01T00:00:00Z',
    member: 'the-architect',
    prompt: 'plan x',
  })

  const s = await new PostgresBackend(adapter).get('ses-1')
  assert.ok(s)
  assert.equal(s.status, 'queued')
  assert.equal(s.version, 1)
})

test('session events are scoped per tenant', async () => {
  const db = new PGlite()
  const adapter = new PgliteDb(db)
  await runMigrations(adapter)

  await new PostgresBackend(adapter, 'tenant-a').append({
    type: 'session.created',
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    at: '2026-01-01T00:00:00Z',
  })

  const fromOtherTenant = await new PostgresBackend(adapter, 'tenant-b').get('ses-1')
  assert.equal(fromOtherTenant, null)
})

test('event payloads round-trip through JSONB unchanged', async () => {
  const db = new PGlite()
  const adapter = new PgliteDb(db)
  await runMigrations(adapter)

  const event: SessionEvent = {
    type: 'session.succeeded',
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    at: '2026-01-01T00:00:02Z',
    output: 'ok',
    durationMs: 1000,
  }
  await new PostgresBackend(adapter).append(event)

  const { rows } = await adapter.query<{ event: string | SessionEvent }>(
    `SELECT event FROM session_events WHERE session_id = 'ses-1'`
  )
  let stored = rows[0].event
  if (typeof stored === 'string') stored = JSON.parse(stored)
  assert.deepEqual(stored, event)
})

backendContract('PostgresBackend satisfies the backend contract', backendWithMigrations)

test('createSessionBackend defaults to the in-memory store without a database URL', async () => {
  const previous = process.env.ATLASLINK_DATABASE_URL
  delete process.env.ATLASLINK_DATABASE_URL
  try {
    const backend = await createSessionBackend()
    assert.ok(backend instanceof SessionStore)
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_DATABASE_URL
    else process.env.ATLASLINK_DATABASE_URL = previous
  }
})