import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { cleanup, jsonRequest, startServer, tmpDataDir } from '../../test/serverHarness'
import { workspacePathFor } from '../../workspace'
import { DEFAULT_TENANT_ID } from '../../session/tenant'

interface GraphResult {
  data?: Record<string, unknown>
  errors?: { message: string; extensions?: { code?: string } }[]
}

async function gql(
  port: number,
  query: string,
  variables?: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<GraphResult> {
  const res = await jsonRequest(port, 'POST', '/v1/graphql/files', { query, variables }, headers)
  assert.equal(res.status, 200, `graph endpoint must answer 200: ${res.body}`)
  return JSON.parse(res.body) as GraphResult
}

async function createSession(port: number, projectId: string, headers?: Record<string, string>): Promise<string> {
  const res = await jsonRequest(port, 'POST', '/v1/tasks', { member: 'the-builder', prompt: 'files', projectId }, headers)
  assert.equal(res.status, 201, res.body)
  return (JSON.parse(res.body) as { session: { sessionId: string } }).session.sessionId
}

function repoAt(dir: string, projectId: string, tenantId: string = DEFAULT_TENANT_ID): string {
  return workspacePathFor(join(dir, 'workspaces'), tenantId, projectId)
}

function writeFile(dir: string, projectId: string, relPath: string, content: string, tenantId?: string): void {
  const repo = repoAt(dir, projectId, tenantId)
  const abs = join(repo, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

function gitLog(repo: string): string {
  return execFileSync('git', ['-C', repo, 'log', '--format=%B', '-n', '5'], { encoding: 'utf8' })
}

test('files list, read, and commit round-trip with session attribution', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const projectId = 'proj-1'
    const sessionId = await createSession(srv.port, projectId)

    const fresh = await gql(srv.port, `query { files(projectId: "${projectId}") }`)
    assert.equal(fresh.errors, undefined, JSON.stringify(fresh.errors))
    assert.deepEqual(fresh.data!.files, [], 'a never-used workspace lists empty after lazy init')

    writeFile(dir, projectId, 'docs/spec.md', 'v1')
    const committed = await gql(
      srv.port,
      'mutation ($p: ID!, $m: String!, $s: ID!) { commitFiles(projectId: $p, message: $m, sessionId: $s) }',
      { p: projectId, m: 'add spec', s: sessionId }
    )
    assert.equal(committed.errors, undefined, JSON.stringify(committed.errors))
    const sha = committed.data!.commitFiles as string
    assert.match(sha, /^[0-9a-f]{40}$/)
    assert.match(gitLog(repoAt(dir, projectId)), new RegExp(`session: ${sessionId}`))

    const listed = await gql(srv.port, `query { files(projectId: "${projectId}") }`)
    assert.deepEqual(listed.data!.files, ['docs/spec.md'])

    const read = await gql(srv.port, `query { file(projectId: "${projectId}", path: "docs/spec.md") }`)
    assert.equal(read.data!.file, 'v1')

    const missing = await gql(srv.port, `query { file(projectId: "${projectId}", path: "docs/nope.md") }`)
    assert.equal(missing.data!.file, null)

    const unknownSession = await gql(srv.port, `mutation {
      commitFiles(projectId: "${projectId}", message: "m", sessionId: "ses-none") }`)
    assert.equal(unknownSession.errors?.[0].extensions?.code, '404')

    const blankMessage = await gql(srv.port, `mutation {
      commitFiles(projectId: "${projectId}", message: " ", sessionId: "${sessionId}") }`)
    assert.equal(blankMessage.errors?.[0].extensions?.code, '400')

    const multilineSession = await gql(srv.port, `mutation {
      commitFiles(projectId: "${projectId}", message: "m", sessionId: "a\\nb") }`)
    assert.equal(multilineSession.errors?.[0].extensions?.code, '400')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('unsafe refs, paths, and workspace ids are rejected before git runs', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const escapePath = await gql(srv.port, `query { file(projectId: "proj-1", path: "../../etc/passwd") }`)
    assert.equal(escapePath.errors?.[0].extensions?.code, '400')
    assert.match(escapePath.errors![0].message, /unsafe repo path/)

    const rangeRev = await gql(srv.port, 'query { fileDiff(projectId: "proj-1", from: "HEAD~1", to: "HEAD") }')
    assert.equal(rangeRev.errors?.[0].extensions?.code, '400')
    assert.match(rangeRev.errors![0].message, /unsafe commit ref/)

    const optionRev = await gql(srv.port, 'query { files(projectId: "proj-1", commit: "--all") }')
    assert.equal(optionRev.errors?.[0].extensions?.code, '400')

    const dotDotProject = await gql(srv.port, `query { files(projectId: "..") }`)
    assert.equal(dotDotProject.errors?.[0].extensions?.code, '400')
    assert.match(dotDotProject.errors![0].message, /unsafe workspace project/)

    const badTenant = await gql(srv.port, `query { files(projectId: "proj-1") }`, undefined, { 'x-tenant-id': '!!!' })
    assert.equal(badTenant.errors?.[0].extensions?.code, '400')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('fileDiff shows the change between pinned commits', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const projectId = 'proj-2'
    const sessionId = await createSession(srv.port, projectId)
    writeFile(dir, projectId, 'spec.md', 'v1')
    const first = await gql(
      srv.port,
      'mutation ($p: ID!, $m: String!, $s: ID!) { commitFiles(projectId: $p, message: $m, sessionId: $s) }',
      { p: projectId, m: 'v1', s: sessionId }
    )
    const sha1 = first.data!.commitFiles as string

    writeFile(dir, projectId, 'spec.md', 'v2')
    const second = await gql(
      srv.port,
      'mutation ($p: ID!, $m: String!, $s: ID!) { commitFiles(projectId: $p, message: $m, sessionId: $s) }',
      { p: projectId, m: 'v2', s: sessionId }
    )
    const sha2 = second.data!.commitFiles as string
    assert.notEqual(sha1, sha2)

    const diffed = await gql(
      srv.port,
      'query ($p: ID!, $from: String!, $to: String!) { fileDiff(projectId: $p, from: $from, to: $to) }',
      { p: projectId, from: sha1, to: sha2 }
    )
    assert.match(diffed.data!.fileDiff as string, /\+v2/)
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('concurrent commits serialize on the per-workspace lock', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const projectId = 'proj-3'
    const sessionId = await createSession(srv.port, projectId)
    writeFile(dir, projectId, 'a.txt', 'content')

    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        gql(
          srv.port,
          'mutation ($p: ID!, $m: String!, $s: ID!) { commitFiles(projectId: $p, message: $m, sessionId: $s) }',
          { p: projectId, m: `concurrent ${i}`, s: sessionId }
        )
      )
    )
    for (const attempt of attempts) {
      assert.equal(attempt.errors, undefined, JSON.stringify(attempt.errors))
      assert.match(attempt.data!.commitFiles as string, /^[0-9a-f]{40}$/)
    }
    const shas = new Set(attempts.map((a) => a.data!.commitFiles))
    assert.ok(shas.size >= 1)
    assert.equal(sh(repoAt(dir, projectId), ['rev-list', '--count', 'HEAD']), '2', 'baseline + exactly one content commit')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('tenants get isolated workspaces for the same project id', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const projectId = 'proj-shared'
    const owner = { 'x-tenant-id': 'tenant-a' }
    const sessionId = await createSession(srv.port, projectId, owner)
    writeFile(dir, projectId, 'secret.txt', 'tenant a data', 'tenant-a')

    const committed = await gql(
      srv.port,
      'mutation ($p: ID!, $m: String!, $s: ID!) { commitFiles(projectId: $p, message: $m, sessionId: $s) }',
      { p: projectId, m: 'a', s: sessionId },
      owner
    )
    assert.equal(committed.errors, undefined, JSON.stringify(committed.errors))

    const ownerFiles = await gql(srv.port, `query { files(projectId: "${projectId}") }`, undefined, owner)
    assert.deepEqual(ownerFiles.data!.files, ['secret.txt'])

    const intruder = { 'x-tenant-id': 'tenant-b' }
    const intruderFiles = await gql(srv.port, `query { files(projectId: "${projectId}") }`, undefined, intruder)
    assert.deepEqual(intruderFiles.data!.files, [], 'tenant b resolves its own derived path')

    const intruderRead = await gql(
      srv.port,
      `query { file(projectId: "${projectId}", path: "secret.txt") }`,
      undefined,
      intruder
    )
    assert.equal(intruderRead.data!.file, null)

    const forged = await gql(
      srv.port,
      'mutation ($p: ID!, $m: String!, $s: ID!) { commitFiles(projectId: $p, message: $m, sessionId: $s) }',
      { p: projectId, m: 'forge', s: sessionId },
      intruder
    )
    assert.equal(forged.errors?.[0].extensions?.code, '404', "tenant b cannot attribute a commit to tenant a's session")
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

function sh(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}
