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

test('emit persists and replays the event verbatim with a monotonic eventId', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const received: BridgeEnvelope[] = []
    broadcaster.subscribe((event) => received.push(event))

    broadcaster.emit(env(0, { type: 'run.started' }))
    broadcaster.emit(env(0, { type: 'reasoning', step: 1, content: 'thinking' }))

    assert.equal(received.length, 2)
    assert.equal(received[0].eventId, 0)
    assert.equal(received[1].eventId, 1)
    // verbatim: type is preserved, never rewritten
    assert.equal(received[0].type, 'run.started')
    assert.equal(received[1].type, 'reasoning')

    const replayed = broadcaster.replayFrom(0)
    assert.deepEqual(replayed.map((e) => e.eventId), [0, 1])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('subscribe with replay replays recent events then live; replay:false is live-only', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    broadcaster.emit(env(0, { type: 'run.started' }))
    broadcaster.emit(env(1, { type: 'reasoning', content: 'a' }))

    const caughtUp: BridgeEnvelope[] = []
    broadcaster.subscribe((event) => caughtUp.push(event))
    assert.equal(caughtUp.length, 2)

    const liveOnly: BridgeEnvelope[] = []
    broadcaster.subscribe((event) => liveOnly.push(event), { replay: false })
    assert.equal(liveOnly.length, 0)

    broadcaster.emit(env(2, { type: 'run.finished', output: 'ok' }))
    assert.equal(caughtUp.length, 3)
    assert.equal(liveOnly.length, 1)
    assert.equal(liveOnly[0].eventId, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('subscribe returns an unsubscribe function that stops delivery', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const received: BridgeEnvelope[] = []
    const unsubscribe = broadcaster.subscribe((event) => received.push(event), { replay: false })
    unsubscribe()
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
    const received: BridgeEnvelope[] = []
    broadcaster.subscribe(() => {
      throw new Error('boom')
    }, { replay: false })
    broadcaster.subscribe((event) => received.push(event), { replay: false })

    broadcaster.emit(env(0))
    assert.equal(received.length, 1)
    assert.equal(received[0].eventId, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('slow clients are evicted: replay is bounded by highWaterMark', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store, { highWaterMark: 2 })
    for (let i = 0; i < 5; i++) broadcaster.emit(env(i, { type: 'run.started' }))

    const received: BridgeEnvelope[] = []
    broadcaster.subscribe((event) => received.push(event))
    assert.equal(received.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectGap returns null for a contiguous sequence', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    for (let i = 0; i < 3; i++) broadcaster.emit(env(i))
    assert.equal(broadcaster.detectGap(), null)
    assert.equal(broadcaster.getGap(), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectGap reports the missing eventId when the sequence is gapped', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    broadcaster.emit(env(0))
    broadcaster.emit(env(1))
    // force a skip by appending directly to the log
    store.append(env(4))
    broadcaster.emit(env(5))

    assert.equal(broadcaster.detectGap(), 2)
    assert.equal(broadcaster.getGap(), 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectGap returns null with fewer than two eventIds', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    store.append(env(5))
    assert.equal(broadcaster.detectGap(), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replayFrom serves events with eventId >= startId for Last-Event-ID resume', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    for (let i = 0; i < 4; i++) broadcaster.emit(env(i))
    const replayed = broadcaster.replayFrom(2)
    assert.deepEqual(replayed.map((e) => e.eventId), [2, 3])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})