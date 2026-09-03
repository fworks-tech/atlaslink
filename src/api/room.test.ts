import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { tmpDataDir, startServer, jsonRequest, cleanup } from '../test/serverHarness'
import type { SessionBackend } from '../session/sessionBackend'
import type { Session } from '../session/types'
import type { BridgeEnvelope } from '../bridge/EventLogStore'
import { roomFilter, snapshotOf } from './room'

// A failing test must not pin the process: every socket is tracked and
// terminated after each test, so a mid-test assertion never leaks a live
// connection that keeps the event loop (and node --test) hanging.
const liveSockets = new Set<WebSocket>()
const liveServers = new Set<() => Promise<void>>()
afterEach(async () => {
  for (const ws of liveSockets) {
    try {
      ws.terminate()
    } catch {
      // already gone
    }
  }
  liveSockets.clear()
  for (const close of liveServers) {
    try {
      await close()
    } catch {
      // already closed by the test
    }
  }
  liveServers.clear()
})

interface CollectedClient {
  ws: WebSocket
  frames: Array<Record<string, unknown>>
  closeCode: number | null
  closed: Promise<void>
}

async function connect(port: number, path: string, headers: Record<string, string> = {}): Promise<CollectedClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers })
  liveSockets.add(ws)
  const frames: Array<Record<string, unknown>> = []
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  const client: CollectedClient = { ws, frames, closeCode: null, closed }
  ws.on('message', (data) => {
    try {
      frames.push(JSON.parse(data.toString()) as Record<string, unknown>)
    } catch {
      // non-JSON frames are never sent by the room; ignore
    }
  })
  ws.on('close', (code: number) => {
    client.closeCode = code
    liveSockets.delete(ws)
    resolveClosed()
  })
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', (err) => reject(err))
    ws.on('close', (code: number) => reject(new Error(`closed before open: ${code}`)))
  })
  return client
}

async function waitForFrame(
  frames: Array<Record<string, unknown>>,
  pred: (f: Record<string, unknown>) => boolean,
  what: string
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5000
  for (;;) {
    const found = frames.find(pred)
    if (found) return found
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Servers are tracked like sockets: a mid-test failure still closes them. */
async function trackedServer(
  dir: string,
  opts?: Parameters<typeof startServer>[1]
): Promise<Awaited<ReturnType<typeof startServer>>> {
  const srv = await startServer(dir, opts)
  liveServers.add(srv.close)
  return srv
}

async function parkSession(backend: SessionBackend, sessionId: string, correlationId: string): Promise<void> {  const at = new Date().toISOString()
  await backend.append({ type: 'session.running', sessionId, correlationId, at })
  await backend.append({
    type: 'session.awaiting_input',
    sessionId,
    correlationId,
    at,
    member: 'the-architect',
    question: { question: 'Ship it?', context: 'plan context' },
  })
}

// The room's pure helpers sit at the bottom of the pyramid: fast unit tests,
// no server, covering the branches the integration tests cannot reach cheaply
// (correlation fallback, history bounds, field passthrough).
function unitSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'ses-1',
    correlationId: 'cor-1',
    status: 'queued',
    version: 3,
    task: { member: 'm', prompt: 'p' },
    interaction: [],
    nextStep: null,
    replyCount: 0,
    diagram: null,
    ...overrides,
  }
}

test('roomFilter matches this session, else falls back to its correlation', async () => {
  const sessionHit = { sessionId: 'ses-1' } as unknown as BridgeEnvelope
  assert.equal(roomFilter(sessionHit, 'ses-1', 'cor-1'), true)
  assert.equal(roomFilter(sessionHit, 'ses-2', 'cor-1'), false)

  // sessionId wins over correlation: another session's run events stay out
  const otherRun = { sessionId: 'ses-9', correlationId: 'cor-1' } as unknown as BridgeEnvelope
  assert.equal(roomFilter(otherRun, 'ses-1', 'cor-1'), false)

  // envelopes without a sessionId (run events) join via correlation
  const ownRun = { correlationId: 'cor-1' } as unknown as BridgeEnvelope
  assert.equal(roomFilter(ownRun, 'ses-1', 'cor-1'), true)
  const foreignRun = { correlationId: 'cor-9' } as unknown as BridgeEnvelope
  assert.equal(roomFilter(foreignRun, 'ses-1', 'cor-1'), false)
})

