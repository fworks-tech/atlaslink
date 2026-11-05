import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'graphql'
import { cleanup, jsonRequest, startServer, tmpDataDir } from '../test/serverHarness'

interface GraphResult {
  data?: Record<string, unknown> | null
  errors?: { message: string; path?: (string | number)[]; extensions?: { code?: string } }[]
}

const SUBGRAPHS = ['session', 'task', 'insights', 'files'] as const
type SubgraphName = (typeof SUBGRAPHS)[number]

/** Entity keys each subgraph declares — insights and files expose no entities. */
const EXPECTED_ENTITY_KEYS: Record<SubgraphName, RegExp[]> = {
  session: [/type Session @key\(fields: "id"\)/],
  task: [/type Task @key\(fields: "id"\)/, /type Session @key\(fields: "id"\)/],
  insights: [],
  files: [],
}

async function gql(
  port: number,
  name: SubgraphName,
  query: string,
  variables?: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<GraphResult> {
  const res = await jsonRequest(port, 'POST', `/v1/graphql/${name}`, { query, variables }, headers)
  assert.equal(res.status, 200, `graph endpoint must answer 200: ${res.body}`)
  return JSON.parse(res.body) as GraphResult
}

test('every subgraph serves a parseable _service SDL with its entity keys', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    for (const name of SUBGRAPHS) {
      const result = await gql(srv.port, name, 'query { _service { sdl } }')
      assert.equal(result.errors, undefined, `${name}: ${JSON.stringify(result.errors)}`)
      const sdl = (result.data!._service as { sdl?: string } | null)?.sdl
      assert.ok(sdl, `${name} must expose _service.sdl`)
      assert.doesNotThrow(() => parse(sdl), `${name} SDL does not parse`)
      assert.match(sdl, /@link\(url: "https:\/\/specs\.apollo\.dev\/federation\/v2\.3"/)
      assert.match(sdl, /type Query/)
      for (const key of EXPECTED_ENTITY_KEYS[name]) assert.match(sdl, key, `${name} SDL is missing ${key}`)
    }
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('_entities resolves a stored session by key and nulls an unknown one', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const created = await gql(
      srv.port,
      'session',
      'mutation { createSession(member: "the-builder", prompt: "entity hop") { id } }'
    )
    assert.equal(created.errors, undefined, JSON.stringify(created.errors))
    const id = (created.data!.createSession as { id: string }).id

    const query = `query ($r: [_Any!]!) {
      _entities(representations: $r) { ... on Session { id member prompt status replyCount } }
    }`
    const found = await gql(srv.port, 'session', query, { r: [{ __typename: 'Session', id }] })
    assert.equal(found.errors, undefined, JSON.stringify(found.errors))
    assert.deepEqual(found.data!._entities, [
      { id, member: 'the-builder', prompt: 'entity hop', status: 'queued', replyCount: 0 },
    ])

    const missing = await gql(srv.port, 'session', query, { r: [{ __typename: 'Session', id: 'ses-none' }] })
    assert.equal(missing.errors, undefined, 'a missing entity is not an error')
    assert.deepEqual(missing.data!._entities, [null], 'unknown entities resolve to null, not a 500')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('_entities resolves a task by key and echoes the task subgraph Session stub', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const created = await gql(
      srv.port,
      'task',
      'mutation { createTask(member: "the-builder", prompt: "entity hop", projectId: "proj-ent") { id } }'
    )
    assert.equal(created.errors, undefined, JSON.stringify(created.errors))
    const id = (created.data!.createTask as { id: string }).id

    const query = `query ($r: [_Any!]!) {
      _entities(representations: $r) { ... on Task { id status member prompt projectId replyCount } ... on Session { id } }
    }`

    const task = await gql(srv.port, 'task', query, { r: [{ __typename: 'Task', id }] })
    assert.equal(task.errors, undefined, JSON.stringify(task.errors))
    assert.deepEqual(task.data!._entities, [
      { id, status: 'queued', member: 'the-builder', prompt: 'entity hop', projectId: 'proj-ent', replyCount: 0 },
    ])

    // The task subgraph declares Session as a key-only stub with no
    // __resolveReference — federation echoes the representation instead of
    // failing the entity hop.
    const stub = await gql(srv.port, 'task', query, { r: [{ __typename: 'Session', id }] })
    assert.equal(stub.errors, undefined, JSON.stringify(stub.errors))
    assert.deepEqual(stub.data!._entities, [{ id }])

    const missing = await gql(srv.port, 'task', query, { r: [{ __typename: 'Task', id: 'ses-none' }] })
    assert.equal(missing.errors, undefined, 'a missing entity is not an error')
    assert.deepEqual(missing.data!._entities, [null], 'unknown entities resolve to null, not a 500')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('_entities keeps the tenant boundary: an intruder reference resolves to null', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const created = await gql(
      srv.port,
      'session',
      'mutation { createSession(member: "the-builder", prompt: "tenant entity") { id } }',
      undefined,
      { 'x-tenant-id': 'tenant-a' }
    )
    assert.equal(created.errors, undefined, JSON.stringify(created.errors))
    const id = (created.data!.createSession as { id: string }).id

    const result = await gql(
      srv.port,
      'session',
      'query ($r: [_Any!]!) { _entities(representations: $r) { ... on Session { id } } }',
      { r: [{ __typename: 'Session', id }] },
      { 'x-tenant-id': 'tenant-b' }
    )
    assert.deepEqual(result.data!._entities, [null], "tenant b must not read tenant a's entity")
  } finally {
    await srv.close()
    cleanup(dir)
  }
})
