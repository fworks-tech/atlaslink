import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import Database from 'better-sqlite3'
import { EventLogStore, type BridgeEnvelope } from '../bridge/EventLogStore'
import { EventBroadcaster } from '../bridge/EventBroadcaster'
import { SessionQueue } from '../bridge/SessionQueue'
import { SseHandler } from '../bridge/sseEndpoint'
import { createAppServer } from '../server'
import { TaskRegistry } from '../tasks/taskRegistry'
import { SessionStore } from '../session/sessionStore'
import { AuthStore } from '../session/authStore'
import { SQLiteDb } from '../session/sqliteDb'
import { runMigrations } from '../session/migrations'
import { sqliteMigrations } from '../session/sqliteMigrations'

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
    tenantId: 'default',
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
  registry: TaskRegistry
  close: () => Promise<void>
}

export interface HarnessOptions {
  /** Bearer token to register on the gated scope (default: none → dev mode). */
  token?: string
  /** Identity-gated mode: auth store plus the secret used to sign test JWTs. */
  authStore?: AuthStore
  jwtSecret?: string
  rateLimit?: { max: number; timeWindow: string }
  /** Session-creation pick list (tests inject their own roster). */
  providers?: { name: string; model: string; models: string[]; configured: boolean }[]
  /** Trace store the insights subgraph folds (tests point it at a temp file). */
  insightsTracesPath?: string
}

export async function startServer(dir: string, opts: HarnessOptions = {}): Promise<ServerHarness> {
  // The token gate reads the env at registration; snapshot/restore so a dev
  // shell exporting ATLASLINK_API_TOKEN never leaks into the unauthenticated
  // tests, and an opted-in test can pass its own token deterministically.
  const previousToken = process.env.ATLASLINK_API_TOKEN
  if (opts.token === undefined) delete process.env.ATLASLINK_API_TOKEN
  else process.env.ATLASLINK_API_TOKEN = opts.token
  const previousJwtSecret = process.env.ATLASLINK_JWT_SECRET
  const restoreJwtSecret = (): void => {
    if (previousJwtSecret === undefined) delete process.env.ATLASLINK_JWT_SECRET
    else process.env.ATLASLINK_JWT_SECRET = previousJwtSecret
  }
  if (opts.jwtSecret === undefined) delete process.env.ATLASLINK_JWT_SECRET
  else process.env.ATLASLINK_JWT_SECRET = opts.jwtSecret
  let started = false
  let httpServer: Server
  let broadcaster: EventBroadcaster
  let sse: SseHandler
  let backend: SessionStore
  let registry: TaskRegistry
  try {
    const log = await EventLogStore.open(dir)
    broadcaster = new EventBroadcaster(log)
    sse = new SseHandler(log, broadcaster)
    registry = new TaskRegistry()
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
    backend = new SessionStore()
    const app = await createAppServer({
      log,
      registry,
      queue,
      sse,
      backend,
      ...(opts.authStore ? { authStore: opts.authStore } : {}),
      ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
      ...(opts.providers ? { providers: opts.providers } : {}),
      ...(opts.insightsTracesPath ? { insightsTracesPath: opts.insightsTracesPath } : {}),
    })
    httpServer = app.server
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    started = true
  } finally {
    if (previousToken === undefined) delete process.env.ATLASLINK_API_TOKEN
    else process.env.ATLASLINK_API_TOKEN = previousToken
    // verifyJwt reads the secret at request time, so it must outlive boot;
    // restore it when the server closes unless boot itself failed
    if (!started) restoreJwtSecret()
  }
  const port = (httpServer!.address() as AddressInfo).port
  return {
    port,
    broadcaster,
    sse,
    backend,
    registry,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer!.closeAllConnections?.()
        httpServer!.close(() => {
          restoreJwtSecret()
          resolve()
        })
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
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
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
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body: data, headers: r.headers }))
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

/** Fresh SQLite-backed AuthStore for identity-gated tests. */
export async function createAuthStore(): Promise<{ authStore: AuthStore; close: () => void }> {
  const file = join(tmpdir(), `atlaslink-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
  const sqlite = new Database(file)
  const db = new SQLiteDb(sqlite)
  await runMigrations(db, sqliteMigrations)
  return {
    authStore: new AuthStore(db),
    close: () => {
      sqlite.close()
      rmSync(file, { force: true })
    },
  }
}