test('snapshotOf bounds history and passes optional fields through', async () => {
  const turn = (i: number) => ({ role: 'user' as const, at: 't', content: `m${i}` })
  const snap = snapshotOf(
    unitSession({ interaction: Array.from({ length: 60 }, (_, i) => turn(i)) })
  )
  assert.equal((snap.interaction as unknown[]).length, 50)
  assert.equal(((snap.interaction as Array<{ content: string }>)[0] as { content: string }).content, 'm10')
  assert.equal(snap.member, 'm')
  assert.equal(snap.version, 3)
  assert.ok(!('projectId' in snap) && !('question' in snap) && !('resumeOf' in snap))

  const full = snapshotOf(
    unitSession({
      projectId: 'proj-1',
      question: { question: 'Go?', context: 'why' },
      resumeOf: 'ses-0',
    })
  )
  assert.equal(full.projectId, 'proj-1')
  assert.equal(full.resumeOf, 'ses-0')
  assert.deepEqual((full.question as { question: string }).question, 'Go?')
})

test('room join delivers snapshot; two clients see each other chat live', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room?name=Alice`)
    const snapshot = await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')
    assert.equal((snapshot.session as { status: string }).status, 'queued')
    const joined = await waitForFrame(a.frames, (f) => f.type === 'joined', 'joined')
    assert.equal(typeof joined.clientId, 'string')

    const b = await connect(srv.port, `/sessions/${created.sessionId}/room?name=Bob`)
    // presence converges on both sides
    const presenceB = await waitForFrame(
      b.frames,
      (f) => f.type === 'presence' && (f.members as Array<{ name: string }>).length === 2,
      'roster of two'
    )
    assert.deepEqual((presenceB.members as Array<{ name: string }>).map((m) => m.name).sort(), ['Alice', 'Bob'])
    // the roster carries the joiner's own client id, not just its name
    assert.ok(
      (presenceB.members as Array<{ id: string }>).some((m) => m.id === joined.clientId),
      'roster contains the joined client id'
    )
    await waitForFrame(
      a.frames,
      (f) => f.type === 'presence' && (f.members as Array<{ name: string }>).length === 2,
      'roster of two on A'
    )

    a.ws.send(JSON.stringify({ id: 'c1', type: 'chat', content: 'hello room' }))
    const ack = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 'c1', 'chat ack')
    assert.deepEqual([ack.ok, ack.code], [true, 201])
    // both humans see the message live — no polling
    const onB = await waitForFrame(
      b.frames,
      (f) => f.type === 'event' && (f.event as { type?: string }).type === 'session.message',
      'message on B'
    )
    assert.equal((onB.event as { message?: string }).message, 'hello room')
    await waitForFrame(
      a.frames,
      (f) => f.type === 'event' && (f.event as { type?: string }).type === 'session.message',
      'message echo on A'
    )

    // leave broadcasts the shrunken roster
    a.ws.close()
    await a.closed
    await waitForFrame(
      b.frames,
      (f) => f.type === 'presence' && (f.members as Array<{ name: string }>).length === 1,
      'roster after leave'
    )
    b.ws.close()
    await b.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room rejects other tenants without an existence oracle', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse(
      (await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' }, { 'x-tenant-id': 'tenant-a' })).body
    ).session

    // tenant B guesses the session id: same answer as a missing session
    const intruder = await connect(srv.port, `/sessions/${created.sessionId}/room?tenant=tenant-b`)
    await intruder.closed
    assert.equal(intruder.closeCode, 4404)

    // the owning tenant joins fine
    const owner = await connect(srv.port, `/sessions/${created.sessionId}/room?tenant=tenant-a`)
    await waitForFrame(owner.frames, (f) => f.type === 'snapshot', 'owner snapshot')
    owner.ws.close()
    await owner.closed

    // invalid tenant values never reach the store
    const bad = await connect(srv.port, `/sessions/${created.sessionId}/room?tenant=!!!`)
    await bad.closed
    assert.equal(bad.closeCode, 4400)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room resume replays missed events; fallen-off cursors get a gap', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')
    a.ws.send(JSON.stringify({ id: 'c1', type: 'chat', content: 'first' }))
    const first = await waitForFrame(
      a.frames,
      (f) => f.type === 'event' && (f.event as { message?: string }).message === 'first',
      'first message event'
    )
    const cursor = (first.event as { eventId: number }).eventId
    assert.equal(typeof cursor, 'number')
    a.ws.close()
    await a.closed

    // missed while away: recorded via plain HTTP, lands in the backlog
    await jsonRequest(srv.port, 'POST', `/tasks/${created.sessionId}/message`, { content: 'second' })

    const b = await connect(srv.port, `/sessions/${created.sessionId}/room?since=${cursor}`)
    const backlog = await waitForFrame(b.frames, (f) => f.type === 'backlog', 'backlog')
    const messages = (backlog.events as Array<{ message?: string }>).map((e) => e.message)
    assert.ok(messages.includes('second'))
    assert.ok(!messages.includes('first'))
    b.ws.close()
    await b.closed

    // eventIds start at 0, so a cursor older than retention is negative here —
    // a real client holds such a cursor after log rotation pruned its tail.
    // It gets an explicit gap, never silence.
    const c = await connect(srv.port, `/sessions/${created.sessionId}/room?since=-1`)
    const gap = await waitForFrame(c.frames, (f) => f.type === 'gap', 'gap')
    assert.equal(gap.requested, -1)
    assert.ok(typeof gap.oldest === 'number' && (gap.oldest as number) >= 0)
    c.ws.close()
    await c.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room approval inbox: parked question in snapshot, reply frame resumes', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse(
      (await jsonRequest(srv.port, 'POST', '/tasks', { member: 'the-architect', prompt: 'plan' })).body
    ).session
    await parkSession(srv.backend, created.sessionId, created.correlationId)

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room`)
    const snapshot = await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')
    const snap = snapshot.session as { status: string; nextStep: { awaiting_input: boolean; prompt: string }; question: { question: string; context?: string } }
    assert.equal(snap.status, 'awaiting_input')
    assert.equal(snap.nextStep.prompt, 'Ship it?')
    assert.deepEqual([snap.question.question, snap.question.context], ['Ship it?', 'plan context'])

    a.ws.send(JSON.stringify({ id: 'r1', type: 'reply', content: 'yes' }))
    const ack = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 'r1', 'reply ack')
    assert.equal(ack.ok, true)
    assert.ok(typeof ack.resumedSessionId === 'string')

    const followup = JSON.parse((await jsonRequest(srv.port, 'GET', `/tasks/${ack.resumedSessionId}`)).body).session
    assert.equal(followup.resumeOf, created.sessionId)
    assert.ok(followup.task.prompt.includes('yes\n</human_reply>'))
    a.ws.close()
    await a.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room steer rewrites queued prompts and interrupts fabricated runs', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'old' })).body).session

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')
    a.ws.send(JSON.stringify({ id: 's1', type: 'steer', content: 'new' }))
    const ack = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 's1', 'steer ack')
    assert.equal(ack.ok, true)
    const steered = JSON.parse((await jsonRequest(srv.port, 'GET', `/tasks/${created.sessionId}`)).body).session
    assert.equal(steered.task.prompt, 'new')

    // fabricated live run: registry started + controller attached + store running
    srv.registry.start(created.sessionId)
    const controller = new AbortController()
    srv.registry.attachAbort(created.sessionId, controller)
    await srv.backend.append({
      type: 'session.running',
      sessionId: created.sessionId,
      correlationId: created.correlationId,
      at: new Date().toISOString(),
    })
    a.ws.send(JSON.stringify({ id: 's2', type: 'steer', content: 'pivot' }))
    const interrupted = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 's2', 'interrupt ack')
    assert.equal(interrupted.ok, true)
    assert.equal(interrupted.interrupted, true)
    assert.equal(controller.signal.aborted, true)
    a.ws.close()
    await a.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

