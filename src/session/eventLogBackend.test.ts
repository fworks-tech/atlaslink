import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLogStore, type BridgeEnvelope } from '../bridge/EventLogStore'
import { EventLogBackend } from './eventLogBackend'
import type { SessionEvent } from './types'
import { VersionConflictError } from './types'

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

const cancelled = (at: string): { type: 'session.cancelled'; correlationId: string; at: string } => ({
  type: 'session.cancelled',
  correlationId: 'cor-1',
  at,
})

function runEnvelope(eventId: number, executionId: string): BridgeEnvelope {
  return { eventId, type: 'run.started', executionId, correlationId: 'cor-9', timestamp: 't', task: 'p' }
}

/** Compact filler so the rotation test can size the cap against a measured line. */
function smallRun(eventId: number): BridgeEnvelope {
  return { eventId, type: 'run.started', executionId: `e-${eventId}`, timestamp: 't', task: 'p' }
}

const runLine = Buffer.byteLength(JSON.stringify(smallRun(0)) + '\n', 'utf8')

async function openBackend() {
  const dir = mkdtempSync(join(tmpdir(), 'atlaslink-session-'))
  const store = await EventLogStore.open(dir)
  return { dir, store, backend: new EventLogBackend(store) }
}

test('EventLogBackend: append then get rehydrates the aggregate from the log', async () => {
  const { dir, backend } = await openBackend()
  try {
    await backend.append(created)
    await backend.append(running)

    const s = await backend.get('ses-1')
    assert.ok(s)
    assert.equal(s.sessionId, 'ses-1')
    assert.equal(s.status, 'running')
    assert.equal(s.version, 2)
    assert.equal(s.task.member, 'the-architect')
    assert.equal(s.task.prompt, 'plan x')
    assert.equal(s.tweaks?.provider, 'groq')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: ignores run events and other sessions in the shared log', async () => {
  const { dir, store, backend } = await openBackend()
  try {
    store.append(runEnvelope(store.nextEventId, 'e-1'))
    await backend.append(created)
    store.append({ ...runEnvelope(store.nextEventId, 'e-2'), type: 'session.created', sessionId: 'ses-other', correlationId: 'cor-2', member: 'x', prompt: 'y' })

    const s = await backend.get('ses-1')
    assert.ok(s)
    assert.equal(s.version, 1)
    assert.equal(s.task.member, 'the-architect')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: get returns null for an unknown session', async () => {
  const { dir, backend } = await openBackend()
  try {
    await backend.append(created)
    assert.equal(await backend.get('ses-unknown'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: readModifyWrite commits the delta and bumps the version', async () => {
  const { dir, backend } = await openBackend()
  try {
    await backend.append(created)
    await backend.readModifyWrite('ses-1', 1, () => [cancelled('2026-01-01T00:00:02Z')])

    const s = await backend.get('ses-1')
    assert.ok(s)
    assert.equal(s.status, 'cancelled')
    assert.equal(s.version, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: a stale optimistic write is rejected with VersionConflictError', async () => {
  const { dir, backend } = await openBackend()
  try {
    await backend.append(created)
    await backend.append(running) // version -> 2

    await assert.rejects(
      backend.readModifyWrite('ses-1', 1, () => [cancelled('2026-01-01T00:00:03Z')]),
      (e) => e instanceof VersionConflictError
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: concurrent writers cannot both commit the same version', async () => {
  const { dir, backend } = await openBackend()
  try {
    await backend.append(created)

    const results = await Promise.allSettled([
      backend.readModifyWrite('ses-1', 1, () => [running]),
      backend.readModifyWrite('ses-1', 1, () => [cancelled('2026-01-01T00:00:02Z')]),
    ])

    const rejected = results.filter((r) => r.status === 'rejected')
    assert.equal(rejected.length, 1)
    assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof VersionConflictError)

    const s = await backend.get('ses-1')
    assert.ok(s)
    assert.equal(s.version, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: a session survives a reopen (crash-rehydrate)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlaslink-session-'))
  try {
    const store = await EventLogStore.open(dir)
    await new EventLogBackend(store).append(created)

    // a fresh store + backend over the same directory simulates a restart
    const reopened = await EventLogStore.open(dir)
    const s = await new EventLogBackend(reopened).get('ses-1')
    assert.ok(s)
    assert.equal(s.status, 'queued')
    assert.equal(s.version, 1)
    assert.equal(s.task.member, 'the-architect')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: the optimistic version crosses a reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlaslink-session-'))
  try {
    const store = await EventLogStore.open(dir)
    await new EventLogBackend(store).append(created) // version -> 1

    const reopened = await EventLogStore.open(dir)
    const backend = new EventLogBackend(reopened)
    await backend.readModifyWrite('ses-1', 1, () => [running]) // version -> 2

    await assert.rejects(
      backend.readModifyWrite('ses-1', 1, () => [cancelled('2026-01-01T00:00:02Z')]),
      (e) => e instanceof VersionConflictError
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: a session event survives NDJSON rotation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlaslink-session-'))
  try {
    const store = await EventLogStore.open(dir, { maxBytes: runLine * 2 })
    const backend = new EventLogBackend(store)
    store.append(smallRun(store.nextEventId))
    await backend.append(created)
    // enough run appends to rotate the session line out of the tail file
    for (let i = 0; i < 4; i++) store.append(smallRun(store.nextEventId))

    const tail = readFileSync(join(dir, 'events.ndjson'), 'utf8')
    assert.ok(!tail.includes('session.created')) // the source line really rotated

    const s = await backend.get('ses-1')
    assert.ok(s)
    assert.equal(s.sessionId, 'ses-1')
    assert.equal(s.task.member, 'the-architect')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: a corrupt NDJSON line is skipped without breaking the aggregate', async () => {
  const { dir, backend } = await openBackend()
  try {
    await backend.append(created)
    writeFileSync(join(dir, 'events.ndjson'), '\n{"broken": ', { flag: 'a' })

    const s = await backend.get('ses-1')
    assert.ok(s)
    assert.equal(s.sessionId, 'ses-1')
    assert.equal(s.version, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EventLogBackend: the snapshot cache serves the same aggregate until an append', async () => {
  const { dir, backend } = await openBackend()
  try {
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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})