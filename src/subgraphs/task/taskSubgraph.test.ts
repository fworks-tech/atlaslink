import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, jsonRequest, startServer, tmpDataDir } from '../../test/serverHarness'

const PROVIDERS = [
  { name: 'opencode-go', model: 'muse-spark-1.3-contributor', models: ['muse-spark-1.3-contributor'], configured: true },
  { name: 'groq', model: 'mixtral-8x7b-32768', models: [], configured: false },
]

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
  const res = await jsonRequest(port, 'POST', '/v1/graphql/task', { query, variables }, headers)
  assert.equal(res.status, 200, `graph endpoint must answer 200: ${res.body}`)
  return JSON.parse(res.body) as GraphResult
}

async function createTask(
  port: number,
  member: string,
  prompt: string,
  projectId: string,
  tweaks?: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<string> {
  const result = await gql(
    port,
    `mutation ($member: String!, $prompt: String!, $projectId: ID!, $tweaks: TaskTweaks) {
      createTask(member: $member, prompt: $prompt, projectId: $projectId, tweaks: $tweaks) { id status }
    }`,
    { member, prompt, projectId, tweaks },
    headers
  )
  assert.equal(result.errors, undefined, JSON.stringify(result.errors))
  const created = result.data!.createTask as { id: string; status: string }
  assert.equal(created.status, 'queued')
  return created.id
}

test('createTask round-trips with tweaks and lists under one project', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir, { providers: PROVIDERS })
  try {
    const id = await createTask(srv.port, 'the-builder', 'ship tasks', 'proj-1', { provider: 'groq', member: { model: 'mixtral' } })

    const read = await gql(
      srv.port,
      `query { task(id: "${id}") { id status projectId member prompt tweaks replyCount session { id } } }`
    )
    assert.deepEqual(read.data!.task, {
      id,
      status: 'queued',
      projectId: 'proj-1',
      member: 'the-builder',
      prompt: 'ship tasks',
      tweaks: { provider: 'groq', member: { model: 'mixtral' } },
      replyCount: 0,
      session: { id },
    })

    const listed = await gql(srv.port, 'query { tasks(projectId: "proj-1") { total tasks { id } limit offset } }')
    const page = listed.data!.tasks as { total: number; tasks: { id: string }[]; limit: number; offset: number }
    assert.deepEqual(page, { total: 1, tasks: [{ id }], limit: 50, offset: 0 })

    const byStatus = await gql(srv.port, 'query { tasks(status: queued) { total } }')
    assert.equal((byStatus.data!.tasks as { total: number }).total, 1)
    const wrongStatus = await gql(srv.port, 'query { tasks(status: failed) { total } }')
    assert.equal((wrongStatus.data!.tasks as { total: number }).total, 0)

    const missing = await gql(srv.port, 'query { task(id: "ses-none") { id } }')
    assert.equal(missing.data!.task, null)
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('createTask rejects invalid payloads the way POST /tasks does', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir, { providers: PROVIDERS })
  try {
    const unknown = await gql(srv.port, `mutation {
      createTask(member: "m", prompt: "p", projectId: "proj-1", tweaks: { provider: "stale" }) { id }
    }`)
    assert.equal(unknown.errors?.[0].extensions?.code, '400')
    assert.match(unknown.errors![0].message, /unknown provider, choose from opencode-go, groq/)

    const model = await gql(srv.port, `mutation {
      createTask(member: "m", prompt: "p", projectId: "proj-1", tweaks: { member: { model: "" } }) { id }
    }`)
    assert.equal(model.errors?.[0].extensions?.code, '400')
    assert.equal(model.errors![0].message, 'tweaks.member.model must be a non-empty string up to 200 chars')

    const blankProject = await gql(srv.port, `mutation { createTask(member: "m", prompt: "p", projectId: " ") { id } }`)
    assert.equal(blankProject.errors?.[0].extensions?.code, '400')
    assert.equal(blankProject.errors![0].message, 'projectId must not be blank')

    const longPrompt = await gql(srv.port, `mutation ($p: String!) {
      createTask(member: "m", prompt: $p, projectId: "proj-1") { id }
    }`, { p: 'x'.repeat(10001) })
    assert.equal(longPrompt.errors?.[0].extensions?.code, '400')
    assert.equal(longPrompt.errors![0].message, 'prompt must be at most 10000 characters')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('tasks list guards the filter bounds REST enforces', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir, { providers: PROVIDERS })
  try {
    const badSince = await gql(srv.port, 'query { tasks(since: "yesterday") { total } }')
    assert.equal(badSince.errors?.[0].extensions?.code, '400')
    assert.equal(badSince.errors![0].message, 'since must be an ISO-8601 date-time')

    const lowLimit = await gql(srv.port, 'query { tasks(limit: 0) { total } }')
    assert.equal(lowLimit.errors?.[0].extensions?.code, '400')

    const highLimit = await gql(srv.port, 'query { tasks(limit: 501) { total } }')
    assert.equal(highLimit.errors?.[0].extensions?.code, '400')

    const negativeOffset = await gql(srv.port, 'query { tasks(offset: -1) { total } }')
    assert.equal(negativeOffset.errors?.[0].extensions?.code, '400')

    const badStatus = await gql(srv.port, 'query { tasks(status: bogus) { total } }')
    assert.ok((badStatus.errors ?? []).length > 0, 'invalid status must be rejected')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('saveDiagram echoes without persisting and 404s unknown sessions', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir, { providers: PROVIDERS })
  try {
    const id = await createTask(srv.port, 'the-builder', 'diagram', 'proj-1')
    const diagram = {
      nodes: [{ id: 'n1', type: 'session', position: { x: 10, y: 20 } }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
      mode: 'chain',
    }
    const saved = await gql(srv.port, `mutation ($id: ID!, $d: DiagramInput!) {
      saveDiagram(sessionId: $id, diagram: $d) { persisted diagram { nodes { id type position { x y } } edges { id source target } mode } }
    }`, { id, d: diagram })
    assert.equal(saved.errors, undefined, JSON.stringify(saved.errors))
    assert.deepEqual(saved.data!.saveDiagram, { persisted: false, diagram })

    const unknown = await gql(srv.port, `mutation {
      saveDiagram(sessionId: "ses-none", diagram: { nodes: [], edges: [], mode: chain }) { persisted }
    }`)
    assert.equal(unknown.errors?.[0].extensions?.code, '404')

    const badMode = await gql(srv.port, `mutation {
      saveDiagram(sessionId: "${id}", diagram: { nodes: [], edges: [], mode: spiral }) { persisted }
    }`)
    assert.ok((badMode.errors ?? []).length > 0, 'invalid mode must be rejected')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('tenant isolation: scoped reads and no existence oracle on the task graph', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir, { providers: PROVIDERS })
  try {
    const owner = { 'x-tenant-id': 'tenant-a' }
    const intruder = { 'x-tenant-id': 'tenant-b' }
    const id = await createTask(srv.port, 'the-builder', 'tenant scoped', 'proj-1', undefined, owner)

    const found = await gql(srv.port, `query { task(id: "${id}") { id } }`, undefined, owner)
    assert.equal((found.data!.task as { id: string } | null)?.id, id)

    const hidden = await gql(srv.port, `query { task(id: "${id}") { id } }`, undefined, intruder)
    assert.equal(hidden.data!.task, null)

    const listed = await gql(srv.port, 'query { tasks { total } }', undefined, intruder)
    assert.equal((listed.data!.tasks as { total: number }).total, 0)

    const save = await gql(srv.port, `mutation {
      saveDiagram(sessionId: "${id}", diagram: { nodes: [], edges: [], mode: chain }) { persisted }
    }`, undefined, intruder)
    assert.equal(save.errors?.[0].extensions?.code, '404')

    const invalid = await gql(srv.port, `query { task(id: "${id}") { id } }`, undefined, { 'x-tenant-id': '!!!' })
    assert.equal(invalid.errors?.[0].extensions?.code, '400')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})
