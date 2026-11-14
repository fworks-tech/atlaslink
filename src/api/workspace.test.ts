import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { workspacePathFor, workspaceRootFor } from '../workspace'
import {
  cleanup,
  createAuthStore,
  jsonRequest,
  startServer,
  tmpDataDir,
} from '../test/serverHarness'

const JWT_SECRET = 'test-secret-key-that-is-32-bytes!!'

async function register(port: number, email: string): Promise<{ token: string; userId: string; tenantId: string }> {
  await jsonRequest(port, 'POST', '/v1/auth/register', { email, password: 'password123' })
  const login = JSON.parse((await jsonRequest(port, 'POST', '/v1/auth/login', { email, password: 'password123' })).body)
  return { token: login.token, userId: login.user.id, tenantId: login.user.tenant_id }
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` }
}

test('Phase D: workspace files/read/log/commit round-trip with ACL', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const alice = await register(srv.port, 'alice-w@example.com')
    const bob = await register(srv.port, 'bob-w@example.com')
    const projectId = JSON.parse(
      (await jsonRequest(srv.port, 'POST', '/v1/projects', { name: 'ws' }, auth(alice.token))).body
    ).project.id
    await jsonRequest(srv.port, 'PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'viewer' }, auth(alice.token))

    // non-member oracle check needs a third user
    const carol = await register(srv.port, 'carol-w@example.com')
    assert.equal((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/files`, undefined, auth(carol.token))).status, 404)

    // viewer reads, cannot commit
    const files = JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/files`, undefined, auth(bob.token))).body)
    assert.ok(files.ok && files.files.includes('.gitignore'), `lazy init seeds a repo: ${JSON.stringify(files)}`)
    assert.equal((await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: 'sneaky' }, auth(bob.token))).status, 403)

    // owner writes a file (agent/human edit lands on disk), commits with user trailer
    const repo = workspacePathFor(workspaceRootFor(dir), alice.tenantId, projectId)
    mkdirSync(repo, { recursive: true })
    writeFileSync(`${repo}/notes.md`, '# hello\n', 'utf8')
    const commit = await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: 'add notes' }, auth(alice.token))
    assert.equal(commit.status, 201)
    const sha = JSON.parse(commit.body).sha as string
    assert.match(sha, /^[0-9a-f]{40}$/)

    const read = JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/file?path=notes.md`, undefined, auth(alice.token))).body)
    assert.equal(read.content, '# hello\n')
    assert.equal((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/file?path=nope.md`, undefined, auth(alice.token))).status, 404)

    const log = JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/log?limit=5`, undefined, auth(alice.token))).body)
    assert.equal(log.commits[0].sha, sha)
    assert.equal(log.commits[0].message, 'add notes')
    assert.ok(log.commits.length >= 2, 'baseline init commit is history too')

    const bad = await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/files?commit=not-a-sha!!`, undefined, auth(alice.token))
    assert.equal(bad.status, 400)
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})
