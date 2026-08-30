import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionBackend } from './sessionBackend'
import { VersionConflictError } from './types'
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

/**
 * The behavioral contract every SessionBackend must satisfy. In-memory
 * SessionStore, EventLogBackend, and PostgresBackend all bind to it so a
 * backend swap cannot silently change observable semantics.
 */
export async function backendContract(name: string, create: () => Promise<SessionBackend>): Promise<void> {
  await test(name, async () => {
    await test('append then get returns the rehydrated aggregate', async () => {
      const store = await create()
      await store.append(created)
      await store.append({ type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' })

      const s = await store.get('ses-1')
      assert.ok(s)
      assert.equal(s.status, 'running')
      assert.equal(s.version, 2)
    })

    await test('get returns null for an unknown session', async () => {
      const store = await create()
      assert.equal(await store.get('ses-unknown'), null)
    })

    await test('a stale optimistic write is rejected with VersionConflictError', async () => {
      const store = await create()
      await store.append(created)

      await store.append({ type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' })

      await assert.rejects(
        store.readModifyWrite('ses-1', 1, () => [
          { type: 'session.cancelled', correlationId: 'cor-1', at: '2026-01-01T00:00:03Z' },
        ]),
        (e) => e instanceof VersionConflictError
      )
    })

    await test('readModifyWrite commits the delta and bumps the version', async () => {
      const store = await create()
      await store.append(created)

      await store.readModifyWrite('ses-1', 1, () => [
        { type: 'session.cancelled', correlationId: 'cor-1', at: '2026-01-01T00:00:03Z' },
      ])

      const s = await store.get('ses-1')
      assert.ok(s)
      assert.equal(s.status, 'cancelled')
      assert.equal(s.version, 2)
    })

    await test('concurrent writers cannot both commit the same version', async () => {
      const store = await create()
      await store.append(created)

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

    await test('list filters by status and since, newest-first, with total before pagination', async () => {
      const store = await create()
      await store.append({
        ...created,
        sessionId: 'ses-a',
        correlationId: 'cor-a',
        at: '2026-01-01T00:00:00Z',
      })
      await store.append({
        ...created,
        sessionId: 'ses-b',
        correlationId: 'cor-b',
        at: '2026-01-02T00:00:00Z',
      })
      await store.append({
        type: 'session.running',
        sessionId: 'ses-b',
        correlationId: 'cor-b',
        at: '2026-01-02T00:00:01Z',
      })

      const all = await store.list({ limit: 50, offset: 0 })
      assert.equal(all.total, 2)
      assert.deepEqual(
        all.sessions.map((s) => s.sessionId),
        ['ses-b', 'ses-a']
      )

      const running = await store.list({ status: 'running', limit: 50, offset: 0 })
      assert.deepEqual(
        running.sessions.map((s) => s.sessionId),
        ['ses-b']
      )

      // 'queued' maps to the session.created event on every backend
      const queued = await store.list({ status: 'queued', limit: 50, offset: 0 })
      assert.deepEqual(
        queued.sessions.map((s) => s.sessionId),
        ['ses-a']
      )

      const since = await store.list({ since: '2026-01-02T00:00:00Z', limit: 50, offset: 0 })
      assert.deepEqual(
        since.sessions.map((s) => s.sessionId),
        ['ses-b']
      )

      const paged = await store.list({ limit: 1, offset: 0 })
      assert.equal(paged.sessions.length, 1)
      assert.equal(paged.total, 2)
    })

    await test('the snapshot cache serves the same frozen reference until an append invalidates it', async () => {
      const store = await create()
      await store.append(created)

      const a = await store.get('ses-1')
      const b = await store.get('ses-1')
      assert.ok(a && b)
      assert.equal(a, b) // cached reference
      assert.ok(Object.isFrozen(a))
      assert.ok(Object.isFrozen(a.task))

      await store.append({ type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' })
      const c = await store.get('ses-1')
      assert.ok(c)
      assert.notEqual(a, c) // invalidated by the append
      assert.equal(c.status, 'running')
      assert.equal(c.version, 2)
    })

    await test('list is not served from the snapshot cache', async () => {
      const store = await create()
      await store.append(created)
      const a = await store.get('ses-1')
      assert.ok(a)

      await store.append({
        type: 'session.created',
        sessionId: 'ses-2',
        correlationId: 'cor-2',
        at: '2026-01-02T00:00:00Z',
        member: 'x',
        prompt: 'y',
      })

      const listed = await store.list({ limit: 50, offset: 0 })
      assert.equal(listed.total, 2)
      const again = await store.get('ses-1')
      assert.ok(again)
      assert.equal(again, a) // ses-1 snapshot still valid
    })

    await test('repeated get on an unknown session stays null', async () => {
      const store = await create()
      assert.equal(await store.get('ses-missing'), null)
      assert.equal(await store.get('ses-missing'), null)
      await store.append({ ...created, sessionId: 'ses-other', correlationId: 'cor-9' })
      assert.equal(await store.get('ses-missing'), null)
    })
  })
}