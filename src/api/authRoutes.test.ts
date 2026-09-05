import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { PGlite } from '@electric-sql/pglite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLogStore } from '../bridge/EventLogStore'
import { EventBroadcaster } from '../bridge/EventBroadcaster'
import { SessionQueue } from '../bridge/SessionQueue'
import { SseHandler } from '../bridge/sseEndpoint'
import { createAppServer } from '../server'
import { TaskRegistry } from '../tasks/taskRegistry'
import { SessionStore } from '../session/sessionStore'
import { AuthStore } from '../session/authStore'
import { PgliteDb } from '../session/db'
import { runMigrations } from '../session/migrations'
import { jsonRequest } from '../test/serverHarness'

async function createTestServer(): Promise<{
  port: number
  authStore: AuthStore
  close: () => Promise<void>
}> {
  const dir = mkdtempSync(join(tmpdir(), 'atlaslink-authroutes-'))
  const pg = new PGlite(dir)
  const pgDb = new PgliteDb(pg)
  await runMigrations(pgDb)
  const authStore = new AuthStore(pgDb)

  const previousJwtSecret = process.env.ATLASLINK_JWT_SECRET
  const previousToken = process.env.ATLASLINK_API_TOKEN
  process.env.ATLASLINK_JWT_SECRET = 'test-secret-key-that-is-32-bytes!!'
  delete process.env.ATLASLINK_API_TOKEN

  try {
    const log = await EventLogStore.open(mkdtempSync(join(tmpdir(), 'atlaslink-log-')))
    const broadcaster = new EventBroadcaster(log)
    const sse = new SseHandler(log, broadcaster)
    const registry = new TaskRegistry()
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
    const backend = new SessionStore()
    const app = await createAppServer({ log, registry, queue, sse, backend, authStore })
    const httpServer = app.server
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const port = (httpServer.address() as AddressInfo).port

    return {
      port,
      authStore,
      close: () =>
        new Promise<void>((resolve) => {
          httpServer.closeAllConnections?.()
          httpServer.close(() => resolve())
        }),
    }
  } finally {
    if (previousJwtSecret === undefined) delete process.env.ATLASLINK_JWT_SECRET
    else process.env.ATLASLINK_JWT_SECRET = previousJwtSecret
    if (previousToken === undefined) delete process.env.ATLASLINK_API_TOKEN
    else process.env.ATLASLINK_API_TOKEN = previousToken
    rmSync(dir, { recursive: true, force: true })
  }
}

test('POST /auth/register — creates user and returns JWT', async () => {
  const { port, close } = await createTestServer()
  try {
    const res = await jsonRequest(port, 'POST', '/auth/register', {
      email: 'newuser@example.com',
      password: 'password123',
    })
    assert.equal(res.status, 201)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.ok(body.token)
    assert.equal(body.user.email, 'newuser@example.com')
    assert.equal(body.user.tenant_id, 'default')
  } finally {
    await close()
  }
})

test('POST /auth/register — rejects duplicate email', async () => {
  const { port, close } = await createTestServer()
  try {
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'duplicate@example.com',
      password: 'password123',
    })
    const res = await jsonRequest(port, 'POST', '/auth/register', {
      email: 'duplicate@example.com',
      password: 'password123',
    })
    assert.equal(res.status, 409)
    const body = JSON.parse(res.body)
    assert.equal(body.error, 'email already registered')
  } finally {
    await close()
  }
})

test('POST /auth/register — rejects invalid email', async () => {
  const { port, close } = await createTestServer()
  try {
    const res = await jsonRequest(port, 'POST', '/auth/register', {
      email: 'not-an-email',
      password: 'password123',
    })
    assert.equal(res.status, 400)
    const body = JSON.parse(res.body)
    assert.equal(body.error, 'invalid email')
  } finally {
    await close()
  }
})

test('POST /auth/login — returns JWT for valid credentials', async () => {
  const { port, close } = await createTestServer()
  try {
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'login@example.com',
      password: 'password123',
    })
    const res = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'login@example.com',
      password: 'password123',
    })
    assert.equal(res.status, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.ok(body.token)
    assert.equal(body.user.email, 'login@example.com')
  } finally {
    await close()
  }
})

test('POST /auth/login — rejects wrong password', async () => {
  const { port, close } = await createTestServer()
  try {
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'wrongpass@example.com',
      password: 'password123',
    })
    const res = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'wrongpass@example.com',
      password: 'wrongpassword',
    })
    assert.equal(res.status, 401)
    const body = JSON.parse(res.body)
    assert.equal(body.error, 'invalid credentials')
  } finally {
    await close()
  }
})

test('POST /auth/login — rejects unknown email', async () => {
  const { port, close } = await createTestServer()
  try {
    const res = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'unknown@example.com',
      password: 'password123',
    })
    assert.equal(res.status, 401)
    const body = JSON.parse(res.body)
    assert.equal(body.error, 'invalid credentials')
  } finally {
    await close()
  }
})