/** Raw upgrade probe: resolves the HTTP status when the gate refuses the
 *  upgrade, so a mid-test failure cannot leave a promise — and the process —
 *  hanging. First settlement wins; a refused upgrade never opens. */
async function probeUpgradeStatus(port: number, path: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    liveSockets.add(ws)
    ws.on('unexpected-response', (_req, res) => {
      // the upgrade was refused: no socket to tear down, just resolve
      liveSockets.delete(ws)
      resolve(res.statusCode ?? -1)
    })
    ws.on('open', () => {
      ws.terminate()
      resolve(-1)
    })
    // refused upgrades surface via unexpected-response/close, never error
    ws.on('error', () => {})
    ws.on('close', () => resolve(-2))
  })
}

test('room auth refuses missing and wrong credentials; both bearer paths join', async () => {
  const dir = tmpDataDir()
  // the harness restores the ambient env after registration, but the gate
  // captured 'secret' then — pin it for the test's lifetime so request-time
  // checks (gate + handler) see the same production configuration
  const previousToken = process.env.ATLASLINK_API_TOKEN
  process.env.ATLASLINK_API_TOKEN = 'secret'
  try {
    const srv = await trackedServer(dir, { token: 'secret' })
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' }, { authorization: 'Bearer secret' })).body)
      .session

    // no credential at all: the gate rejects the upgrade itself (401, no socket)
    assert.equal(await probeUpgradeStatus(srv.port, `/sessions/${created.sessionId}/room`), 401)
    // a wrong bearer is the same refusal, never a join
    assert.equal(await probeUpgradeStatus(srv.port, `/sessions/${created.sessionId}/room?token=wrong`), 401)

    // header bearer still works where clients can set it
    const viaHeader = await connect(
      srv.port,
      `/sessions/${created.sessionId}/room`,
      { authorization: 'Bearer secret' }
    )
    await waitForFrame(viaHeader.frames, (f) => f.type === 'snapshot', 'header-auth snapshot')
    viaHeader.ws.close()
    await viaHeader.closed

    // query bearer is the browser path (WS cannot set headers)
    const a = await connect(srv.port, `/sessions/${created.sessionId}/room?token=secret`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'query-auth snapshot')
    a.ws.close()
    await a.closed
    await srv.close()
  } finally {
    if (previousToken === undefined) delete process.env.ATLASLINK_API_TOKEN
    else process.env.ATLASLINK_API_TOKEN = previousToken
    cleanup(dir)
  }
})

