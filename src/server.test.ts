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

async function startServer(dir: string): Promise<{ port: number; broadcaster: EventBroadcaster; sse: SseHandler; close: () => Promise<void> }> {
  const log = await EventLogStore.open(dir)
  const broadcaster = new EventBroadcaster(log)
  const sse = new SseHandler(log, broadcaster)
  const registry = new TaskRegistry()
  const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
  const { server: httpServer } = createAppServer({ log, registry, queue, sse })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const port = (httpServer.address() as AddressInfo).port
  return {
    port,
    broadcaster,
    sse,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections?.()
        httpServer.close(() => resolve())
      }),
  }
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

test('POST /runs rejects non-string member or prompt', async () => {
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