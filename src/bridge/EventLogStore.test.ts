import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLogStore, ROTATION_FILES, type BridgeEnvelope } from './EventLogStore'

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'atlaslink-eventlog-'))
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

/** Compact envelope so rotation tests can size the cap precisely against lineByte. */
function smallEnv(eventId: number): BridgeEnvelope {
  return { eventId, type: 'run.started', executionId: 'e', member: 'm', timestamp: 't', task: 'p' }
}

const lineByte = Buffer.byteLength(JSON.stringify(smallEnv(0)) + '\n', 'utf8')

test('append then replay returns the events in ascending eventId order', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    assert.equal(store.oldestId, undefined)
    assert.equal(store.nextEventId, 0)

    store.append(env(0, { type: 'run.started' }))
    store.append(env(1, { type: 'reasoning', step: 1, content: 'thinking' }))
    assert.equal(store.nextEventId, 2)

    const replayed = store.replay(-1)
    assert.deepEqual(replayed.map((s) => s.eventId), [0, 1])
    assert.equal(replayed[0].envelope.type, 'run.started')
    assert.equal(replayed[1].envelope.type, 'reasoning')

    const raw = readFileSync(join(dir, 'events.ndjson'), 'utf8').trim().split('\n')
    assert.equal(raw.length, 2)
    assert.equal(JSON.parse(raw[0]).eventId, 0)
    assert.equal(JSON.parse(raw[1]).eventId, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replay(readAfter) returns only events with eventId > readAfter, ascending', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(0))
    store.append(env(1, { type: 'reasoning', step: 1, content: 'a' }))
    store.append(env(2, { type: 'tool.called', step: 1, name: 'read_file', args: {} }))

    const replayed = store.replay(1)
    assert.equal(replayed.length, 1)
    assert.equal(replayed[0].eventId, 2)
    assert.equal(replayed[0].envelope.type, 'tool.called')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replay past the newest event returns []', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(0))
    store.append(env(1))
    store.append(env(2))

    assert.deepEqual(store.replay(2), [])
    assert.deepEqual(store.replay(99), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('oldestId equals the first appended eventId', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(100, { type: 'run.started' }))
    store.append(env(101))
    store.append(env(102))

    assert.equal(store.oldestId, 100)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rotation cascades .ndjson → .1 → .2 and replay spans the files in order', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir, { maxBytes: lineByte * 2 })
    for (let i = 0; i < 6; i++) store.append(smallEnv(i))

    // two rotations occurred → both `.1` and `.2` exist
    assert.ok(existsSync(join(dir, 'events.ndjson.1')))
    assert.ok(existsSync(join(dir, 'events.ndjson.2')))

    // replay joins rotation files oldest → newest in emission order
    const replayed = store.replay(-1)
    assert.deepEqual(replayed.map((s) => s.eventId), [0, 1, 2, 3, 4, 5])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rotation drops the oldest file once the retention window is exceeded', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir, { maxBytes: lineByte * 2 })
    for (let i = 0; i < 9; i++) store.append(smallEnv(i))

    // nine appends = four rotations; only the newest 2-line chunks survive
    const replayed = store.replay(-1)
    assert.deepEqual(replayed.map((s) => s.eventId), [4, 5, 6, 7, 8])
    assert.equal(ROTATION_FILES, 3)

    // the oldest retained file starts at the first surviving eventId
    const oldestFile = JSON.parse(readFileSync(join(dir, 'events.ndjson.2'), 'utf8').split('\n')[0])
    assert.equal(oldestFile.eventId, 4)
    assert.equal(store.oldestId, 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt tail line is skipped without breaking replay or the monotonic cursor', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    store.append(env(0, { type: 'run.started' }))
    store.append(env(1, { type: 'reasoning', step: 1, content: 'one' }))

    // corrupt the final line in-place (simulates a torn write)
    const path = join(dir, 'events.ndjson')
    const raw = readFileSync(path, 'utf8')
    writeFileSync(path, raw.replace(/one/, 'one\n{ not json'))

    const replayed = store.replay(-1)
    assert.deepEqual(replayed.map((s) => s.eventId), [0])
    assert.equal(replayed[0].envelope.type, 'run.started')

    // appending after a corrupt tail keeps the cursor monotonic
    store.append(env(2, { type: 'run.finished', output: 'ok', durationMs: 1 }))
    assert.equal(store.nextEventId, 3)
    assert.deepEqual(store.replay(0).map((s) => s.eventId), [2])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('append swallows write failures while the cursor still advances', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    // make the tail path un-appendable by placing a directory where the log file goes
    mkdirSync(join(dir, 'events.ndjson'))

    store.append(env(0, { type: 'run.started' }))
    store.append(env(1, { type: 'reasoning', step: 1, content: 'lost' }))
    // the failures were swallowed; the cursor still advanced without throwing
    assert.equal(store.nextEventId, 2)
    assert.deepEqual(store.replay(-1), [])
    assert.equal(store.oldestId, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cursor resumes from events.seq after rotation and never resets across restarts', async () => {
  const dir = tmpDataDir()
  try {
    const first = await EventLogStore.open(dir, { maxBytes: lineByte * 2 })
    for (let i = 0; i < 6; i++) first.append(smallEnv(i))
    // six appends force rotations, which write the events.seq sidecar
    assert.ok(existsSync(join(dir, 'events.seq')))

    // a second open() restores the monotonic cursor — counter never resets or
    // dips below an already-stored eventId
    const second = await EventLogStore.open(dir)
    assert.equal(second.nextEventId, 6)
    assert.equal(second.oldestId, 0)
    assert.deepEqual(second.replay(-1).map((s) => s.eventId), [0, 1, 2, 3, 4, 5])

    const id = second.nextEventId
    second.append(smallEnv(id))
    assert.equal(second.nextEventId, 7)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cursor falls back to a tail scan when events.seq is absent', async () => {
  const dir = tmpDataDir()
  try {
    const first = await EventLogStore.open(dir)
    first.append(env(0))
    first.append(env(1))
    assert.ok(!existsSync(join(dir, 'events.seq')))

    // no sidecar written (no rotation) → reopen recovers the cursor by scanning the tail
    const second = await EventLogStore.open(dir)
    assert.equal(second.nextEventId, 2)
    assert.equal(second.oldestId, 0)
    assert.deepEqual(second.replay(-1).map((s) => s.eventId), [0, 1])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})