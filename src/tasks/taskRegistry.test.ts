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

test('park moves a running session to parked with its question', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'the-architect', prompt: 'plan' })
  registry.start(session.id)
  const question = { question: 'Ship it?' }

  const parked = registry.park(session.id, { question })

  assert.equal(parked.status, SessionStatus.PARKED)
  assert.deepEqual(parked.question, question)
})

test('park rejects sessions that are not running', () => {
  const registry = new TaskRegistry()
  const queued = registry.create({ member: 'm', prompt: 'p' })
  assert.throws(() => registry.park(queued.id, { question: {} }), /cannot park session in status "queued"/)
  registry.start(queued.id)
  registry.park(queued.id, { question: {} })
  assert.throws(() => registry.park(queued.id, { question: {} }), /cannot park session in status "parked"/)
  assert.throws(() => registry.succeed(queued.id, { output: 'x' }), /cannot succeed session in status/)
  assert.throws(() => registry.fail(queued.id, { error: 'x' }), /cannot fail session in status/)
})

test('cancel accepts parked sessions so parked-forever stays cancellable', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'm', prompt: 'p' })
  registry.start(session.id)
  registry.park(session.id, { question: {} })

  const cancelled = registry.cancel(session.id)

  assert.equal(cancelled.status, SessionStatus.CANCELLED)
})

test('cancel accepts running sessions so the abort path can finalize an interrupt', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'm', prompt: 'p' })
  registry.start(session.id)

  const cancelled = registry.cancel(session.id)

  assert.equal(cancelled.status, SessionStatus.CANCELLED)
  assert.ok(cancelled.finishedAt)
})

test('cancel still rejects terminal sessions', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'm', prompt: 'p' })
  registry.start(session.id)
  registry.succeed(session.id, { output: 'ok' })
  assert.throws(() => registry.cancel(session.id), /cannot cancel session in status "succeeded"/)
})

test('reprompt rewrites the prompt of a queued session only', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'm', prompt: 'old mission' })

  assert.equal(registry.reprompt(session.id, 'new mission').task.prompt, 'new mission')
  registry.start(session.id)
  assert.throws(() => registry.reprompt(session.id, 'too late'), /cannot reprompt session in status "running"/)
})

test('abort fires the attached controller of a live run, false otherwise', () => {
  const registry = new TaskRegistry()
  const session = registry.create({ member: 'm', prompt: 'p' })

  // never started: no live run to interrupt
  assert.equal(registry.abort(session.id), false)
  assert.equal(registry.abort('ses-missing'), false)

  registry.start(session.id)
  // running but untracked (no controller attached): nothing to fire
  assert.equal(registry.abort(session.id), false)

  const controller = new AbortController()
  registry.attachAbort(session.id, controller)
  assert.equal(registry.abort(session.id), true)
  assert.equal(controller.signal.aborted, true)

  registry.untrackAbort(session.id)
  registry.cancel(session.id)
  assert.equal(registry.abort(session.id), false)
})