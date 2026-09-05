import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { EventLogStore } from '../bridge/EventLogStore'
import { EventBroadcaster } from '../bridge/EventBroadcaster'
import { SessionQueue } from '../bridge/SessionQueue'
import { SseHandler } from '../bridge/sseEndpoint'
import { createAppServer } from '../server'
import { TaskRegistry } from '../tasks/taskRegistry'
import { SessionStore } from '../session/sessionStore'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'

function jsonReq(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve) => {
    const req = request(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    }, (r) => {
      r.resume()
      r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers }))
    })
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

async function startTestServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const previousToken = process.env.ATLASLINK_API_TOKEN
  delete process.env.ATLASLINK_API_TOKEN
  try {
    const dir = mkdtempSync(join(tmpdir(), 'atlaslink-secheaders-'))
    const log = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(log)
    const sse = new SseHandler(log, broadcaster)
    const registry = new TaskRegistry()
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
    const backend = new SessionStore()
    const app = await createAppServer({ log, registry, queue, sse, backend })
    const httpServer = app.server
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r))
    const port = (httpServer.address() as AddressInfo).port
    return {
      port,
      close: async () => {
        httpServer.closeAllConnections?.()
        await new Promise<void>((r) => httpServer.close(() => r()))
        rmSync(dir, { recursive: true, force: true })
      },
    }
  } finally {
    if (previousToken === undefined) delete process.env.ATLASLINK_API_TOKEN
    else process.env.ATLASLINK_API_TOKEN = previousToken
  }
}

test('security headers — X-Content-Type-Options is nosniff', async () => {
  const { port, close } = await startTestServer()
  try {
    const res = await jsonReq(port, 'GET', '/health')
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
  } finally {
    await close()
  }
})

test('security headers — X-Frame-Options is DENY', async () => {
  const { port, close } = await startTestServer()
  try {
    const res = await jsonReq(port, 'GET', '/health')
    assert.equal(res.headers['x-frame-options'], 'DENY')
  } finally {
    await close()
  }
})

test('security headers — Referrer-Policy is strict-origin-when-cross-origin', async () => {
  const { port, close } = await startTestServer()
  try {
    const res = await jsonReq(port, 'GET', '/health')
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin')
  } finally {
    await close()
  }
})

test('security headers — Permissions-Policy restricts camera, microphone, geolocation', async () => {
  const { port, close } = await startTestServer()
  try {
    const res = await jsonReq(port, 'GET', '/health')
    const pp = res.headers['permissions-policy'] as string
    assert.ok(pp.includes('camera=()'))
    assert.ok(pp.includes('microphone=()'))
    assert.ok(pp.includes('geolocation=()'))
  } finally {
    await close()
  }
})

test('security headers — Content-Security-Policy blocks object-src and frame-ancestors', async () => {
  const { port, close } = await startTestServer()
  try {
    const res = await jsonReq(port, 'GET', '/health')
    const csp = res.headers['content-security-policy'] as string
    assert.ok(csp.includes("object-src 'none'"))
    assert.ok(csp.includes("frame-ancestors 'none'"))
    assert.ok(csp.includes("default-src 'self'"))
  } finally {
    await close()
  }
})

test('security headers — present on error responses too', async () => {
  const { port, close } = await startTestServer()
  try {
    const res = await jsonReq(port, 'GET', '/nonexistent')
    assert.equal(res.status, 404)
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(res.headers['x-frame-options'], 'DENY')
  } finally {
    await close()
  }
})
