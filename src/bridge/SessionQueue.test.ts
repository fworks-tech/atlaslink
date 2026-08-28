import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLogStore, type BridgeEnvelope } from './EventLogStore'
import { EventBroadcaster } from './EventBroadcaster'
import { SessionQueue } from './SessionQueue'
import { SessionStatus } from '../tasks/taskRegistry'

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'atlaslink-sessionqueue-'))
}

interface FakeSession {
  id: string
  correlationId: string
  task: { member: string }
  status: string
}

function makeRegistry(statuses: Record<string, string>): { get(id: string): FakeSession | undefined } {
  const sessions = new Map(
    Object.entries(statuses).map(([id, status]) => [
      id,
      { id, correlationId: `cor-${id}`, task: { member: 'm' }, status },
    ]),
  )
  return { get: (id) => sessions.get(id) as FakeSession | undefined }
}

test('declareSession emits session.queued then runs the session serially', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const seen: BridgeEnvelope[] = []
    broadcaster.subscribe((e) => seen.push(e), { replay: false })

    const ran: string[] = []
    const registry = makeRegistry({ s1: SessionStatus.SUCCEEDED })
    const queue = new SessionQueue({
      broadcaster,
      registry,
      runner: async (id) => {
        ran.push(id)
      },
    })

    queue.declareSession({ id: 's1', correlationId: 'cor-1', task: { member: 'the-architect' } })
    await new Promise((r) => setTimeout(r, 50))

    assert.deepEqual(ran, ['s1'])
    assert.ok(seen.some((e) => e.type === 'session.queued'))
    assert.ok(seen.some((e) => e.type === 'session.started'))
    assert.ok(seen.some((e) => e.type === 'session.succeeded'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sessions run strictly one at a time in FIFO order', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const registry = makeRegistry({
      a: SessionStatus.SUCCEEDED,
      b: SessionStatus.SUCCEEDED,
      c: SessionStatus.SUCCEEDED,
    })
    const order: string[] = []
    const queue = new SessionQueue({
      broadcaster,
      registry,
      runner: async (id) => {
        order.push(`start-${id}`)
        await new Promise((r) => setTimeout(r, 20))
        order.push(`end-${id}`)
      },
    })

    queue.declareSession({ id: 'a', correlationId: 'c1', task: { member: 'm' } })
    queue.declareSession({ id: 'b', correlationId: 'c2', task: { member: 'm' } })
    queue.declareSession({ id: 'c', correlationId: 'c3', task: { member: 'm' } })
    await new Promise((r) => setTimeout(r, 200))

    assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a cancelled queued session is skipped, never started (spec §3)', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const seen: BridgeEnvelope[] = []
    broadcaster.subscribe((e) => seen.push(e), { replay: false })
    const ran: string[] = []
    const registry = makeRegistry({ s1: SessionStatus.CANCELLED, s2: SessionStatus.SUCCEEDED })
    const queue = new SessionQueue({ broadcaster, registry, runner: async (id) => { ran.push(id) } })

    queue.declareSession({ id: 's1', correlationId: 'c1', task: { member: 'm' } })
    queue.declareSession({ id: 's2', correlationId: 'c2', task: { member: 'm' } })
    await new Promise((r) => setTimeout(r, 50))

    assert.deepEqual(ran, ['s2'])
    assert.ok(seen.some((e) => e.type === 'session.queued' && e.sessionId === 's1'))
    assert.ok(!seen.some((e) => e.type === 'session.started' && e.sessionId === 's1'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed session emits session.failed (terminal-from-registry)', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const seen: BridgeEnvelope[] = []
    broadcaster.subscribe((e) => seen.push(e), { replay: false })
    const registry = makeRegistry({ x: SessionStatus.FAILED })
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })

    queue.declareSession({ id: 'x', correlationId: 'cx', task: { member: 'm' } })
    await new Promise((r) => setTimeout(r, 50))

    assert.ok(seen.some((e) => e.type === 'session.failed'))
    assert.ok(!seen.some((e) => e.type === 'session.succeeded'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session.* events carry the session payload per spec §4', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const seen: BridgeEnvelope[] = []
    broadcaster.subscribe((e) => seen.push(e), { replay: false })
    const registry = makeRegistry({ q: SessionStatus.SUCCEEDED })
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })

    queue.declareSession({ id: 'q', correlationId: 'cor-q', task: { member: 'the-scribe' } })
    await new Promise((r) => setTimeout(r, 50))

    const queued = seen.find((e) => e.type === 'session.queued')!
    assert.equal(queued.sessionId, 'q')
    assert.equal(queued.correlationId, 'cor-q')
    assert.equal(queued.member, 'the-scribe')
    assert.equal(queued.status, SessionStatus.QUEUED)
    assert.ok(typeof queued.at === 'string')
    assert.equal(queued.type, 'session.queued')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('declareSession emits queued before the session starts', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const seen: BridgeEnvelope[] = []
    broadcaster.subscribe((e) => seen.push(e), { replay: false })
    const registry = makeRegistry({ s: SessionStatus.SUCCEEDED })
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })

    queue.declareSession({ id: 's', correlationId: 'cs', task: { member: 'm' } })
    await new Promise((r) => setTimeout(r, 50))

    assert.equal(seen[0].type, 'session.queued')
    assert.equal(seen[1].type, 'session.started')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pending reflects queued-but-not-started sessions', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const registry = makeRegistry({ a: SessionStatus.SUCCEEDED, b: SessionStatus.SUCCEEDED })
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    const queue = new SessionQueue({
      broadcaster,
      registry,
      runner: async () => {
        await gate
      },
    })

    queue.declareSession({ id: 'a', correlationId: 'c1', task: { member: 'm' } })
    queue.declareSession({ id: 'b', correlationId: 'c2', task: { member: 'm' } })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(queue.pending, 1)
    release!()
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(queue.pending, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})