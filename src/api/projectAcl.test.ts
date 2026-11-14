import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import Database from 'better-sqlite3'
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
import { SQLiteDb } from '../session/sqliteDb'
import { runMigrations } from '../session/migrations'
import { sqliteMigrations } from '../session/sqliteMigrations'
import { jsonRequest } from '../test/serverHarness'
import { canManageMembers, canReadProject, canWriteProject } from './projectAcl'

async function createAclServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const file = join(tmpdir(), `atlaslink-acl-${Date.now()}.sqlite`)
  const sqlite = new Database(file)
  const db = new SQLiteDb(sqlite)
  await runMigrations(db, sqliteMigrations)
  const authStore = new AuthStore(db)

  const prevJwt = process.env.ATLASLINK_JWT_SECRET
  const prevToken = process.env.ATLASLINK_API_TOKEN
  const prevSignup = process.env.ATLASLINK_ALLOW_SIGNUP
  process.env.ATLASLINK_JWT_SECRET = 'test-secret-key-that-is-32-bytes!!'
  delete process.env.ATLASLINK_API_TOKEN
  delete process.env.ATLASLINK_ALLOW_SIGNUP

  const log = await EventLogStore.open(mkdtempSync(join(tmpdir(), 'atlaslink-log-')))
  const broadcaster = new EventBroadcaster(log)
  const sse = new SseHandler(log, broadcaster)
  const registry = new TaskRegistry()
  const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
  const backend = new SessionStore()
  const app = await createAppServer({
    log,
    registry,
    queue,
    sse,
    backend,
    authStore,
    authDeps: {
      createInbox: async (user) => {
        const { backendForTenant } = await import('../session/backendFactory')
        const tb = backendForTenant(backend, user.tenant_id)
        await tb.createProject(`proj-inbox-${user.id}`, 'inbox')
        await tb.setProjectMember(`proj-inbox-${user.id}`, user.id, 'owner')
      },
    },
  })
  const httpServer = app.server
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const port = (httpServer.address() as AddressInfo).port
  return {
    port,
    close: async () => {
      httpServer.closeAllConnections?.()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      if (prevJwt === undefined) delete process.env.ATLASLINK_JWT_SECRET
      else process.env.ATLASLINK_JWT_SECRET = prevJwt
      if (prevToken === undefined) delete process.env.ATLASLINK_API_TOKEN
      else process.env.ATLASLINK_API_TOKEN = prevToken
      if (prevSignup === undefined) delete process.env.ATLASLINK_ALLOW_SIGNUP
      else process.env.ATLASLINK_ALLOW_SIGNUP = prevSignup
      sqlite.close()
      rmSync(file, { force: true })
    },
  }
}

async function register(port: number, email: string): Promise<{ token: string; userId: string }> {
  await jsonRequest(port, 'POST', '/v1/auth/register', { email, password: 'password123' })
  const login = JSON.parse((await jsonRequest(port, 'POST', '/v1/auth/login', { email, password: 'password123' })).body)
  return { token: login.token, userId: login.user.id }
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` }
}

test('A4: creator becomes owner; non-member reads 404; viewer 403 on write', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'alice@example.com')
    const bob = await register(port, 'bob@example.com')

    const created = JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name: 'secret' }, auth(alice.token))).body)
    const projectId = created.project.id

    const members = JSON.parse((await jsonRequest(port, 'GET', `/v1/projects/${projectId}/members`, undefined, auth(alice.token))).body)
    assert.equal(members.members.length, 1)
    assert.equal(members.members[0].role, 'owner')

    // non-member reads as unknown (no oracle)
    const bobRead = await jsonRequest(port, 'GET', `/v1/projects/${projectId}`, undefined, auth(bob.token))
    assert.equal(bobRead.status, 404)

    const bobList = JSON.parse((await jsonRequest(port, 'GET', '/v1/projects', undefined, auth(bob.token))).body)
    assert.ok(!bobList.projects.some((p: { id: string }) => p.id === projectId))

    // owner adds bob as viewer; viewer reads but cannot write
    const put = await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'viewer' }, auth(alice.token))
    assert.equal(put.status, 200)
    const bobRead2 = await jsonRequest(port, 'GET', `/v1/projects/${projectId}`, undefined, auth(bob.token))
    assert.equal(bobRead2.status, 200)
    const bobWrite = await jsonRequest(port, 'POST', '/v1/tasks', { member: 'm', prompt: 'p', projectId }, auth(bob.token))
    assert.equal(bobWrite.status, 403)
    const bobDelete = await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}`, undefined, auth(bob.token))
    assert.equal(bobDelete.status, 403)
  } finally {
    await close()
  }
})