test('room closes unknown sessions without an oracle', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session

    const missing = await connect(srv.port, '/sessions/ses-missing/room')
    await missing.closed
    assert.equal(missing.closeCode, 4404)

    // the real session still joins: the 4404 reveals nothing either way
    const a = await connect(srv.port, `/sessions/${created.sessionId}/room`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')
    a.ws.close()
    await a.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room validates ingress frames without dropping the connection', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')

    // malformed JSON errors but keeps the connection alive
    a.ws.send('this is not json')
    await waitForFrame(a.frames, (f) => f.type === 'error' && f.error === 'malformed frame', 'malformed error')
    a.ws.send(JSON.stringify({ type: 'chat', content: 'still here' }))
    await waitForFrame(a.frames, (f) => f.type === 'ack' && f.ok === true, 'post-error ack')

    // unknown frame types echo the client id so the sender can match them
    a.ws.send(JSON.stringify({ id: 'u1', type: 'dance', content: 'x' }))
    const unknown = await waitForFrame(a.frames, (f) => f.type === 'error' && f.id === 'u1', 'unknown-type error')
    assert.equal(unknown.error, 'unknown frame type')

    // non-string content is a 400 ack, not a crash
    a.ws.send(JSON.stringify({ id: 'u2', type: 'chat', content: 42 }))
    const mistyped = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 'u2', 'mistyped ack')
    assert.deepEqual([mistyped.ok, mistyped.code], [false, 400])

    // oversize content is rejected as an ack, not a drop
    a.ws.send(JSON.stringify({ id: 'u3', type: 'chat', content: 'x'.repeat(10001) }))
    const tooLong = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 'u3', 'oversize ack')
    assert.deepEqual([tooLong.ok, tooLong.code], [false, 400])

    // an oversize raw frame errors with no ack — and the room stays open
    a.ws.send(JSON.stringify({ id: 'u4', type: 'chat', content: 'y'.repeat(140 * 1024) }))
    await waitForFrame(a.frames, (f) => f.type === 'error' && f.error === 'frame too large', 'frame-too-large error')
    assert.ok(!a.frames.some((f) => f.type === 'ack' && f.id === 'u4'), 'no ack for the dropped frame')
    a.ws.send(JSON.stringify({ id: 'u5', type: 'chat', content: 'after the flood' }))
    const alive = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 'u5', 'post-flood ack')
    assert.equal(alive.ok, true)

    a.ws.close()
    await a.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room throttles per-connection ingress floods', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')
    for (let i = 0; i < 61; i++) {
      a.ws.send(JSON.stringify({ id: `f${i}`, type: 'chat', content: `flood ${i}` }))
    }
    const limited = await waitForFrame(
      a.frames,
      (f) => f.type === 'ack' && f.ok === false && f.code === 429,
      'rate-limit ack'
    )
    assert.equal(limited.error, 'room ingress rate exceeded')
    a.ws.close()
    await a.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room fan-out never crosses sessions', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const first = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'one' })).body).session
    const second = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'two' })).body).session

    const a = await connect(srv.port, `/sessions/${first.sessionId}/room`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot A')
    const b = await connect(srv.port, `/sessions/${second.sessionId}/room`)
    await waitForFrame(b.frames, (f) => f.type === 'snapshot', 'snapshot B')

    a.ws.send(JSON.stringify({ id: 'x1', type: 'chat', content: 'for A only' }))
    await waitForFrame(
      a.frames,
      (f) => f.type === 'event' && (f.event as { message?: string }).message === 'for A only',
      'message on A'
    )
    // the event crossed the wire already — B staying quiet is the assertion
    await new Promise((r) => setTimeout(r, 200))
    assert.ok(
      !b.frames.some((f) => f.type === 'event'),
      'session B room received no live events from session A'
    )
    a.ws.close()
    await a.closed
    b.ws.close()
    await b.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room maps store failures to error acks, not silent success', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session
    await jsonRequest(srv.port, 'POST', `/tasks/${created.sessionId}/cancel`)

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')

    a.ws.send(JSON.stringify({ id: 'e1', type: 'chat', content: 'too late' }))
    const chatFail = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 'e1', 'chat failure ack')
    assert.deepEqual([chatFail.ok, chatFail.code], [false, 409])

    a.ws.send(JSON.stringify({ id: 'e2', type: 'reply', content: 'nothing parked' }))
    const replyFail = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 'e2', 'reply failure ack')
    assert.deepEqual([replyFail.ok, replyFail.code], [false, 409])

    a.ws.send(JSON.stringify({ id: 'e3', type: 'steer', content: 'nowhere to go' }))
    const steerFail = await waitForFrame(a.frames, (f) => f.type === 'ack' && f.id === 'e3', 'steer failure ack')
    assert.deepEqual([steerFail.ok, steerFail.code], [false, 409])

    a.ws.close()
    await a.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room sanitizes display names before they reach the roster', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session

    const joinName = async (raw: string): Promise<string> => {
      const client = await connect(srv.port, `/sessions/${created.sessionId}/room?name=${encodeURIComponent(raw)}`)
      const presence = await waitForFrame(
        client.frames,
        (f) => f.type === 'presence' && (f.members as unknown[]).length === 1,
        `presence for ${JSON.stringify(raw)}`
      )
      const name = ((presence.members as Array<{ name: string }>)[0] as { name: string }).name
      client.ws.close()
      await client.closed
      return name
    }

    assert.equal(await joinName(' Bob '), 'Bob')
    assert.equal(await joinName('   '), 'anonymous')
    assert.equal(await joinName('A'.repeat(60)), 'A'.repeat(50))
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room honors the tenant upgrade header, not just the query', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse(
      (await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' }, { 'x-tenant-id': 'tenant-a' })).body
    ).session

    const owner = await connect(srv.port, `/sessions/${created.sessionId}/room`, { 'x-tenant-id': 'tenant-a' })
    await waitForFrame(owner.frames, (f) => f.type === 'snapshot', 'header-tenant snapshot')
    owner.ws.close()
    await owner.closed

    const intruder = await connect(srv.port, `/sessions/${created.sessionId}/room`, { 'x-tenant-id': 'tenant-b' })
    await intruder.closed
    assert.equal(intruder.closeCode, 4404)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room rejects a non-numeric since cursor with an explicit error', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room?since=not-a-number`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')
    const err = await waitForFrame(a.frames, (f) => f.type === 'error', 'invalid-since error')
    assert.match(err.error as string, /invalid since/)
    assert.ok(!a.frames.some((f) => f.type === 'backlog' || f.type === 'gap'), 'no resume frames for a bad cursor')
    a.ws.close()
    await a.closed
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('room members exposes the live roster without an oracle', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await trackedServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' }, { 'x-tenant-id': 'tenant-a' })).body).session
    const membersPath = (tenant?: string): string =>
      `/sessions/${created.sessionId}/room/members${tenant ? `?tenant=${tenant}` : ''}`

    // valid session, nobody joined: an empty roster, not a 404
    const empty = await jsonRequest(srv.port, 'GET', membersPath('tenant-a'))
    assert.equal(empty.status, 200)
    assert.deepEqual(JSON.parse(empty.body), { ok: true, members: [] })

    const a = await connect(srv.port, `/sessions/${created.sessionId}/room?name=Alice&tenant=tenant-a`)
    await waitForFrame(a.frames, (f) => f.type === 'snapshot', 'snapshot')
    const one = JSON.parse((await jsonRequest(srv.port, 'GET', membersPath('tenant-a'))).body)
    assert.deepEqual(
      (one.members as Array<{ name: string }>).map((m) => m.name),
      ['Alice']
    )
    a.ws.close()
    await a.closed
    // the server processes the leave asynchronously: poll until it drains
    const deadline = Date.now() + 5000
    for (;;) {
      const drained = JSON.parse((await jsonRequest(srv.port, 'GET', membersPath('tenant-a'))).body)
      if ((drained.members as unknown[]).length === 0) break
      if (Date.now() > deadline) throw new Error('roster did not drain after leave')
      await new Promise((r) => setTimeout(r, 5))
    }

    // unknown ids and other tenants read the same: 404, no oracle
    assert.equal((await jsonRequest(srv.port, 'GET', '/sessions/ses-missing/room/members')).status, 404)
    assert.equal((await jsonRequest(srv.port, 'GET', membersPath('tenant-b'))).status, 404)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})
