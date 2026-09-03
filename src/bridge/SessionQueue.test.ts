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

async function openQueue(statuses: Record<string, string>, onRun: (id: string) => void | Promise<void>) {
  const dir = tmpDataDir()
  const store = await EventLogStore.open(dir)
  const broadcaster = new EventBroadcaster(store)
  const seen: BridgeEnvelope[] = []
  broadcaster.subscribe((e) => seen.push(e), { replay: false })
  const queue = new SessionQueue({ broadcaster, registry: makeRegistry(statuses), runner: async (id) => { await onRun(id) } })
  return { dir, queue, seen }
}

/** Poll-based drain wait: deterministic under CI load, unlike fixed sleeps. */
async function waitFor(cond: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

test('interactive sessions jump ahead of waiting standard sessions (FIFO within each lane)', async () => {
  const order: string[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  const { dir, queue, seen } = await openQueue(
    { s1: SessionStatus.SUCCEEDED, s2: SessionStatus.SUCCEEDED, i1: SessionStatus.SUCCEEDED },
    async (id) => {
      order.push(`start-${id}`)
      if (id === 's1') await gate
      order.push(`end-${id}`)
    },
  )
  try {
    queue.declareSession({ id: 's1', correlationId: 'c1', task: { member: 'm' } })
    queue.declareSession({ id: 's2', correlationId: 'c2', task: { member: 'm' } })
    queue.declareSession({ id: 'i1', correlationId: 'c3', task: { member: 'm' } }, { lane: 'interactive' })
    await waitFor(() => order.length >= 1, 's1 to start')
    release!()
    await waitFor(() => order.length === 6, 'all sessions to run')

    assert.deepEqual(order, ['start-s1', 'end-s1', 'start-i1', 'end-i1', 'start-s2', 'end-s2'])
    // queued emits in declare order while started follows lane priority
    assert.deepEqual(
      seen.filter((e) => e.type === 'session.queued').map((e) => e.sessionId),
      ['s1', 's2', 'i1']
    )
    assert.deepEqual(
      seen.filter((e) => e.type === 'session.started').map((e) => e.sessionId),
      ['s1', 'i1', 's2']
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fairness bound: at most 3 consecutive interactive runs before a waiting standard session', async () => {
  const order: string[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  const ids = ['s1', 's2', 's3', 'i1', 'i2', 'i3', 'i4']
  const { dir, queue } = await openQueue(
    Object.fromEntries(ids.map((id) => [id, SessionStatus.SUCCEEDED])),
    async (id) => {
      order.push(`start-${id}`)
      if (id === 's1') await gate
      order.push(`end-${id}`)
    },
  )
  try {
    queue.declareSession({ id: 's1', correlationId: 'c-s1', task: { member: 'm' } })
    queue.declareSession({ id: 's2', correlationId: 'c-s2', task: { member: 'm' } })
    for (const id of ['i1', 'i2', 'i3', 'i4']) {
      queue.declareSession({ id, correlationId: `c-${id}`, task: { member: 'm' } }, { lane: 'interactive' })
    }
    queue.declareSession({ id: 's3', correlationId: 'c-s3', task: { member: 'm' } })
    await waitFor(() => order.includes('start-s1'), 's1 to start')
    release!()
    await waitFor(() => order.length === 14, 'all sessions to run')

    // interactive FIFO holds (i1 before i2 before i3), the bound yields to s2,
    // then the counter resets and the lanes drain in order — serially, no overlap
    assert.deepEqual(order, [
      'start-s1',
      'end-s1',
      'start-i1',
      'end-i1',
      'start-i2',
      'end-i2',
      'start-i3',
      'end-i3',
      'start-s2',
      'end-s2',
      'start-i4',
      'end-i4',
      'start-s3',
      'end-s3',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cancelled interactive sessions are skipped without consuming the fairness bound', async () => {
  const order: string[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  const { dir, queue, seen } = await openQueue(
    {
      s1: SessionStatus.SUCCEEDED,
      s2: SessionStatus.SUCCEEDED,
      i1: SessionStatus.CANCELLED,
      i2: SessionStatus.SUCCEEDED,
      i3: SessionStatus.SUCCEEDED,
      i4: SessionStatus.SUCCEEDED,
      i5: SessionStatus.SUCCEEDED,
    },
    async (id) => {
      order.push(id)
      if (id === 's1') await gate
    },
  )
  try {
    queue.declareSession({ id: 's1', correlationId: 'c-s1', task: { member: 'm' } })
    queue.declareSession({ id: 's2', correlationId: 'c-s2', task: { member: 'm' } })
    for (const id of ['i1', 'i2', 'i3', 'i4', 'i5']) {
      queue.declareSession({ id, correlationId: `c-${id}`, task: { member: 'm' } }, { lane: 'interactive' })
    }
    await waitFor(() => order.length >= 1, 's1 to start')
    release!()
    await waitFor(() => order.length === 6, 'all sessions to run')

    // i1 is skipped and does not count toward the 3 — i2/i3/i4 run, then s2, then i5
    assert.deepEqual(order, ['s1', 'i2', 'i3', 'i4', 's2', 'i5'])
    // exactly one started/succeeded per ran session; the skipped session never starts
    assert.deepEqual(
      seen.filter((e) => e.type === 'session.started').map((e) => e.sessionId),
      ['s1', 'i2', 'i3', 'i4', 's2', 'i5']
    )
    assert.ok(!seen.some((e) => e.sessionId === 'i1' && e.type !== 'session.queued'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pending counts both lanes; pendingByLane splits them', async () => {
  const started: string[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  const { dir, queue } = await openQueue(
    { s1: SessionStatus.SUCCEEDED, s2: SessionStatus.SUCCEEDED, i1: SessionStatus.SUCCEEDED },
    async (id) => {
      started.push(id)
      if (id === 's1') await gate
    },
  )
  try {
    queue.declareSession({ id: 's1', correlationId: 'c1', task: { member: 'm' } })
    queue.declareSession({ id: 's2', correlationId: 'c2', task: { member: 'm' } })
    queue.declareSession({ id: 'i1', correlationId: 'c3', task: { member: 'm' } }, { lane: 'interactive' })
    await waitFor(() => started.length >= 1, 's1 to start')

    assert.equal(queue.pending, 2)
    assert.deepEqual(queue.pendingByLane, { standard: 1, interactive: 1 })
    release!()
    await waitFor(() => queue.pending === 0, 'queue to drain')
    assert.deepEqual(queue.pendingByLane, { standard: 0, interactive: 0 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('interactive-only queue drains FIFO without bound block', async () => {
  const order: string[] = []
  const { dir, queue } = await openQueue(
    Object.fromEntries(['i1', 'i2', 'i3', 'i4', 'i5'].map((id) => [id, SessionStatus.SUCCEEDED])),
    async (id) => {
      order.push(id)
    },
  )
  try {
    // more interactives than the bound, standard lane empty the whole run
    for (const id of ['i1', 'i2', 'i3', 'i4', 'i5']) {
      queue.declareSession({ id, correlationId: `c-${id}`, task: { member: 'm' } }, { lane: 'interactive' })
    }
    await waitFor(() => order.length === 5, 'all interactives to run')

    assert.deepEqual(order, ['i1', 'i2', 'i3', 'i4', 'i5'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('interactive declared on an idle pump runs immediately', async () => {
  const order: string[] = []
  const { dir, queue, seen } = await openQueue({ i1: SessionStatus.SUCCEEDED }, async (id) => {
    order.push(id)
  })
  try {
    queue.declareSession({ id: 'i1', correlationId: 'c1', task: { member: 'm' } }, { lane: 'interactive' })
    await waitFor(() => order.length === 1, 'interactive to run')

    assert.deepEqual(order, ['i1'])
    assert.ok(seen.some((e) => e.type === 'session.started' && e.sessionId === 'i1'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fairness counter resets after the queue drains idle', async () => {
  const order: string[] = []
  let releaseS0: (() => void) | undefined
  let releaseS1: (() => void) | undefined
  const gateS0 = new Promise<void>((r) => {
    releaseS0 = r
  })
  const gateS1 = new Promise<void>((r) => {
    releaseS1 = r
  })
  const { dir, queue } = await openQueue(
    Object.fromEntries(
      ['s0', 's1', 's2', 'i1', 'i2', 'i3', 'i4'].map((id) => [id, SessionStatus.SUCCEEDED]),
    ),
    async (id) => {
      order.push(`start-${id}`)
      if (id === 's0') await gateS0
      if (id === 's1') await gateS1
      order.push(`end-${id}`)
    },
  )
  try {
    // fill the bound, then drain to idle — the counter must not leak into the next burst
    queue.declareSession({ id: 's0', correlationId: 'c-s0', task: { member: 'm' } })
    for (const id of ['i1', 'i2', 'i3']) {
      queue.declareSession({ id, correlationId: `c-${id}`, task: { member: 'm' } }, { lane: 'interactive' })
    }
    await waitFor(() => order.length >= 1, 's0 to start')
    releaseS0!()
    await waitFor(() => order.length === 8, 'first burst to drain')
    assert.equal(queue.pending, 0)

    queue.declareSession({ id: 's1', correlationId: 'c-s1', task: { member: 'm' } })
    await waitFor(() => order.includes('start-s1'), 's1 to start')
    queue.declareSession({ id: 's2', correlationId: 'c-s2', task: { member: 'm' } })
    queue.declareSession({ id: 'i4', correlationId: 'c-i4', task: { member: 'm' } }, { lane: 'interactive' })
    releaseS1!()
    await waitFor(() => order.length === 14, 'second burst to drain')

    // stale debt would serve s2 first; a reset counter serves the waiting interactive
    assert.deepEqual(order.slice(8), [
      'start-s1',
      'end-s1',
      'start-i4',
      'end-i4',
      'start-s2',
      'end-s2',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('re-entrant declare from inside the runner is picked up', async () => {
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    const order: string[] = []
    let queue!: SessionQueue
    queue = new SessionQueue({
      broadcaster,
      registry: makeRegistry({
        a: SessionStatus.SUCCEEDED,
        b: SessionStatus.SUCCEEDED,
        i: SessionStatus.SUCCEEDED,
      }),
      runner: async (id) => {
        order.push(id)
        // resume/steer paths declare mid-run in Stages 3-4; the running pump must see them
        if (id === 'a') {
          queue.declareSession({ id: 'b', correlationId: 'c-b', task: { member: 'm' } })
          queue.declareSession({ id: 'i', correlationId: 'c-i', task: { member: 'm' } }, { lane: 'interactive' })
        }
      },
    })

    queue.declareSession({ id: 'a', correlationId: 'c-a', task: { member: 'm' } })
    await waitFor(() => order.length === 3, 're-entrant declares to run')

    assert.deepEqual(order, ['a', 'i', 'b'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('late-arriving standard is served within the bound during an active drain', async () => {
  const order: string[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  let queue!: SessionQueue
  const dir = tmpDataDir()
  try {
    const store = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(store)
    queue = new SessionQueue({
      broadcaster,
      registry: makeRegistry(
        Object.fromEntries(
          ['s1', 's2', 'sLate', 'i1', 'i2', 'i3', 'i4', 'i5'].map((id) => [id, SessionStatus.SUCCEEDED]),
        ),
      ),
      runner: async (id) => {
        order.push(id)
        if (id === 's1') await gate
        // a resume landing mid-drain joins the standard lane behind the waiter
        if (id === 'i1') queue.declareSession({ id: 'sLate', correlationId: 'c-sLate', task: { member: 'm' } })
      },
    })

    queue.declareSession({ id: 's1', correlationId: 'c-s1', task: { member: 'm' } })
    queue.declareSession({ id: 's2', correlationId: 'c-s2', task: { member: 'm' } })
    for (const id of ['i1', 'i2', 'i3', 'i4', 'i5']) {
      queue.declareSession({ id, correlationId: `c-${id}`, task: { member: 'm' } }, { lane: 'interactive' })
    }
    await waitFor(() => order.length >= 1, 's1 to start')
    release!()
    await waitFor(() => order.length === 8, 'all sessions to run')

    assert.deepEqual(order, ['s1', 'i1', 'i2', 'i3', 's2', 'i4', 'i5', 'sLate'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cancelled standard is skipped without resetting the bound', async () => {
  const order: string[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  const { dir, queue } = await openQueue(
    {
      s1: SessionStatus.SUCCEEDED,
      sX: SessionStatus.CANCELLED,
      s2: SessionStatus.SUCCEEDED,
      i1: SessionStatus.SUCCEEDED,
      i2: SessionStatus.SUCCEEDED,
      i3: SessionStatus.SUCCEEDED,
    },
    async (id) => {
      order.push(id)
      if (id === 's1') await gate
    },
  )
  try {
    queue.declareSession({ id: 's1', correlationId: 'c-s1', task: { member: 'm' } })
    queue.declareSession({ id: 'sX', correlationId: 'c-sX', task: { member: 'm' } })
    queue.declareSession({ id: 's2', correlationId: 'c-s2', task: { member: 'm' } })
    for (const id of ['i1', 'i2', 'i3']) {
      queue.declareSession({ id, correlationId: `c-${id}`, task: { member: 'm' } }, { lane: 'interactive' })
    }
    await waitFor(() => order.length >= 1, 's1 to start')
    release!()
    await waitFor(() => order.length === 5, 'all sessions to run')

    // the skip leaves the counter at 0, so all three interactives still precede s2
    assert.deepEqual(order, ['s1', 'i1', 'i2', 'i3', 's2'])
    await waitFor(() => queue.pending === 0, 'queue to drain')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a parked worker releases the slot: drain continues, started closed by session.parked', async () => {
  const order: string[] = []
  const { dir, queue, seen } = await openQueue(
    {
      p1: SessionStatus.PARKED,
      s2: SessionStatus.SUCCEEDED,
    },
    async (id) => {
      order.push(id)
    },
  )
  try {
    // p1 parks mid-run: its runner returns (slot free) and the registry will
    // read PARKED — the pump closes the started event with session.parked so
    // queue watchers never see it running-forever, then continues draining
    queue.declareSession({ id: 'p1', correlationId: 'c-p1', task: { member: 'm' } })
    queue.declareSession({ id: 's2', correlationId: 'c-s2', task: { member: 'm' } })
    await waitFor(() => order.length === 2, 'both sessions to run')

    assert.deepEqual(order, ['p1', 's2'])
    assert.ok(seen.some((e) => e.type === 'session.started' && e.sessionId === 'p1'))
    assert.ok(seen.some((e) => e.type === 'session.parked' && e.sessionId === 'p1'))
    assert.ok(!seen.some((e) => e.sessionId === 'p1' && (e.type === 'session.succeeded' || e.type === 'session.failed')))
    assert.ok(seen.some((e) => e.type === 'session.succeeded' && e.sessionId === 's2'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})