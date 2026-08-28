import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventLogStore, type BridgeEnvelope } from '../bridge/EventLogStore'
import { EventBroadcaster } from '../bridge/EventBroadcaster'
import { SessionQueue } from '../bridge/SessionQueue'
import { SseHandler } from '../bridge/sseEndpoint'
import { createAppServer } from '../server'
import { TaskRegistry } from '../tasks/taskRegistry'
import { SessionStore } from '../session/sessionStore'

export function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'atlaslink-sse-'))
}

export function runEnv(eventId: number, overrides: Record<string, unknown> = {}): BridgeEnvelope {
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

export interface ServerHarness {
  port: number
  broadcaster: EventBroadcaster
  sse: SseHandler
  backend: SessionStore
  close: () => Promise<void>
}

export interface HarnessOptions {
  /** Bearer token to register on the gated scope (default: none → dev mode). */
  token?: string
  rateLimit?: { max: number; timeWindow: string }
}

export async function startServer(dir: string, opts: HarnessOptions = {}): Promise<ServerHarness> {
  // The token gate reads the env at registration; snapshot/restore so a dev
  // shell exporting ATLASLINK_API_TOKEN never leaks into the unauthenticated
  // tests, and an opted-in test can pass its own token deterministically.
  const previousToken = process.env.ATLASLINK_API_TOKEN
  if (opts.token === undefined) delete process.env.ATLASLINK_API_TOKEN
  else process.env.ATLASLINK_API_TOKEN = opts.token
  let httpServer: Server
  let broadcaster: EventBroadcaster
  let sse: SseHandler
  let backend: SessionStore
  try {
    const log = await EventLogStore.open(dir)
    broadcaster = new EventBroadcaster(log)
    sse = new SseHandler(log, broadcaster)
    const registry = new TaskRegistry()
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
    backend = new SessionStore()
    const app = await createAppServer({
      log,
      registry,
      queue,
      sse,
      backend,
      ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
    })
    httpServer = app.server
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  } finally {
    if (previousToken === undefined) delete process.env.ATLASLINK_API_TOKEN
    else process.env.ATLASLINK_API_TOKEN = previousToken
  }
  const port = (httpServer!.address() as AddressInfo).port
  return {
    port,
    broadcaster,
    sse,
    backend,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer!.closeAllConnections?.()
        httpServer!.close(() => resolve())
      }),
  }
}

/** Compact JSON request helper for the task-rest E2E surface. */
export function jsonRequest(
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
export function collectStream(url: string, headers: Record<string, string>, collectMs: number): Promise<string> {
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

/** Remove the temp data dir, best-effort after the server closed. */
export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}