test('POST /auth/keys — creates API key when authenticated', async () => {
  const { port, close } = await createTestServer()
  try {
    const loginRes = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'keycreator@example.com',
      password: 'password123',
    })
    // First register
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'keycreator@example.com',
      password: 'password123',
    })
    const login = JSON.parse(loginRes.body)

    const res = await jsonRequest(port, 'POST', '/auth/keys', { name: 'my-app-key' }, {
      authorization: `Bearer ${login.token}`,
    })
    assert.equal(res.status, 201)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.ok(body.key.startsWith('ak_'))
    assert.equal(body.name, 'my-app-key')
  } finally {
    await close()
  }
})

test('POST /auth/keys — rejects unauthenticated request', async () => {
  const { port, close } = await createTestServer()
  try {
    const res = await jsonRequest(port, 'POST', '/auth/keys', { name: 'no-auth' })
    assert.equal(res.status, 401)
  } finally {
    await close()
  }
})

test('GET /auth/keys — lists user keys', async () => {
  const { port, close } = await createTestServer()
  try {
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'listkeys@example.com',
      password: 'password123',
    })
    const loginRes = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'listkeys@example.com',
      password: 'password123',
    })
    const login = JSON.parse(loginRes.body)

    await jsonRequest(port, 'POST', '/auth/keys', { name: 'key-1' }, {
      authorization: `Bearer ${login.token}`,
    })
    await jsonRequest(port, 'POST', '/auth/keys', { name: 'key-2' }, {
      authorization: `Bearer ${login.token}`,
    })

    const res = await jsonRequest(port, 'GET', '/auth/keys', undefined, {
      authorization: `Bearer ${login.token}`,
    })
    assert.equal(res.status, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.equal(body.keys.length, 2)
  } finally {
    await close()
  }
})

test('DELETE /auth/keys/:keyId — revokes key', async () => {
  const { port, close } = await createTestServer()
  try {
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'revoke@example.com',
      password: 'password123',
    })
    const loginRes = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'revoke@example.com',
      password: 'password123',
    })
    const login = JSON.parse(loginRes.body)

    const createRes = await jsonRequest(port, 'POST', '/auth/keys', { name: 'to-revoke' }, {
      authorization: `Bearer ${login.token}`,
    })
    const created = JSON.parse(createRes.body)

    const deleteRes = await jsonRequest(port, 'DELETE', `/auth/keys/${created.id}`, undefined, {
      authorization: `Bearer ${login.token}`,
    })
    assert.equal(deleteRes.status, 200)

    const listRes = await jsonRequest(port, 'GET', '/auth/keys', undefined, {
      authorization: `Bearer ${login.token}`,
    })
    const list = JSON.parse(listRes.body)
    assert.equal(list.keys.length, 0)
  } finally {
    await close()
  }
})

test('GET /auth/me — returns current user', async () => {
  const { port, close } = await createTestServer()
  try {
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'me@example.com',
      password: 'password123',
    })
    const loginRes = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'me@example.com',
      password: 'password123',
    })
    const login = JSON.parse(loginRes.body)

    const res = await jsonRequest(port, 'GET', '/auth/me', undefined, {
      authorization: `Bearer ${login.token}`,
    })
    assert.equal(res.status, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.equal(body.user.email, 'me@example.com')
  } finally {
    await close()
  }
})

test('Auth gate — JWT bearer grants access to task routes', async () => {
  const { port, close } = await createTestServer()
  try {
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'authed@example.com',
      password: 'password123',
    })
    const loginRes = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'authed@example.com',
      password: 'password123',
    })
    const login = JSON.parse(loginRes.body)

    const res = await jsonRequest(port, 'GET', '/tasks', undefined, {
      authorization: `Bearer ${login.token}`,
    })
    assert.equal(res.status, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
  } finally {
    await close()
  }
})

test('Auth gate — API key bearer grants access to task routes', async () => {
  const { port, close } = await createTestServer()
  try {
    await jsonRequest(port, 'POST', '/auth/register', {
      email: 'apikey@example.com',
      password: 'password123',
    })
    const loginRes = await jsonRequest(port, 'POST', '/auth/login', {
      email: 'apikey@example.com',
      password: 'password123',
    })
    const login = JSON.parse(loginRes.body)

    const keyRes = await jsonRequest(port, 'POST', '/auth/keys', { name: 'test-key' }, {
      authorization: `Bearer ${login.token}`,
    })
    const key = JSON.parse(keyRes.body)

    const res = await jsonRequest(port, 'GET', '/tasks', undefined, {
      authorization: `Bearer ${key.key}`,
    })
    assert.equal(res.status, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
  } finally {
    await close()
  }
})

test('Auth gate — rejects invalid JWT', async () => {
  const { port, close } = await createTestServer()
  try {
    const res = await jsonRequest(port, 'GET', '/tasks', undefined, {
      authorization: 'Bearer invalid.token.here',
    })
    assert.equal(res.status, 401)
  } finally {
    await close()
  }
})
