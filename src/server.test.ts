import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { EventLogStore } from './bridge/EventLogStore'
import { EventBroadcaster } from './bridge/EventBroadcaster'
import { SessionQueue } from './bridge/SessionQueue'
import { SseHandler, formatSse } from './bridge/sseEndpoint'
import { createAppServer, asAskHumanQuestion } from './server'
import { ASK_HUMAN_MAX_CONTEXT_LENGTH, ASK_HUMAN_MAX_QUESTION_LENGTH } from 'agenthood/dist/tools/human/AskHumanTool.js'
import { TaskRegistry } from './tasks/taskRegistry'
import { log as logger } from './log'
import { tmpDataDir, runEnv, startServer, collectStream, cleanup } from './test/serverHarness'

test('formatSse emits id/event/data framing per spec §4 with newline terminator', () => {
  const frame = formatSse(runEnv(12, { type: 'tool.called', step: 1, name: 'read_file', args: {} }))
  assert.ok(frame.startsWith('id: 12\n'))
  assert.match(frame, /\nevent: tool\.called\n/)
  assert.match(frame, /data: \{"eventId":12,/)
  assert.ok(frame.endsWith('\n\n'))
})

test('GET /health returns ok status', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const body = await collectStream(`http://127.0.0.1:${srv.port}/health`, {}, 1500)
    assert.ok(body.includes('"ok":true'))
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('every request emits a structured "request" log line', async () => {
  const dir = tmpDataDir()
  try {
    const info = mock.method(logger, 'info')
    const srv = await startServer(dir)
    const body = await collectStream(`http://127.0.0.1:${srv.port}/health`, {}, 1500)
    assert.ok(body.includes('"ok":true'))
    const reqCall = info.mock.calls.find((c) => c.arguments[0] === 'request')
    assert.ok(reqCall, `expected a 'request' log, got: ${info.mock.calls.map((c) => String(c.arguments[0])).join(',')}`)
    const fields = reqCall!.arguments[1] as Record<string, unknown>
    assert.equal(fields.method, 'GET')
    assert.equal(fields.url, '/health')
    assert.equal(fields.status, 200)
    assert.equal(typeof fields.durationMs, 'number')
    info.mock.restore()
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /events does not emit a "request" log (long-lived SSE)', async () => {
  const dir = tmpDataDir()
  try {
    const info = mock.method(logger, 'info')
    const srv = await startServer(dir)
    await collectStream(`http://127.0.0.1:${srv.port}/events`, {}, 500)
    // query strings and trailing slashes resolve to the same SSE route
    await collectStream(`http://127.0.0.1:${srv.port}/events?token=x`, {}, 500)
    const sseReq = info.mock.calls.find(
      (c) =>
        c.arguments[0] === 'request' &&
        ((c.arguments[1] as Record<string, unknown>).url === '/events' ||
          (c.arguments[1] as Record<string, unknown>).url === '/events?token=x')
    )
    assert.equal(sseReq, undefined, `expected no 'request' log for /events, got: ${JSON.stringify(sseReq)}`)
    info.mock.restore()
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /events with Last-Event-ID replays events after that id', async () => {
  const dir = tmpDataDir()
  try {
    const log = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(log)
    broadcaster.emit(runEnv(0, { type: 'run.started' }))
    broadcaster.emit(runEnv(1, { type: 'reasoning', step: 1, content: 'a' }))
    broadcaster.emit(runEnv(2, { type: 'tool.called', step: 1, name: 'read_file' }))

    const sse = new SseHandler(log, broadcaster)
    const srv = await startServer(dir)
    const body = await collectStream(`http://127.0.0.1:${srv.port}/events`, { 'Last-Event-ID': '1' }, 1200)
    assert.ok(body.includes('id: 2'))
    assert.ok(!body.includes('id: 0'))
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /events with no Last-Event-ID is live-tail only (no replay)', async () => {
  const dir = tmpDataDir()
  try {
    const log = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(log)
    broadcaster.emit(runEnv(0, { type: 'run.started' }))
    broadcaster.emit(runEnv(1, { type: 'run.started' }))

    const sse = new SseHandler(log, broadcaster)
    const srv = await startServer(dir)
    const body = await collectStream(`http://127.0.0.1:${srv.port}/events`, {}, 1000)
    assert.ok(!body.includes('id: 0'))
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /events with a stale Last-Event-ID emits bridge.gap, never silence', async () => {
  const dir = tmpDataDir()
  try {
    const log = await EventLogStore.open(dir)
    log.append(runEnv(3, { type: 'run.started' }))
    log.append(runEnv(4, { type: 'run.started' }))
    assert.equal(log.oldestId, 3)

    const sse = new SseHandler(log, new EventBroadcaster(log))
    const srv = await startServer(dir)
    const body = await collectStream(`http://127.0.0.1:${srv.port}/events`, { 'Last-Event-ID': '0' }, 1000)
    assert.ok(body.includes('event: bridge.gap'))
    assert.match(body, /"requested":0/)
    assert.match(body, /"oldest":3/)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /runs declares a session and returns 202 with its id', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const res = await new Promise<{ status: number; body: string }>((resolve) => {
      const req = request(`http://127.0.0.1:${srv.port}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => {
        let body = ''
        r.setEncoding('utf8')
        r.on('data', (c: string) => (body += c))
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body }))
      })
      req.write(JSON.stringify({ member: 'the-scribe', prompt: 'draft a commit message' }))
      req.end()
    })
    assert.equal(res.status, 202)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.session.id.startsWith('ses-'))
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /runs rejects non-string member or prompt with the error envelope', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const res = await new Promise<{ status: number; body: string }>((resolve) => {
      const req = request(`http://127.0.0.1:${srv.port}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => {
        let body = ''
        r.setEncoding('utf8')
        r.on('data', (c: string) => (body += c))
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body }))
      })
      req.write(JSON.stringify({ member: 42, prompt: {} }))
      req.end()
    })
    assert.equal(res.status, 400)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, false)
    assert.equal(typeof parsed.error, 'string')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /runs rejects malformed JSON with the error envelope', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const res = await new Promise<{ status: number; body: string }>((resolve) => {
      const req = request(`http://127.0.0.1:${srv.port}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => {
        let body = ''
        r.setEncoding('utf8')
        r.on('data', (c: string) => (body += c))
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body }))
      })
      req.write('{"member": ')
      req.end()
    })
    assert.equal(res.status, 400)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, false)
    assert.equal(typeof parsed.error, 'string')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /events streams newly emitted events live while connected', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const collected: string[] = []
    const connection = request(`http://127.0.0.1:${srv.port}/events`, (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => collected.push(chunk))
    })
    connection.end()
    await new Promise((r) => setTimeout(r, 200))

    srv.broadcaster.emit(runEnv(0, { type: 'tool.result', step: 1, name: 'read_file', output: 'ok', durationMs: 1 }))
    await new Promise((r) => setTimeout(r, 200))

    const joined = collected.join('')
    assert.ok(joined.includes('id: 0'))
    assert.ok(joined.includes('event: tool.result'))
    connection.destroy()
    await new Promise((r) => setTimeout(r, 50))
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /events returns 404 JSON for unknown routes', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const body = await collectStream(`http://127.0.0.1:${srv.port}/nope`, {}, 1200)
    assert.ok(body.includes('"error":"not found"'))
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('createAppServer builds the HTTP layer on Fastify (ADR-006 Decision 1)', async () => {
  const dir = tmpDataDir()
  try {
    const log = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(log)
    const sse = new SseHandler(log, broadcaster)
    const registry = new TaskRegistry()
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
    const { app, server } = await createAppServer({ log, registry, queue, sse })
    assert.ok(app.version.startsWith('5.'), `expected Fastify 5, got ${app.version}`)
    assert.equal(typeof app.inject, 'function')
    assert.ok(typeof server === 'object' && server !== null)
    sse.shutdown()
  } finally {
    cleanup(dir)
  }
})

test('asAskHumanQuestion accepts the unified payload and rejects everything else', () => {
  const good = { question: 'Ship it?', context: 'release vote' }
  assert.deepEqual(asAskHumanQuestion(good), good)
  assert.deepEqual(asAskHumanQuestion({ question: 'Ship it?' }), { question: 'Ship it?' })
  assert.equal(asAskHumanQuestion(undefined), undefined)
  assert.equal(asAskHumanQuestion(null), undefined)
  assert.equal(asAskHumanQuestion('continue?'), undefined)
  assert.equal(asAskHumanQuestion({}), undefined)
  assert.equal(asAskHumanQuestion({ questions: [{ label: 'Ship it?' }] }), undefined)
  // caps are the agenthood tool schema limits — a compromised runner cannot park unbounded input
  assert.equal(asAskHumanQuestion({ question: '' }), undefined)
  assert.equal(
    asAskHumanQuestion({ question: 'Q'.repeat(ASK_HUMAN_MAX_QUESTION_LENGTH + 1) }),
    undefined
  )
  assert.equal(
    asAskHumanQuestion({ question: 'q', context: 'C'.repeat(ASK_HUMAN_MAX_CONTEXT_LENGTH + 1) }),
    undefined
  )
  assert.equal(asAskHumanQuestion({ question: 'q', context: 7 }), undefined)
})