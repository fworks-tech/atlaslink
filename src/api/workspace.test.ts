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

test('Phase D: workspace diff/file/commit error paths and size limits', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const alice = await register(srv.port, 'alice-wd@example.com')
    const carol = await register(srv.port, 'carol-wd@example.com')
    const projectId = JSON.parse(
      (await jsonRequest(srv.port, 'POST', '/v1/projects', { name: 'ws-err' }, auth(alice.token))).body
    ).project.id
    const repo = workspacePathFor(workspaceRootFor(dir), alice.tenantId, projectId)
    mkdirSync(repo, { recursive: true })
    writeFileSync(`${repo}/notes.md`, '# hello\n', 'utf8')
    const first = await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: 'add notes' }, auth(alice.token))
    assert.equal(first.status, 201)
    const sha = JSON.parse(first.body).sha as string

    // tenant header is rejected on authenticated requests (every route)
    for (const path of [
      `/v1/projects/${projectId}/workspace/files`,
      `/v1/projects/${projectId}/workspace/file?path=notes.md`,
      `/v1/projects/${projectId}/workspace/diff`,
      `/v1/projects/${projectId}/workspace/log`,
    ]) {
      assert.equal(
        (await jsonRequest(srv.port, 'GET', path, undefined, { ...auth(alice.token), 'x-tenant-id': 'other' })).status,
        400
      )
    }
    assert.equal(
      (await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: 'x' }, { ...auth(alice.token), 'x-tenant-id': 'other' })).status,
      400
    )

    // non-member sees 404 on every route (project has an owner, so not legacy)
    for (const path of [
      `/v1/projects/${projectId}/workspace/file?path=notes.md`,
      `/v1/projects/${projectId}/workspace/diff`,
      `/v1/projects/${projectId}/workspace/log`,
    ]) {
      assert.equal((await jsonRequest(srv.port, 'GET', path, undefined, auth(carol.token))).status, 404)
    }
    assert.equal((await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: 'x' }, auth(carol.token))).status, 404)

    // file route: missing path, bad commit
    assert.equal((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/file`, undefined, auth(alice.token))).status, 400)
    assert.equal((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/file?path=notes.md&commit=not-a-sha!!`, undefined, auth(alice.token))).status, 400)

    // explicit-commit reads (covers the ?? 'HEAD' fallbacks)
    const filesAt = JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/files?commit=${sha}`, undefined, auth(alice.token))).body)
    assert.ok(filesAt.ok && filesAt.files.includes('notes.md'))
    const readAt = JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/file?path=notes.md&commit=${sha}`, undefined, auth(alice.token))).body)
    assert.equal(readAt.content, '# hello\n')

    // diff route: defaults (whole tree), explicit sha range, bad rev
    const diffDefault = JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/diff`, undefined, auth(alice.token))).body)
    assert.ok(diffDefault.ok && diffDefault.diff.includes('notes.md'))

    // log route: default and invalid limits fall back to 20
    assert.ok(JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/log`, undefined, auth(alice.token))).body).ok)
    assert.ok(JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/log?limit=abc`, undefined, auth(alice.token))).body).ok)

    // commit route: blank message, trailer-injection sessionId, then valid sessionId
    assert.equal((await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: '   ' }, auth(alice.token))).status, 400)
    writeFileSync(`${repo}/notes.md`, '# hello\n# more\n', 'utf8')
    assert.equal((await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: 'bad trailer', sessionId: 'a\nb' }, auth(alice.token))).status, 400)
    const withSession = await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: 'agent edit', sessionId: 's-1' }, auth(alice.token))
    assert.equal(withSession.status, 201)
    const sha2 = JSON.parse(withSession.body).sha as string

    // explicit sha range (covers the ?? fallbacks' other side)
    const diffExplicit = JSON.parse((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/diff?from=${sha}&to=${sha2}`, undefined, auth(alice.token))).body)
    assert.ok(diffExplicit.ok && diffExplicit.diff.includes('# more'))
    assert.equal((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/diff?from=not-a-sha!!`, undefined, auth(alice.token))).status, 400)

    // size limits: ~600 KB text file exceeds inline view caps for both file and diff
    writeFileSync(`${repo}/big.txt`, `${'x'.repeat(100)}\n`.repeat(6000), 'utf8')
    assert.equal((await jsonRequest(srv.port, 'POST', `/v1/projects/${projectId}/workspace/commit`, { message: 'big' }, auth(alice.token))).status, 201)
    assert.equal((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/file?path=big.txt`, undefined, auth(alice.token))).status, 413)
    assert.equal((await jsonRequest(srv.port, 'GET', `/v1/projects/${projectId}/workspace/diff`, undefined, auth(alice.token))).status, 413)
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})
