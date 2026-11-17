import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanup,
  createAuthStore,
  jsonRequest,
  startServer,
  tmpDataDir,
} from '../test/serverHarness'

const JWT_SECRET = 'test-secret-key-that-is-32-bytes!!'

async function register(port: number, email: string): Promise<{ token: string; userId: string }> {
  await jsonRequest(port, 'POST', '/v1/auth/register', { email, password: 'password123' })
  const login = JSON.parse((await jsonRequest(port, 'POST', '/v1/auth/login', { email, password: 'password123' })).body)
  return { token: login.token, userId: login.user.id }
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` }
}

test('Phase C: custom agent CRUD with validation', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const alice = await register(srv.port, 'alice-a@example.com')

    // list carries the canonical built-ins for pickers plus tenant customs
    const empty = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/agents', undefined, auth(alice.token))).body)
    assert.equal(empty.ok, true)
    assert.ok(Array.isArray(empty.builtIn) && empty.builtIn.includes('builder'))
    assert.ok(!empty.builtIn.includes('the-builder'))
    assert.deepEqual(empty.agents, [])

    // validation: bad name, unknown base, builtin shadowing
    assert.equal((await jsonRequest(srv.port, 'POST', '/v1/agents', { name: 'Bad Name!', persona: 'p', baseMember: 'the-builder' }, auth(alice.token))).status, 400)
    assert.equal((await jsonRequest(srv.port, 'POST', '/v1/agents', { name: 'ghost', persona: 'p', baseMember: 'the-nope' }, auth(alice.token))).status, 400)
    assert.equal((await jsonRequest(srv.port, 'POST', '/v1/agents', { name: 'the-builder', persona: 'p', baseMember: 'the-builder' }, auth(alice.token))).status, 409)

    const created = JSON.parse(
      (await jsonRequest(srv.port, 'POST', '/v1/agents', { name: 'diff-reviewer', persona: 'you review diffs', baseMember: 'the-reviewer', provider: 'groq', model: 'm1' }, auth(alice.token))).body
    )
    assert.equal(created.agent.name, 'diff-reviewer')
    assert.equal(created.agent.baseMember, 'the-reviewer')

    // duplicate 409
    assert.equal((await jsonRequest(srv.port, 'POST', '/v1/agents', { name: 'diff-reviewer', persona: 'x', baseMember: 'the-builder' }, auth(alice.token))).status, 409)

    // read/update/delete round-trip
    const one = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/agents/diff-reviewer', undefined, auth(alice.token))).body)
    assert.equal(one.agent.persona, 'you review diffs')
    assert.equal((await jsonRequest(srv.port, 'GET', '/v1/agents/nope', undefined, auth(alice.token))).status, 404)

    const updated = JSON.parse((await jsonRequest(srv.port, 'PUT', '/v1/agents/diff-reviewer', { persona: 'you review carefully' }, auth(alice.token))).body)
    assert.equal(updated.agent.persona, 'you review carefully')
    assert.equal((await jsonRequest(srv.port, 'PUT', '/v1/agents/diff-reviewer', { baseMember: 'the-nope' }, auth(alice.token))).status, 400)

    assert.equal((await jsonRequest(srv.port, 'DELETE', '/v1/agents/diff-reviewer', undefined, auth(alice.token))).status, 200)
    assert.equal((await jsonRequest(srv.port, 'DELETE', '/v1/agents/diff-reviewer', undefined, auth(alice.token))).status, 404)
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})

test('Phase C: sessions validate members, bake persona, inject provider', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const alice = await register(srv.port, 'alice-b@example.com')
    const projectId = JSON.parse(
      (await jsonRequest(srv.port, 'POST', '/v1/projects', { name: 'p' }, auth(alice.token))).body
    ).project.id
    await jsonRequest(srv.port, 'POST', '/v1/agents', { name: 'diff-reviewer', persona: 'you review diffs', baseMember: 'the-reviewer', provider: 'groq', model: 'm1' }, auth(alice.token))

    // unknown member fails fast at creation, not at run time
    const bad = await jsonRequest(srv.port, 'POST', '/v1/tasks', { member: 'the-nope', prompt: 'p', projectId }, auth(alice.token))
    assert.equal(bad.status, 400)

    // custom member: persona baked into the stored prompt, provider/model injected
    const res = await jsonRequest(srv.port, 'POST', '/v1/tasks', { member: 'diff-reviewer', prompt: 'check this', projectId }, auth(alice.token))
    assert.equal(res.status, 201)
    const session = JSON.parse(res.body).session
    assert.ok(session.task.prompt.includes('<agent_persona name="diff-reviewer">'))
    assert.ok(session.task.prompt.includes('you review diffs'))
    assert.ok(session.task.prompt.endsWith('check this'))

    // built-ins still pass through untouched
    const plain = await jsonRequest(srv.port, 'POST', '/v1/tasks', { member: 'the-builder', prompt: 'build it', projectId }, auth(alice.token))
    assert.equal(plain.status, 201)
    assert.equal(JSON.parse(plain.body).session.task.prompt, 'build it')

    // 4.0 canonical name is the new spelling of the same member
    const canonical = await jsonRequest(srv.port, 'POST', '/v1/tasks', { member: 'builder', prompt: 'build it', projectId }, auth(alice.token))
    assert.equal(canonical.status, 201)
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})

test('Phase C: agents are tenant-isolated (404 cross-tenant, no oracle)', async () => {
  const dir = tmpDataDir()
  // no authStore: unauthenticated tenant-header mode, like the room tests
  const srv = await startServer(dir)
  const tenantA = { 'x-tenant-id': 'tenant-a' }
  const tenantB = { 'x-tenant-id': 'tenant-b' }
  try {
    await jsonRequest(srv.port, 'POST', '/v1/agents', { name: 'diff-reviewer', persona: 'you review diffs', baseMember: 'the-reviewer' }, tenantA)

    // tenant-b's catalog is empty — tenant-a's custom is invisible, built-ins shared
    const bobList = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/agents', undefined, tenantB)).body)
    assert.deepEqual(bobList.agents, [])
    assert.ok(bobList.builtIn.includes('builder'))

    // cross-tenant reads/writes 404 (never 403 — no existence oracle)
    assert.equal((await jsonRequest(srv.port, 'GET', '/v1/agents/diff-reviewer', undefined, tenantB)).status, 404)
    assert.equal((await jsonRequest(srv.port, 'DELETE', '/v1/agents/diff-reviewer', undefined, tenantB)).status, 404)
    assert.equal((await jsonRequest(srv.port, 'PUT', '/v1/agents/diff-reviewer', { persona: 'hijacked' }, tenantB)).status, 404)

    // tenant-a's agent untouched by tenant-b's attempts
    const one = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/agents/diff-reviewer', undefined, tenantA)).body)
    assert.equal(one.agent.persona, 'you review diffs')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})
