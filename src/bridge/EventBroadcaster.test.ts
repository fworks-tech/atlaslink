import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLogStore, type BridgeEnvelope } from './EventLogStore'
import { EventBroadcaster } from './EventBroadcaster'

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'atlaslink-broadcaster-'))
}

function env(eventId: number, overrides: Record<string, unknown> = {}): BridgeEnvelope {
  return {
    eventId,
    type: 'run.started',
    executionId: 'e-1',
    member: 'the-architect',
    correlationId: 'cor-1',
    timestamp: '2026-08-22T00:00:00.000Z',
    task: 'plan the M2 bridge',
    ...overrides,
  }
}

function isBridgeEvent(e: unknown): e is { eventId?: number; type?: string } {
  return typeof e === 'object' && e !== null
}

test('subscribe replays persisted events and then receives live events', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(0, { type: 'run.started' }))
    store.append(env(1, { type: 'reasoning', step: 1, content: 'thinking' }))

    const broadcaster = new EventBroadcaster(store)
    const received: unknown[] = []
    broadcaster.subscribe((event) => received.push(event))

    store.append(env(2, { type: 'tool.called', step: 1, name: 'read_file' }))
    broadcaster.emit(env(2, { type: 'tool.called', step: 1, name: 'read_file' }))

    assert.equal(received.length, 3)
    for (const event of received) assert.ok(isBridgeEvent(event) && event.type === 'bridge')
    assert.ok(isBridgeEvent(received[0]) && Number.isInteger(received[0].eventId))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('subscribe returns an unsubscribe function that stops delivery', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const received: unknown[] = []
    const unsubscribe = broadcaster.subscribe((event) => received.push(event))
    unsubscribe()

    store.append(env(0))
    broadcaster.emit(env(0))
    assert.equal(received.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a throwing subscriber never breaks the broadcaster or other listeners', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const received: unknown[] = []
    broadcaster.subscribe(() => {
      throw new Error('boom')
    })
    broadcaster.subscribe((event) => received.push(event))

    store.append(env(0))
    broadcaster.emit(env(0))
    assert.equal(received.length, 1)
    assert.ok(isBridgeEvent(received[0]) && received[0].type === 'bridge')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('emit wraps the envelope and assigns a monotonic eventId-derived bridge id', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const received: unknown[] = []
    broadcaster.subscribe((event) => received.push(event))

    store.append(env(41, { type: 'run.finished', output: 'done' }))
    broadcaster.emit(env(41, { type: 'run.finished', output: 'done' }))

    assert.equal(received.length, 1)
    const event = received[0]
    assert.ok(isBridgeEvent(event))
    assert.equal(event.eventId, 41)
    assert.equal(event.type, 'bridge')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectGap returns null for a contiguous sequence', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(0))
    store.append(env(1))
    store.append(env(2))

    const broadcaster = new EventBroadcaster(store)
    assert.equal(broadcaster.detectGap(), null)
    assert.equal(broadcaster.getGap(), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectGap reports the first missing eventId in a non-contiguous sequence', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(0))
    store.append(env(1))
    store.append(env(2))
    store.append(env(4)) // 3 is missing

    const broadcaster = new EventBroadcaster(store)
    assert.equal(broadcaster.detectGap(), 3)
    assert.equal(broadcaster.getGap(), 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectGap returns null when there are fewer than two eventIds', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(5))

    const broadcaster = new EventBroadcaster(store)
    assert.equal(broadcaster.detectGap(), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectGap ignores non-integer eventIds when scanning for gaps', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(0))
    store.append(env(1))

    const broadcaster = new EventBroadcaster(store)
    assert.equal(broadcaster.detectGap(), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('subscribe replays only events persisted before subscription, not later appends until emit', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const received: unknown[] = []

    store.append(env(0))
    broadcaster.subscribe((event) => received.push(event))

    store.append(env(1))
    store.append(env(2))
    assert.equal(received.length, 1)

    broadcaster.emit(env(2))
    assert.equal(received.length, 2)
    assert.ok(isBridgeEvent(received[1]) && received[1].eventId === 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})