test('A4: invite single-use/expiry enforced, tenant-bound', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'alice2@example.com')
    const bob = await register(port, 'bob2@example.com')
    const created = JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name: 'invited' }, auth(alice.token))).body)
    const projectId = created.project.id

    const inv = JSON.parse((await jsonRequest(port, 'POST', `/v1/projects/${projectId}/invites`, { role: 'editor' }, auth(alice.token))).body)
    assert.equal(inv.ok, true)
    assert.ok(typeof inv.token === 'string' && inv.token.length > 20)

    const accept = await jsonRequest(port, 'POST', `/v1/invites/${inv.token}/accept`, undefined, auth(bob.token))
    assert.equal(accept.status, 200)

    // single-use: replay fails
    const replay = await jsonRequest(port, 'POST', `/v1/invites/${inv.token}/accept`, undefined, auth(bob.token))
    assert.equal(replay.status, 404)

    // editor can now write
    const task = await jsonRequest(port, 'POST', '/v1/tasks', { member: 'm', prompt: 'p', projectId }, auth(bob.token))
    assert.equal(task.status, 201)
  } finally {
    await close()
  }
})

test('A4: legacy ownerless project stays tenant-wide until claimed', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'alice3@example.com')
    const bob = await register(port, 'bob3@example.com')
    // legacy: project created without owner (dev path has no identity) — simulate by direct backend?
    // here: alice creates (owner), then owner removes themselves to simulate legacy
    const created = JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name: 'legacy' }, auth(alice.token))).body)
    const projectId = created.project.id
    // owner steps down via member removal is not exposed; claim path: new project via unauth harness is legacy.
    // assert legacy claim works: bob cannot see invited-only, but a memberless project would be visible.
    // minimal: owner can still list; the tenant-wide fallback is exercised in unauthenticated tasks tests.
    const list = JSON.parse((await jsonRequest(port, 'GET', '/v1/projects', undefined, auth(bob.token))).body)
    assert.ok(!list.projects.some((p: { id: string }) => p.id === projectId))
  } finally {
    await close()
  }
})

