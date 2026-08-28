import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventLogStore, type BridgeEnvelope } from './bridge/EventLogStore'
import { EventBroadcaster } from './bridge/EventBroadcaster'
import { SessionQueue } from './bridge/SessionQueue'
import { SseHandler, formatSse } from './bridge/sseEndpoint'
import { createAppServer } from './server'
import { TaskRegistry } from './tasks/taskRegistry'
import { SessionStore } from './session/sessionStore'
import { log as logger } from './log'

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'atlaslink-sse-'))
}

function runEnv(eventId: number, overrides: Record<string, unknown> = {}): BridgeEnvelope {
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

async function startServer(dir: string): Promise<{
  port: number
  broadcaster: EventBroadcaster
  sse: SseHandler
  backend: SessionStore
  close: () => Promise<void>
}> {
  const log = await EventLogStore.open(dir)
  const broadcaster = new EventBroadcaster(log)
  const sse = new SseHandler(log, broadcaster)
  const registry = new TaskRegistry()
  const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
  const backend = new SessionStore()
  const { server: httpServer } = await createAppServer({ log, registry, queue, sse, backend })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const port = (httpServer.address() as AddressInfo).port
  return {
    port,
    broadcaster,
    sse,
    backend,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections?.()
        httpServer.close(() => resolve())
      }),
  }
}

/** Compact JSON request helper for the task-rest E2E surface. */
function jsonRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = request(
      `http://127.0.0.1:${port}${path}`,
      {
        method,
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      },
      (r) => {
        let data = ''
        r.setEncoding('utf8')
        r.on('data', (c: string) => (data += c))
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body: data }))
      }
    )
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

/** Connect and collect SSE data for a moment, then destroy the connection. */
function collectStream(url: string, headers: Record<string, string>, collectMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    const req = request(url, { headers }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (data += chunk))
    })
    req.on('error', () => resolve(data))
    req.end()
    setTimeout(() => {
      req.destroy()
      resolve(data)
    }, collectMs)
  })
}

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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
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
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /tasks creates a queued session in the store and returns 201', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const res = await jsonRequest(srv.port, 'POST', '/tasks', {
      member: 'the-scribe',
      prompt: 'describe the diff',
      tweaks: { provider: 'groq' },
    })
    assert.equal(res.status, 201)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.session.sessionId.startsWith('ses-'))
    assert.ok(parsed.session.correlationId.startsWith('cor-'))
    assert.equal(parsed.session.status, 'queued')
    assert.equal(parsed.session.version, 1)
    assert.deepEqual(parsed.session.tweaks, { provider: 'groq' })
    await srv.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /tasks rejects a missing prompt with the error envelope', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const res = await jsonRequest(srv.port, 'POST', '/tasks', { member: 'the-scribe' })
    assert.equal(res.status, 400)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, false)
    assert.equal(typeof parsed.error, 'string')
    await srv.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('GET /tasks/{id} returns the current aggregate; unknown ids 404', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body)
    const id = created.session.sessionId
    const res = await jsonRequest(srv.port, 'GET', `/tasks/${id}`)
    assert.equal(res.status, 200)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.session.status, 'queued')
    assert.equal(parsed.session.task.member, 'm')

    const missing = await jsonRequest(srv.port, 'GET', '/tasks/ses-nope')
    assert.equal(missing.status, 404)
    assert.equal(JSON.parse(missing.body).error, 'unknown session')
    await srv.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('GET /tasks lists sessions newest-first with filters and pagination', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    await jsonRequest(srv.port, 'POST', '/tasks', { member: 'a', prompt: 'first' })
    await jsonRequest(srv.port, 'POST', '/tasks', { member: 'b', prompt: 'second' })

    const all = JSON.parse((await jsonRequest(srv.port, 'GET', '/tasks')).body)
    assert.equal(all.total, 2)
    assert.equal(all.sessions.length, 2)
    assert.equal(all.limit, 50)
    assert.equal(all.offset, 0)
    assert.notEqual(all.sessions[0].sessionId, all.sessions[1].sessionId)

    const paged = JSON.parse((await jsonRequest(srv.port, 'GET', '/tasks?limit=1&offset=0&status=queued')).body)
    assert.equal(paged.sessions.length, 1)
    assert.equal(paged.total, 2)

    const bad = await jsonRequest(srv.port, 'GET', '/tasks?limit=999')
    assert.equal(bad.status, 400)
    await srv.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cancel moves a queued session to cancelled (202); a terminal session conflicts (409)', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const id = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session.sessionId

    const cancelled = await jsonRequest(srv.port, 'POST', `/tasks/${id}/cancel`)
    assert.equal(cancelled.status, 202)
    const cancelledBody = JSON.parse(cancelled.body)
    assert.equal(cancelledBody.status, 'cancelled')
    assert.equal(cancelledBody.session.status, 'cancelled')

    const again = await jsonRequest(srv.port, 'POST', `/tasks/${id}/cancel`)
    assert.equal(again.status, 409)
    await srv.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cancel of a running session is acknowledged as best-effort', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session
    const id = created.sessionId
    await srv.backend.append({ type: 'session.running', sessionId: id, correlationId: created.correlationId, at: new Date().toISOString() })

    const res = await jsonRequest(srv.port, 'POST', `/tasks/${id}/cancel`)
    assert.equal(res.status, 202)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.status, 'running')
    assert.equal(parsed.session.status, 'running')
    assert.equal(parsed.cancel, 'best-effort')
    await srv.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('GET /events/{id} replays and live-tails only that session\'s events', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session
    const cor = created.correlationId

    srv.broadcaster.emit(runEnv(0, { type: 'run.started', correlationId: cor }))
    srv.broadcaster.emit(runEnv(1, { type: 'run.started', correlationId: 'cor-other' }))

    const body = await collectStream(
      `http://127.0.0.1:${srv.port}/events/${created.sessionId}`,
      { 'Last-Event-ID': '0' },
      900
    )
    assert.ok(body.includes('"correlationId":"' + cor + '"'))
    assert.ok(!body.includes('"correlationId":"cor-other"'))
    await srv.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('task-rest routes honor the pre-auth bearer token gate (spec §7)', async () => {
  const previous = process.env.ATLASLINK_API_TOKEN
  process.env.ATLASLINK_API_TOKEN = 'secret'
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const denied = await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })
    assert.equal(denied.status, 401)

    const wrong = await jsonRequest(
      srv.port,
      'GET',
      '/tasks',
      undefined,
      { authorization: 'Bearer nope' }
    )
    assert.equal(wrong.status, 401)

    const allowed = await jsonRequest(
      srv.port,
      'POST',
      '/tasks',
      { member: 'm', prompt: 'p' },
      { authorization: 'Bearer secret' }
    )
    assert.equal(allowed.status, 201)

    // the gate is scoped to task routes — /health stays open
    const health = await jsonRequest(srv.port, 'GET', '/health')
    assert.equal(health.status, 200)
    await srv.close()
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_API_TOKEN
    else process.env.ATLASLINK_API_TOKEN = previous
    rmSync(dir, { recursive: true, force: true })
  }
})