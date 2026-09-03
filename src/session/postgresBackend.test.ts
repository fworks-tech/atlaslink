import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { PgliteDb, type Db } from './db'
import { migrations, runMigrations } from './migrations'
import { PostgresBackend } from './postgresBackend'
import { createSessionBackend } from './backendFactory'
import { SessionStore } from './sessionStore'
import { VersionConflictError } from './types'
import { backendContract } from './backendContract'
import type { SessionEvent } from './types'

const created: SessionEvent = {
  type: 'session.created',
  sessionId: 'ses-1',
  correlationId: 'cor-1',
  at: '2026-01-01T00:00:00Z',
  member: 'the-architect',
  prompt: 'plan x',
  tweaks: { provider: 'groq' },
}

const running: SessionEvent = {
  type: 'session.running',
  sessionId: 'ses-1',
  correlationId: 'cor-1',
  at: '2026-01-01T00:00:01Z',
}

async function backendWithMigrations(): Promise<PostgresBackend> {
  const db = new PGlite()
  await runMigrations(new PgliteDb(db))
  return new PostgresBackend(new PgliteDb(db))
}

test('PostgresBackend: trailing message/steer do not move list status', async () => {
  const backend = await backendWithMigrations()
  await backend.append({ ...created })
  await backend.append({ ...running })
  await backend.append({
    type: 'session.message',
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    at: '2026-01-01T00:00:02Z',
    message: 'ping',
  })
  await backend.append({
    type: 'session.steer',
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    at: '2026-01-01T00:00:03Z',
    message: 'steer left',
  })

  const runningList = await backend.list({ status: 'running', limit: 50, offset: 0 })
  assert.deepEqual(
    runningList.sessions.map((s) => s.sessionId),
    ['ses-1']
  )
  const queuedList = await backend.list({ status: 'queued', limit: 50, offset: 0 })
  assert.equal(queuedList.total, 0)

  const s = await backend.get('ses-1')
  assert.ok(s)
  assert.equal(s.status, 'running')
  assert.equal(s.interaction.at(-1)?.content, 'steer left')
})

test('PostgresBackend: user_reply preserves awaiting_input in the directory', async () => {
  const backend = await backendWithMigrations()
  await backend.append({ ...created, projectId: 'proj-1' })
  await backend.append({ ...running })
  await backend.append({
    type: 'session.awaiting_input',
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    at: '2026-01-01T00:00:02Z',
    member: 'the-architect',
    question: { questions: [{ label: 'Ship it?' }] },
  })
  await backend.append({
    type: 'session.user_reply',
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    at: '2026-01-01T00:00:03Z',
    reply: 'yes',
  })

  // the reply must not move the directory row back to queued
  const awaiting = await backend.list({ status: 'awaiting_input', limit: 50, offset: 0 })
  assert.deepEqual(
    awaiting.sessions.map((s) => s.sessionId),
    ['ses-1']
  )
  const queued = await backend.list({ status: 'queued', limit: 50, offset: 0 })
  assert.equal(queued.total, 0)

  const s = await backend.get('ses-1')
  assert.ok(s)
  assert.equal(s.status, 'awaiting_input')
  assert.equal(s.replyCount, 1)
})

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
  assert.deepEqual(tables.map((t) => t.name), ['projects', 'schema_migrations', 'session_events', 'sessions'])
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

test('a unique-violation on first write is surfaced as VersionConflictError', async () => {
  const versionRows = [{ version: 2 }]
  const stubDb: Db = {
    query: async <TRow extends object>() => ({ rows: versionRows as unknown as TRow[] }),
    execRawDdl: async () => {},
    transaction: async () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      })
    },
  }

  await assert.rejects(
    new PostgresBackend(stubDb).readModifyWrite('ses-1', 0, () => [
      { type: 'session.running', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' },
    ]),
    (e: unknown) => {
      assert.ok(e instanceof VersionConflictError)
      assert.equal((e as VersionConflictError).expected, 0)
      assert.equal((e as VersionConflictError).actual, 2)
      return true
    }
  )
})

test('PostgresBackend: the snapshot cache serves the same aggregate until an append', async () => {
  const backend = await backendWithMigrations()
  await backend.append(created)

  const a = await backend.get('ses-1')
  const b = await backend.get('ses-1')
  assert.ok(a && b)
  assert.equal(a, b) // cached reference, no rehydration on the repeat read
  assert.ok(Object.isFrozen(a)) // a caller cannot corrupt the shared snapshot
  assert.ok(Object.isFrozen(a.task))

  await backend.append(running)
  const c = await backend.get('ses-1')
  assert.ok(c)
  assert.notEqual(a, c) // invalidated by the append, rebuilt fresh
  assert.equal(c.status, 'running')
  assert.equal(c.version, 2)
})

test('PostgresBackend: appending to a different session does not invalidate the cache', async () => {
  const backend = await backendWithMigrations()
  await backend.append(created)

  const a = await backend.get('ses-1')
  assert.ok(a)

  // append to a completely different session
  await backend.append({ type: 'session.created', sessionId: 'ses-other', correlationId: 'cor-2', at: '2026-01-01T00:00:00Z', member: 'x', prompt: 'y' })

  const b = await backend.get('ses-1')
  assert.ok(b)
  assert.equal(a, b) // still cached — the append was for ses-other
})