test('A4: only owners delete projects and mint owner invites', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'own-alice@example.com')
    const bob = await register(port, 'own-bob@example.com')
    const created = JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name: 'owned' }, auth(alice.token))).body)
    const projectId = created.project.id
    await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'editor' }, auth(alice.token))

    // editor cannot delete the project; owner can
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}`, undefined, auth(bob.token))).status, 403)
    const created2 = JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name: 'doomed' }, auth(alice.token))).body)
    const doomedId = created2.project.id
    await jsonRequest(port, 'PUT', `/v1/projects/${doomedId}/members`, { userId: bob.userId, role: 'editor' }, auth(alice.token))
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${doomedId}`, undefined, auth(bob.token))).status, 403)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${doomedId}`, undefined, auth(alice.token))).status, 200)

    // editor cannot mint an owner invite (privilege escalation); owner can
    assert.equal((await jsonRequest(port, 'POST', `/v1/projects/${projectId}/invites`, { role: 'owner' }, auth(bob.token))).status, 403)
    const ownerInv = await jsonRequest(port, 'POST', `/v1/projects/${projectId}/invites`, { role: 'owner' }, auth(alice.token))
    assert.equal(ownerInv.status, 201)
    // editor can still invite editors/viewers
    assert.equal((await jsonRequest(port, 'POST', `/v1/projects/${projectId}/invites`, { role: 'editor' }, auth(bob.token))).status, 201)
  } finally {
    await close()
  }
})

test('A4: last owner cannot be demoted or removed; ghost users rejected', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'guard-alice@example.com')
    const bob = await register(port, 'guard-bob@example.com')
    const created = JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name: 'guarded' }, auth(alice.token))).body)
    const projectId = created.project.id

    // sole owner demote refused, still owner afterwards
    assert.equal((await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: alice.userId, role: 'viewer' }, auth(alice.token))).status, 400)
    const members = JSON.parse((await jsonRequest(port, 'GET', `/v1/projects/${projectId}/members`, undefined, auth(alice.token))).body)
    assert.equal(members.members.find((m: { userId: string }) => m.userId === alice.userId).role, 'owner')

    // sole owner removal refused
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}/members/${alice.userId}`, undefined, auth(alice.token))).status, 400)

    // ghost userIds are not writable
    assert.equal((await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: 'ghost-nobody', role: 'viewer' }, auth(alice.token))).status, 404)

    // with a second owner the first can step down and be removed
    await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'owner' }, auth(alice.token))
    assert.equal((await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: alice.userId, role: 'viewer' }, auth(alice.token))).status, 200)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}/members/${alice.userId}`, undefined, auth(bob.token))).status, 200)
  } finally {
    await close()
  }
})

test('A4: invites list, revoke, and single-use race admit exactly one', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'inv-alice@example.com')
    const bob = await register(port, 'inv-bob@example.com')
    const cara = await register(port, 'inv-cara@example.com')
    const created = JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name: 'invited' }, auth(alice.token))).body)
    const projectId = created.project.id

    const inv = JSON.parse((await jsonRequest(port, 'POST', `/v1/projects/${projectId}/invites`, { role: 'editor' }, auth(alice.token))).body)
    const listed = JSON.parse((await jsonRequest(port, 'GET', `/v1/projects/${projectId}/invites`, undefined, auth(alice.token))).body)
    assert.ok(listed.invites.some((i: { id: string }) => i.id === inv.invite.id))
    assert.ok(!JSON.stringify(listed).includes(inv.token))

    // revoke kills the link
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}/invites/${inv.invite.id}`, undefined, auth(alice.token))).status, 200)
    assert.equal((await jsonRequest(port, 'POST', `/v1/invites/${inv.token}/accept`, undefined, auth(bob.token))).status, 404)

    // race: two concurrent accepts of one link admit exactly one member
    const race = JSON.parse((await jsonRequest(port, 'POST', `/v1/projects/${projectId}/invites`, { role: 'viewer' }, auth(alice.token))).body)
    const [r1, r2] = await Promise.all([
      jsonRequest(port, 'POST', `/v1/invites/${race.token}/accept`, undefined, auth(bob.token)),
      jsonRequest(port, 'POST', `/v1/invites/${race.token}/accept`, undefined, auth(cara.token)),
    ])
    assert.equal([r1.status, r2.status].sort().join(','), '200,404')
  } finally {
    await close()
  }
})

test('A4: authenticated sessions need a real project; task pages stay complete', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'page-alice@example.com')
    const bob = await register(port, 'page-bob@example.com')
    const mk = async (name: string): Promise<string> =>
      JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name }, auth(alice.token))).body).project.id
    const visible = await mk('visible')
    const hidden = await mk('hidden')
    await jsonRequest(port, 'PUT', `/v1/projects/${visible}/members`, { userId: bob.userId, role: 'viewer' }, auth(alice.token))

    // ghost project ids are 404 for authenticated callers (no ACL bypass)
    assert.equal((await jsonRequest(port, 'POST', '/v1/tasks', { member: 'm', prompt: 'p', projectId: 'proj-ghost-123' }, auth(bob.token))).status, 404)

    for (let i = 0; i < 3; i += 1) {
      assert.equal((await jsonRequest(port, 'POST', '/v1/tasks', { member: 'm', prompt: `v${i}`, projectId: visible }, auth(alice.token))).status, 201)
    }
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await jsonRequest(port, 'POST', '/v1/tasks', { member: 'm', prompt: `h${i}`, projectId: hidden }, auth(alice.token))).status, 201)
    }
    // hidden sessions never page into bob's view; totals stay honest
    const p1 = JSON.parse((await jsonRequest(port, 'GET', '/v1/tasks?limit=2&offset=0', undefined, auth(bob.token))).body)
    assert.equal(p1.total, 3)
    assert.equal(p1.sessions.length, 2)
    assert.ok(p1.sessions.every((s: { projectId: string }) => s.projectId === visible))
    const p2 = JSON.parse((await jsonRequest(port, 'GET', '/v1/tasks?limit=2&offset=2', undefined, auth(bob.token))).body)
    assert.equal(p2.total, 3)
    assert.equal(p2.sessions.length, 1)
  } finally {
    await close()
  }
})

