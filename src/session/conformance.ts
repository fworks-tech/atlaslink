import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionBackend } from './sessionBackend'
import type { SessionEvent, SessionDelta, Project } from './types'

/**
 * Conformance test suite for SessionBackend implementations.
 * All backends must pass these tests to ensure consistent behavior.
 *
 * Usage:
 * ```typescript
 * import { SessionBackendConformance } from './conformance'
 *
 * SessionBackendConformance('SessionStore', () => new SessionStore())
 * SessionBackendConformance('PostgresBackend', () => createTestPostgresBackend())
 * ```
 */
export function SessionBackendConformance(
  name: string,
  createBackend: () => SessionBackend | Promise<SessionBackend>,
  cleanup?: (backend: SessionBackend) => Promise<void>
): void {
  describe(`${name} conformance`, () => {
    let backend: SessionBackend

    before(async () => {
      backend = await createBackend()
    })

    after(async () => {
      if (cleanup) await cleanup(backend)
    })

    describe('append / get', () => {
      it('returns null for non-existent session', async () => {
        const session = await backend.get('non-existent-id')
        assert.equal(session, null)
      })

      it('appends events and reconstructs session', async () => {
        const sessionId = `test-${Date.now()}-1`
        const correlationId = `corr-${Date.now()}-1`

        const events: SessionEvent[] = [
          {
            type: 'session.created',
            sessionId,
            correlationId,
            at: new Date().toISOString(),
            member: 'test-member',
            prompt: 'test prompt',
            tenantId: 'default',
          },
          {
            type: 'session.running',
            sessionId,
            correlationId,
            at: new Date().toISOString(),
            tenantId: 'default',
          },
        ]

        for (const event of events) {
          await backend.append(event)
        }

        const session = await backend.get(sessionId)
        assert.notEqual(session, null)
        assert.equal(session!.sessionId, sessionId)
        assert.equal(session!.status, 'running')
        assert.equal(session!.task.member, 'test-member')
      })

      it('handles multiple sessions independently', async () => {
        const sessionId1 = `test-${Date.now()}-2a`
        const sessionId2 = `test-${Date.now()}-2b`
        const correlationId = `corr-${Date.now()}-2`

        await backend.append({
          type: 'session.created',
          sessionId: sessionId1,
          correlationId,
          at: new Date().toISOString(),
          member: 'member-1', prompt: 'prompt-1',
          tenantId: 'default',
        })

        await backend.append({
          type: 'session.created',
          sessionId: sessionId2,
          correlationId,
          at: new Date().toISOString(),
          member: 'member-2', prompt: 'prompt-2',
          tenantId: 'default',
        })

        const session1 = await backend.get(sessionId1)
        const session2 = await backend.get(sessionId2)

        assert.equal(session1!.task.member, 'member-1')
        assert.equal(session2!.task.member, 'member-2')
      })
    })

    describe('readModifyWrite', () => {
      it('applies deltas atomically', async () => {
        const sessionId = `test-${Date.now()}-3`
        const correlationId = `corr-${Date.now()}-3`

        await backend.append({
          type: 'session.created',
          sessionId,
          correlationId,
          at: new Date().toISOString(),
          member: 'test-member', prompt: 'test prompt',
          tenantId: 'default',
        })

        const current = await backend.get(sessionId)
        assert.notEqual(current, null)

        const deltas: SessionDelta[] = [
          {
            type: 'session.running',
            correlationId,
            at: new Date().toISOString(),
          },
        ]

        await backend.readModifyWrite(sessionId, current!.version, () => deltas)

        const updated = await backend.get(sessionId)
        assert.equal(updated!.status, 'running')
        assert.equal(updated!.version, current!.version + 1)
      })

      it('rejects conflicting writes', async () => {
        const sessionId = `test-${Date.now()}-4`
        const correlationId = `corr-${Date.now()}-4`

        await backend.append({
          type: 'session.created',
          sessionId,
          correlationId,
          at: new Date().toISOString(),
          member: 'test-member', prompt: 'test prompt',
          tenantId: 'default',
        })

        const current = await backend.get(sessionId)
        assert.notEqual(current, null)

        // First write succeeds
        await backend.readModifyWrite(sessionId, current!.version, () => [
          { type: 'session.running', correlationId, at: new Date().toISOString() },
        ])

        // Second write with wrong version fails
        await assert.rejects(
          backend.readModifyWrite(sessionId, current!.version, () => [
            { type: 'session.failed', correlationId, at: new Date().toISOString(), error: 'test error' },
          ])
        )
      })
    })

    describe('list', () => {
      it('returns sessions in descending createdAt order', async () => {
        const sessionId1 = `test-${Date.now()}-5a`
        const sessionId2 = `test-${Date.now()}-5b`
        const correlationId = `corr-${Date.now()}-5`

        await backend.append({
          type: 'session.created',
          sessionId: sessionId1,
          correlationId,
          at: '2026-01-01T00:00:00Z',
          member: 'member-1', prompt: 'prompt-1',
          tenantId: 'default',
        })

        await backend.append({
          type: 'session.created',
          sessionId: sessionId2,
          correlationId,
          at: '2026-01-02T00:00:00Z',
          member: 'member-2', prompt: 'prompt-2',
          tenantId: 'default',
        })

        const result = await backend.list({
          limit: 10,
          offset: 0,
        })

        assert.ok(result.sessions.length >= 2)
        // Most recent first
        const idx1 = result.sessions.findIndex((s) => s.sessionId === sessionId1)
        const idx2 = result.sessions.findIndex((s) => s.sessionId === sessionId2)
        assert.ok(idx2 < idx1)
      })

      it('filters by status', async () => {
        const sessionId = `test-${Date.now()}-6`
        const correlationId = `corr-${Date.now()}-6`

        await backend.append({
          type: 'session.created',
          sessionId,
          correlationId,
          at: new Date().toISOString(),
          member: 'test-member', prompt: 'test prompt',
          tenantId: 'default',
        })

        const result = await backend.list({
          status: 'queued',
          limit: 10,
          offset: 0,
        })

        assert.ok(result.sessions.every((s) => s.status === 'queued'))
      })

      it('filters by projectId', async () => {
        const sessionId = `test-${Date.now()}-7`
        const correlationId = `corr-${Date.now()}-7`
        const projectId = `project-${Date.now()}-7`

        await backend.append({
          type: 'session.created',
          sessionId,
          correlationId,
          at: new Date().toISOString(),
          member: 'test-member', prompt: 'test prompt',
          tenantId: 'default',
          projectId,
        })

        const result = await backend.list({
          projectId,
          limit: 10,
          offset: 0,
        })

        assert.ok(result.sessions.every((s) => s.projectId === projectId))
      })

      it('supports pagination', async () => {
        const correlationId = `corr-${Date.now()}-8`
        const sessions = []

        for (let i = 0; i < 5; i++) {
          const sessionId = `test-${Date.now()}-8-${i}`
          await backend.append({
            type: 'session.created',
            sessionId,
            correlationId,
            at: new Date().toISOString(),
            task: { member: 'test-member', prompt: `prompt-${i}` },
            tenantId: 'default',
          })
          sessions.push(sessionId)
        }

        const page1 = await backend.list({
          limit: 2,
          offset: 0,
        })

        const page2 = await backend.list({
          limit: 2,
          offset: 2,
        })

        assert.ok(page1.sessions.length <= 2)
        assert.ok(page2.sessions.length <= 2)
        assert.ok(page1.total >= 5)
      })
    })

    describe('projects', () => {
      it('creates and retrieves a project', async () => {
        const projectId = `project-${Date.now()}-9`
        const project = await backend.createProject(projectId, 'Test Project')

        assert.equal(project.id, projectId)
        assert.equal(project.name, 'Test Project')

        const retrieved = await backend.getProject(projectId)
        assert.notEqual(retrieved, null)
        assert.equal(retrieved!.name, 'Test Project')
      })

      it('lists all projects', async () => {
        const projectId = `project-${Date.now()}-10`
        await backend.createProject(projectId, 'List Test Project')

        const projects = await backend.listProjects()
        assert.ok(projects.some((p) => p.id === projectId))
      })

      it('deletes a project', async () => {
        const projectId = `project-${Date.now()}-11`
        await backend.createProject(projectId, 'Delete Test Project')

        const deleted = await backend.deleteProject(projectId)
        assert.equal(deleted, true)

        const retrieved = await backend.getProject(projectId)
        assert.equal(retrieved, null)
      })
    })

    describe('concurrent writes', () => {
      it('handles concurrent appends safely', async () => {
        const sessionId = `test-${Date.now()}-12`
        const correlationId = `corr-${Date.now()}-12`

        await backend.append({
          type: 'session.created',
          sessionId,
          correlationId,
          at: new Date().toISOString(),
          member: 'test-member', prompt: 'test prompt',
          tenantId: 'default',
        })

        // Concurrent appends
        const promises = Array.from({ length: 5 }, (_, i) =>
          backend.append({
            type: 'session.message',
            sessionId,
            correlationId,
            at: new Date().toISOString(),
            message: `message-${i}`,
            role: 'user',
            tenantId: 'default',
          })
        )

        await Promise.all(promises)

        const session = await backend.get(sessionId)
        assert.notEqual(session, null)
      })
    })

    describe('large sessions', () => {
      it('handles sessions with many events', async () => {
        const sessionId = `test-${Date.now()}-13`
        const correlationId = `corr-${Date.now()}-13`

        await backend.append({
          type: 'session.created',
          sessionId,
          correlationId,
          at: new Date().toISOString(),
          member: 'test-member', prompt: 'test prompt',
          tenantId: 'default',
        })

        // Add 100 events
        for (let i = 0; i < 100; i++) {
          await backend.append({
            type: 'session.message',
            sessionId,
            correlationId,
            at: new Date().toISOString(),
            message: `message-${i}`,
            role: 'user',
            tenantId: 'default',
          })
        }

        const session = await backend.get(sessionId)
        assert.notEqual(session, null)
        // 101 = 1 from session.created + 100 from session.message events
        assert.equal(session!.interaction.length, 101)
      })
    })
  })
}
