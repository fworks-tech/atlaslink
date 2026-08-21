import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TaskRegistry, SessionStatus } from './taskRegistry'

test('create builds a queued session with ids and a dedicated correlationId', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'the-scribe', prompt: 'write a commit message' })

  assert.match(session.id, /^ses-/)
  assert.match(session.correlationId, /^cor-/)
  assert.notEqual(session.correlationId, session.id)
  assert.equal(session.status, SessionStatus.QUEUED)
  assert.equal(session.task.member, 'the-scribe')
  assert.equal(session.task.prompt, 'write a commit message')
  assert.ok(session.createdAt)
  assert.equal(session.startedAt, undefined)
  assert.equal(session.finishedAt, undefined)
})

test('create requires member and prompt', () => {
  const registry = new TaskRegistry()
  assert.throws(() => registry.create({ member: '', prompt: 'x' }), /member is required/)
  assert.throws(() => registry.create({ member: 'the-scribe', prompt: '' }), /prompt is required/)
})

test('session lifecycle: queued -> running -> succeeded exactly once', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'the-doorman', prompt: 'validate branch health' })

  const running = registry.start(session.id)
  assert.equal(running.status, SessionStatus.RUNNING)
  assert.ok(running.startedAt)

  const done = registry.succeed(session.id, { output: 'PASS', durationMs: 42 })
  assert.equal(done.status, SessionStatus.SUCCEEDED)
  assert.equal(done.output, 'PASS')
  assert.equal(done.durationMs, 42)
  assert.ok(done.finishedAt)
})

test('invalid status transitions are rejected', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'the-architect', prompt: 'plan' })

  assert.throws(() => registry.succeed(session.id, { output: 'x' }), /cannot succeed/)
  assert.throws(() => registry.fail(session.id, { error: 'nope' }), /cannot fail session in status/)
  registry.start(session.id)
  assert.throws(() => registry.start(session.id), /cannot start session in status/)
  registry.succeed(session.id, { output: 'ok' })
  assert.throws(() => registry.fail(session.id, { error: 'nope' }), /cannot fail session in status/)
})

test('fail marks the session failed with the error', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'the-reviewer', prompt: 'review' })
  registry.start(session.id)
  const failed = registry.fail(session.id, { error: 'boom', durationMs: 5 })
  assert.equal(failed.status, SessionStatus.FAILED)
  assert.equal(failed.error, 'boom')
  assert.equal(failed.durationMs, 5)
})

test('get has and list reflect the stored sessions', () => {
  const registry = new TaskRegistry()
  const a = registry.create({ member: 'the-scribe', prompt: 'one' })
  const b = registry.create({ member: 'the-architect', prompt: 'two' })

  assert.equal(registry.has(a.id), true)
  assert.equal(registry.has('nope'), false)
  assert.equal(registry.get(a.id), a)
  assert.equal(registry.get(b.id), b)
  assert.equal(registry.get('missing'), undefined)
  assert.deepEqual(registry.list(), [a, b])
})