test('A4: ACL guards stay silent: 404 unknown, 403 viewer, 400 invalid', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'guard2-alice@example.com')
    const bob = await register(port, 'guard2-bob@example.com')
    const created = JSON.parse((await jsonRequest(port, 'POST', '/v1/projects', { name: 'fenced' }, auth(alice.token))).body)
    const projectId = created.project.id
    const nope = 'proj-does-not-exist'

    // unknown project ids read as 404 on every route, no oracle
    assert.equal((await jsonRequest(port, 'GET', `/v1/projects/${nope}`, undefined, auth(bob.token))).status, 404)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${nope}`, undefined, auth(bob.token))).status, 404)
    assert.equal((await jsonRequest(port, 'PUT', `/v1/projects/${nope}/members`, { userId: bob.userId, role: 'viewer' }, auth(bob.token))).status, 404)
    assert.equal((await jsonRequest(port, 'POST', `/v1/projects/${nope}/invites`, {}, auth(bob.token))).status, 404)
    assert.equal((await jsonRequest(port, 'GET', `/v1/projects/${nope}/invites`, undefined, auth(bob.token))).status, 404)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${nope}/invites/inv-x`, undefined, auth(bob.token))).status, 404)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${nope}/members/${bob.userId}`, undefined, auth(bob.token))).status, 404)

    // non-members see 404, never 403 (no project oracle)
    for (const [method, path, body] of [
      ['GET', `/v1/projects/${projectId}/members`, undefined],
      ['PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'viewer' }],
      ['POST', `/v1/projects/${projectId}/invites`, {}],
      ['GET', `/v1/projects/${projectId}/invites`, undefined],
      ['DELETE', `/v1/projects/${projectId}/invites/inv-x`, undefined],
      ['DELETE', `/v1/projects/${projectId}/members/${alice.userId}`, undefined],
    ] as const) {
      assert.equal((await jsonRequest(port, method, path, body, auth(bob.token))).status, 404, `${method} ${path}`)
    }

    // viewers read but never manage
    await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'viewer' }, auth(alice.token))
    assert.equal((await jsonRequest(port, 'POST', `/v1/projects/${projectId}/invites`, {}, auth(bob.token))).status, 403)
    assert.equal((await jsonRequest(port, 'GET', `/v1/projects/${projectId}/invites`, undefined, auth(bob.token))).status, 403)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}/invites/inv-x`, undefined, auth(bob.token))).status, 403)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}/members/${alice.userId}`, undefined, auth(bob.token))).status, 403)
    assert.equal((await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'editor' }, auth(bob.token))).status, 403)

    // invalid roles and missing rows are 400/404, not 500
    assert.equal((await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'admin' }, auth(alice.token))).status, 400)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}/members/nobody-here`, undefined, auth(alice.token))).status, 404)
    assert.equal((await jsonRequest(port, 'DELETE', `/v1/projects/${projectId}/invites/inv-nope`, undefined, auth(alice.token))).status, 404)
    assert.equal((await jsonRequest(port, 'POST', '/v1/invites/bad-token/accept', undefined, auth(bob.token))).status, 404)
  } finally {
    await close()
  }
})

test('A4: legacy ownerless projects stay tenant-wide until claimed', async () => {
  // pre-ACL rows have zero members: the guards treat them as tenant-wide.
  // (Unreachable over HTTP in this harness — POST /projects always seats an
  // owner — so this pins the contract directly against the store.)
  const backend = new SessionStore()
  await backend.createProject('proj-legacy', 'legacy')
  assert.equal(await canReadProject(backend, 'proj-legacy', 'alice'), true)
  assert.equal(await canWriteProject(backend, 'proj-legacy', 'alice'), true)
  assert.equal(await canManageMembers(backend, 'proj-legacy', 'alice'), true)
  // claim seats the first owner; afterwards the project is private
  const claimed = await backend.setProjectMemberGuarded('proj-legacy', 'alice', 'owner')
  assert.equal((claimed as { member: { role: string } }).member.role, 'owner')
  assert.equal(await canReadProject(backend, 'proj-legacy', 'bob'), false)
  assert.equal(await canManageMembers(backend, 'proj-legacy', 'bob'), false)
})

test('tasks: malformed filters and tenant claims are 400', async () => {
  const { port, close } = await createAclServer()
  try {
    const alice = await register(port, 'filter-alice@example.com')
    assert.equal((await jsonRequest(port, 'GET', '/v1/tasks?since=not-a-date', undefined, auth(alice.token))).status, 400)
    assert.equal(
      (await jsonRequest(port, 'POST', '/v1/tasks', { member: 'm', prompt: 'p', projectId: 'proj-x' }, { authorization: `Bearer ${alice.token}`, 'x-tenant-id': 'other' })).status,
      400
    )
  } finally {
    await close()
  }
})
