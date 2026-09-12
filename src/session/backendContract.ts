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

    await test('list filters by projectId, status and since, newest-first, with total before pagination', async () => {
      const store = await create()
      await store.append({
        ...created,
        sessionId: 'ses-a',
        correlationId: 'cor-a',
        at: '2026-01-01T00:00:00Z',
        projectId: 'proj-1',
      })
      await store.append({
        ...created,
        sessionId: 'ses-b',
        correlationId: 'cor-b',
        at: '2026-01-02T00:00:00Z',
        projectId: 'proj-1',
      })
      await store.append({
        type: 'session.running',
        sessionId: 'ses-b',
        correlationId: 'cor-b',
        at: '2026-01-02T00:00:01Z',
      })
      await store.append({
        ...created,
        sessionId: 'ses-c',
        correlationId: 'cor-c',
        at: '2026-01-03T00:00:00Z',
        projectId: 'proj-2',
      })

      const all = await store.list({ limit: 50, offset: 0 })
      assert.equal(all.total, 3)

      const proj1 = await store.list({ projectId: 'proj-1', limit: 50, offset: 0 })
      assert.equal(proj1.total, 2)
      assert.deepEqual(
        proj1.sessions.map((s) => s.sessionId),
        ['ses-b', 'ses-a']
      )

      const proj2 = await store.list({ projectId: 'proj-2', limit: 50, offset: 0 })
      assert.equal(proj2.total, 1)
      assert.equal(proj2.sessions[0].sessionId, 'ses-c')

      const proj1Running = await store.list({ projectId: 'proj-1', status: 'running', limit: 50, offset: 0 })
      assert.equal(proj1Running.total, 1)
      assert.equal(proj1Running.sessions[0].sessionId, 'ses-b')
    })

    await test('concurrent appends all land', async () => {
      const store = await create()
      await store.append(created)

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          store.append({
            type: 'session.message',
            sessionId: 'ses-1',
            correlationId: 'cor-1',
            at: `2026-01-01T00:0${i + 1}:00Z`,
            message: `message-${i}`,
          })
        )
      )

      const s = await store.get('ses-1')
      assert.ok(s)
      assert.equal(s.version, 6)
    })

    await test('a session with many events reconstructs the full history', async () => {
      const store = await create()
      await store.append(created)
      for (let i = 0; i < 100; i++) {
        await store.append({
          type: 'session.message',
          sessionId: 'ses-1',
          correlationId: 'cor-1',
          at: '2026-01-01T00:00:01Z',
          message: `message-${i}`,
        })
      }

      const s = await store.get('ses-1')
      assert.ok(s)
      assert.equal(s.interaction.length, 101)
    })

    await test('deleteSession removes the session from get and list', async () => {
      const store = await create()
      await store.append(created)
      await store.append({ ...created, sessionId: 'ses-2', correlationId: 'cor-2' })

      await store.deleteSession('ses-1')

      assert.equal(await store.get('ses-1'), null)
      const after = await store.list({ limit: 50, offset: 0 })
      assert.equal(after.total, 1)
      assert.equal(after.sessions[0].sessionId, 'ses-2')
    })

    await test('deleteSession on an unknown session resolves as a no-op', async () => {
      const store = await create()
      await store.deleteSession('ses-never-existed')
      assert.equal(await store.get('ses-never-existed'), null)
    })

    await test('re-appending after deleteSession starts a fresh version-1 stream', async () => {
      const store = await create()
      await store.append(created)
      await store.append({ type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' })

      await store.deleteSession('ses-1')
      await store.append(created)

      const s = await store.get('ses-1')
      assert.ok(s)
      assert.equal(s.version, 1)
      assert.equal(s.status, 'queued')
    })

    await test('deleteSession only affects the caller tenant', async () => {
      const store = await create()
      await store.append(created)

      // a non-owner delete must leave the owner's stream intact
      const other = store.withTenant('other-tenant')
      await other.deleteSession('ses-1')
      assert.ok(await store.get('ses-1'))

      await other.append({
        ...created,
        sessionId: 'ses-9',
        correlationId: 'cor-9',
        tenantId: 'other-tenant',
      })
      await other.deleteSession('ses-9')
      assert.equal(await other.get('ses-9'), null)
      assert.ok(await store.get('ses-1'))
    })

    await test('createProject / listProjects / getProject / deleteProject lifecycle', async () => {
      const store = await create()
      const p = await store.createProject('proj-x', 'probe')
      assert.equal(p.id, 'proj-x')
      assert.equal(p.name, 'probe')

      const listed = await store.listProjects()
      assert.ok(listed.some((pr) => pr.id === 'proj-x'))

      const fetched = await store.getProject('proj-x')
      assert.equal(fetched?.name, 'probe')

      // project-scoped session is removed when the project is deleted
      await store.append({
        type: 'session.created',
        sessionId: 'ses-proj',
        correlationId: 'cor-proj',
        at: '2026-01-04T00:00:00Z',
        member: 'm',
        prompt: 'p',
        projectId: 'proj-x',
      })
      const deleted = await store.deleteProject('proj-x')
      assert.equal(deleted, true)
      assert.equal(await store.getProject('proj-x'), null)
      assert.equal(await store.deleteProject('proj-x'), false)
      assert.equal(await store.deleteProject('proj-missing'), false)
      const after = await store.list({ projectId: 'proj-x', limit: 50, offset: 0 })
      assert.equal(after.total, 0)
      assert.equal(await store.get('ses-proj'), null)
    })

    await test('checkpoints round-trip: save, load, overwrite, delete', async () => {
      const store = await create()
      assert.equal(await store.loadCheckpoint('cor-x'), null)

      await store.saveCheckpoint('cor-x', 'ses-1', '{"step":2}')
      assert.deepEqual(await store.loadCheckpoint('cor-x'), { sessionId: 'ses-1', data: '{"step":2}' })

      await store.saveCheckpoint('cor-x', 'ses-1', '{"step":3}')
      assert.deepEqual(await store.loadCheckpoint('cor-x'), { sessionId: 'ses-1', data: '{"step":3}' })

      await store.deleteCheckpoint('cor-x')
      assert.equal(await store.loadCheckpoint('cor-x'), null)
      // deleting a missing row is a no-op, never a throw
      await store.deleteCheckpoint('cor-x')
    })

    await test('checkpoints are invisible across tenants', async () => {
      const store = await create()
      await store.saveCheckpoint('cor-t', 'ses-1', '{}')
      const other = store.withTenant('other-tenant')
      assert.equal(await other.loadCheckpoint('cor-t'), null)
      assert.ok(await store.loadCheckpoint('cor-t'))
    })

    await test('cost usage accumulates per day/agent/model and lists day-ascending', async () => {
      const store = await create()
      assert.deepEqual(await store.listDailyCost({}), [])
      await store.recordCostUsage({ day: '2026-09-11', agent: 'the-builder', model: 'm1', promptTokens: 20, completionTokens: 8, stepCost: 0.004 })
      await store.recordCostUsage({ day: '2026-09-10', agent: 'the-builder', model: 'm1', promptTokens: 10, completionTokens: 4, stepCost: 0.002 })
      await store.recordCostUsage({ day: '2026-09-10', agent: 'the-builder', model: 'm1', promptTokens: 1, completionTokens: 1, stepCost: 0.001 })
      assert.deepEqual(await store.listDailyCost({}), [
        { day: '2026-09-10', agent: 'the-builder', model: 'm1', promptTokens: 11, completionTokens: 5, stepCost: 0.003 },
        { day: '2026-09-11', agent: 'the-builder', model: 'm1', promptTokens: 20, completionTokens: 8, stepCost: 0.004 },
      ])
    })

    await test('cost usage filters by day window and stays tenant-scoped', async () => {
      const store = await create()
      await store.recordCostUsage({ day: '2026-09-10', agent: 'm', model: '', promptTokens: 1, completionTokens: 1, stepCost: 0.001 })
      await store.recordCostUsage({ day: '2026-09-12', agent: 'm', model: '', promptTokens: 3, completionTokens: 1, stepCost: 0.001 })
      assert.equal((await store.listDailyCost({ since: '2026-09-11' })).length, 1)
      assert.equal((await store.listDailyCost({ until: '2026-09-10' }))[0].day, '2026-09-10')
      const other = store.withTenant('other-tenant')
      assert.deepEqual(await other.listDailyCost({}), [])
      await other.recordCostUsage({ day: '2026-09-10', agent: 'm', model: '', promptTokens: 9, completionTokens: 9, stepCost: 0.009 })
      assert.equal((await store.listDailyCost({}))[0].promptTokens, 1)
    })
  })
}