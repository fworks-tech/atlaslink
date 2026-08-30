import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rehydrate, SessionStore, StreamIntegrityError } from './sessionStore'
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

test('rehydrate projects awaiting_input: status, nextStep and atlas interaction, then user_reply re-queues', () => {
  const awaiting: SessionEvent = { type: 'session.awaiting_input', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:03Z', question: 'continue?', member: 'atlas' }
  const replyEv: SessionEvent = { type: 'session.user_reply', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:04Z', reply: 'yes' }
  const a = rehydrate([created, awaiting])
  assert.ok(a)
  assert.equal(a.status, 'awaiting_input')
  assert.equal(a.nextStep?.prompt, 'continue?')
  assert.equal(a.interaction.at(-1)?.role, 'atlas')
  const b = rehydrate([created, awaiting, replyEv])
  assert.ok(b)
  assert.equal(b.status, 'queued')
  assert.equal(b.nextStep, null)
  assert.equal(b.interaction.at(-1)?.role, 'user')
})

backendContract('SessionStore satisfies the backend contract', async () => new SessionStore())

test('SessionStore: the snapshot cache serves the same aggregate until an append', async () => {
  const store = new SessionStore()
  await store.append(created)

  const a = await store.get('ses-1')
  const b = await store.get('ses-1')
  assert.ok(a && b)
  assert.equal(a, b) // cached reference, no rehydration on the repeat read
  assert.ok(Object.isFrozen(a)) // a caller cannot corrupt the shared snapshot
  assert.ok(Object.isFrozen(a.task))

  const running: SessionEvent = { type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' }
  await store.append(running)
  const c = await store.get('ses-1')
  assert.ok(c)
  assert.notEqual(a, c) // invalidated by the append, rebuilt fresh
  assert.equal(c.status, 'running')
  assert.equal(c.version, 2)
})