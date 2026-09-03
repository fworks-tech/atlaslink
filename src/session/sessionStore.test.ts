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

test('rehydrate projects awaiting_input: status, nextStep and atlas interaction, then user_reply preserves park', () => {
  const awaiting: SessionEvent = { type: 'session.awaiting_input', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:03Z', question: { question: 'continue?' }, member: 'atlas' }
  const replyEv: SessionEvent = { type: 'session.user_reply', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:04Z', reply: 'yes' }
  const a = rehydrate([created, awaiting])
  assert.ok(a)
  assert.equal(a.status, 'awaiting_input')
  assert.equal(a.nextStep?.prompt, 'continue?')
  assert.deepEqual(a.question, { question: 'continue?' })
  assert.equal(a.interaction.at(-1)?.role, 'atlas')
  const b = rehydrate([created, awaiting, replyEv])
  assert.ok(b)
  // linked-session resume: the parked original keeps its status and nextStep
  assert.equal(b.status, 'awaiting_input')
  assert.deepEqual(b.nextStep, { awaiting_input: true, prompt: 'continue?', member: 'atlas' })
  assert.equal(b.interaction.at(-1)?.role, 'user')
})

test('rehydrate projects session.message as a user turn without changing status', () => {
  const running: SessionEvent = { type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' }
  const msg: SessionEvent = { type: 'session.message', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:02Z', message: 'hello?' }
  const s = rehydrate([created, running, msg])
  assert.ok(s)
  assert.equal(s.status, 'running')
  assert.equal(s.version, 3)
  assert.equal(s.nextStep, null)
  assert.equal(s.interaction.length, 2)
  assert.deepEqual(s.interaction.at(-1), { role: 'user', at: '2026-01-01T00:00:02Z', content: 'hello?' })
})

test('rehydrate keeps awaiting_input and its nextStep when a message lands', () => {
  const awaiting: SessionEvent = { type: 'session.awaiting_input', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:03Z', question: { question: 'continue?' }, member: 'atlas' }
  const msg: SessionEvent = { type: 'session.message', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:04Z', message: 'one moment' }
  const s = rehydrate([created, awaiting, msg])
  assert.ok(s)
  assert.equal(s.status, 'awaiting_input')
  assert.deepEqual(s.nextStep, { awaiting_input: true, prompt: 'continue?', member: 'atlas' })
  assert.equal(s.interaction.at(-1)?.role, 'user')
  assert.equal(s.interaction.at(-1)?.content, 'one moment')
})

test('rehydrate projects session.steer as a user turn without changing status', () => {
  const running: SessionEvent = { type: 'session.running', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z' }
  const steer: SessionEvent = { type: 'session.steer', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:02Z', message: 'prefer groq' }
  const s = rehydrate([created, running, steer])
  assert.ok(s)
  assert.equal(s.status, 'running')
  assert.equal(s.version, 3)
  assert.equal(s.interaction.at(-1)?.role, 'user')
  assert.equal(s.interaction.at(-1)?.content, 'prefer groq')
})

test('rehydrate applies session.steer as a prompt rewrite on top of the history', () => {
  const steer: SessionEvent = { type: 'session.steer', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-01-01T00:00:01Z', message: 'use groq, not openai' }
  const s = rehydrate([created, steer])
  assert.ok(s)
  assert.equal(s.status, 'queued')
  assert.equal(s.task.prompt, 'use groq, not openai')
  assert.equal(s.interaction.at(-1)?.content, 'use groq, not openai')
})

test('rehydrate projects the single parked question and carries resumeOf onto the follow-up', () => {
  const awaiting: SessionEvent = {
    type: 'session.awaiting_input',
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    at: '2026-01-01T00:00:03Z',
    question: { question: 'Ship it?', context: 'release vote' },
    member: 'atlas',
  }
  const s = rehydrate([created, awaiting])
  assert.ok(s)
  assert.equal(s.nextStep?.prompt, 'Ship it?')
  assert.equal(s.interaction.at(-1)?.content, 'Ship it?')
  assert.deepEqual(s.question, { question: 'Ship it?', context: 'release vote' })

  const followupCreated: SessionEvent = {
    type: 'session.created',
    sessionId: 'ses-2',
    correlationId: 'cor-2',
    at: '2026-01-01T00:00:04Z',
    member: 'atlas',
    prompt: 'follow-up',
    resumeOf: 'ses-1',
  }
  const f = rehydrate([followupCreated])
  assert.ok(f)
  assert.equal(f.resumeOf, 'ses-1')
  assert.equal(f.status, 'queued')
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