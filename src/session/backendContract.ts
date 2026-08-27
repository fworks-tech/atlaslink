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
  })
}