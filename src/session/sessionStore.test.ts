import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rehydrate, SessionStore, StreamIntegrityError, VersionConflictError } from './sessionStore'
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

test('rehydrate returns null for an empty event stream', () => {
  assert.equal(rehydrate([]), null)
})

test('rehydrate rebuilds the current aggregate and bumps version per event', () => {
  const running: SessionEvent = { type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' }
  const done: SessionEvent = { type: 'session.succeeded', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:02Z', output: 'ok', durationMs: 1000 }

  const s = rehydrate([created, running, done])

  assert.ok(s)
  assert.equal(s.sessionId, 'ses-1')
  assert.equal(s.correlationId, 'cor-1')
  assert.equal(s.status, 'succeeded')
  assert.equal(s.version, 3)
  assert.equal(s.task.member, 'the-architect')
  assert.equal(s.task.prompt, 'plan x')
  assert.equal(s.tweaks?.provider, 'groq')
  assert.equal(s.output, 'ok')
  assert.equal(s.durationMs, 1000)
  assert.equal(s.createdAt, '2026-01-01T00:00:00Z')
  assert.equal(s.startedAt, '2026-01-01T00:00:01Z')
  assert.equal(s.finishedAt, '2026-01-01T00:00:02Z')
})

test('rehydrate throws StreamIntegrityError when the stream is inconsistent', () => {
  const stray: SessionEvent = { type: 'session.running', sessionId: 'ses-2', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' }
  assert.throws(() => rehydrate([created, stray]), (e) => e instanceof StreamIntegrityError)
})

test('SessionStore: append then get returns the rehydrated aggregate', async () => {
  const store = new SessionStore()
  await store.append(created)
  await store.append({ type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' })

  const s = await store.get('ses-1')
  assert.ok(s)
  assert.equal(s.status, 'running')
  assert.equal(s.version, 2)
})

test('SessionStore: get returns null for an unknown session', async () => {
  const store = new SessionStore()
  assert.equal(await store.get('ses-unknown'), null)
})

test('SessionStore: a stale optimistic write is rejected with VersionConflictError', async () => {
  const store = new SessionStore()
  await store.append(created) // version -> 1

  // a concurrent writer moves the store forward
  await store.append({ type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' }) // version -> 2

  // this writer still believes the version is 1 and tries to commit
  await assert.rejects(
    store.readModifyWrite('ses-1', 1, () => [
      { type: 'session.cancelled', correlationId: 'cor-1', at: '2026-01-01T00:00:03Z' },
    ]),
    (e) => e instanceof VersionConflictError
  )
})

test('SessionStore: readModifyWrite commits the delta and bumps the version', async () => {
  const store = new SessionStore()
  await store.append(created) // version -> 1

  await store.readModifyWrite('ses-1', 1, () => [
    { type: 'session.cancelled', correlationId: 'cor-1', at: '2026-01-01T00:00:03Z' },
  ])

  const s = await store.get('ses-1')
  assert.ok(s)
  assert.equal(s.status, 'cancelled')
  assert.equal(s.version, 2)
})

test('SessionStore: concurrent writers cannot both commit the same version', async () => {
  const store = new SessionStore()
  await store.append(created) // version -> 1

  const results = await Promise.allSettled([
    store.readModifyWrite('ses-1', 1, () => [
      { type: 'session.running', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' },
    ]),
    store.readModifyWrite('ses-1', 1, () => [
      { type: 'session.cancelled', correlationId: 'cor-1', at: '2026-01-01T00:00:02Z' },
    ]),
  ])

  const rejected = results.filter((r) => r.status === 'rejected')
  assert.equal(rejected.length, 1)
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof VersionConflictError)

  const s = await store.get('ses-1')
  assert.ok(s)
  assert.equal(s.version, 2)
})