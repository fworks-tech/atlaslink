import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, jsonRequest, startServer, tmpDataDir } from '../../test/serverHarness'

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
  const res = await jsonRequest(port, 'POST', '/v1/graphql/session', { query, variables }, headers)
  assert.equal(res.status, 200, `graph endpoint must answer 200: ${res.body}`)
  return JSON.parse(res.body) as GraphResult
}

async function createSession(
  port: number,
  member: string,
  prompt: string,
  projectId?: string,
  headers?: Record<string, string>
): Promise<string> {
  const result = await gql(
    port,
    `mutation Create($member: String!, $prompt: String!, $projectId: ID) {
      createSession(member: $member, prompt: $prompt, projectId: $projectId) { id status }
    }`,
    { member, prompt, projectId },
    headers
  )
  assert.equal(result.errors, undefined, JSON.stringify(result.errors))
  const created = result.data!.createSession as { id: string; status: string }
  assert.equal(created.status, 'queued')
  return created.id
}

test('createSession round-trips through the graph and lists by project', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const id = await createSession(srv.port, 'the-builder', 'ship the graph', 'proj-1')

    const read = await gql(srv.port, `query { session(id: "${id}") { id member prompt status replyCount } }`)
    assert.deepEqual(read.data!.session, { id, member: 'the-builder', prompt: 'ship the graph', status: 'queued', replyCount: 0 })

    const listed = await gql(srv.port, 'query { sessions(projectId: "proj-1") { total sessions { id } } }')
    assert.equal((listed.data!.sessions as { total: number }).total, 1)

    const other = await gql(srv.port, 'query { sessions(projectId: "proj-nope") { total } }')
    assert.equal((other.data!.sessions as { total: number }).total, 0)

    const missing = await gql(srv.port, 'query { session(id: "ses-none") { id } }')
    assert.equal(missing.data!.session, null)
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('appendMessage appends an interaction turn; blank content is rejected', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const id = await createSession(srv.port, 'the-builder', 'mission')

    const sent = await gql(srv.port, `mutation { appendMessage(sessionId: "${id}", content: "hello team") { status } }`)
    assert.equal(sent.errors, undefined, JSON.stringify(sent.errors))

    const read = await gql(srv.port, `query { session(id: "${id}") { interaction { role content } } }`)
    const turns = read.data!.session as { interaction: { role: string; content: string }[] }
    assert.equal(turns.interaction.at(-1)?.content, 'hello team')

    const blank = await gql(srv.port, `mutation { appendMessage(sessionId: "${id}", content: "   ") { status } }`)
    assert.equal(blank.errors?.[0].extensions?.code, '400')
    assert.equal(blank.errors?.[0].message, 'content must not be blank')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('cancelSession cancels once, then 409; unknown id is 404', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const id = await createSession(srv.port, 'the-builder', 'to cancel')

    const cancel = await gql(srv.port, `mutation { cancelSession(id: "${id}") { status } }`)
    assert.equal(cancel.errors, undefined, JSON.stringify(cancel.errors))
    assert.equal((cancel.data!.cancelSession as { status: string }).status, 'cancelled')

    const again = await gql(srv.port, `mutation { cancelSession(id: "${id}") { status } }`)
    assert.equal(again.errors?.[0].extensions?.code, '409')
    assert.equal(again.errors?.[0].message, 'session already terminated')

    const unknown = await gql(srv.port, 'mutation { cancelSession(id: "ses-none") { status } }')
    assert.equal(unknown.errors?.[0].extensions?.code, '404')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('sessionEvents returns only this session envelopes, bounded by limit', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const id = await createSession(srv.port, 'the-builder', 'with events')
    srv.broadcaster.emit({ type: 'run.started', sessionId: id, correlationId: 'cor-x', at: '2026-10-02T00:00:00.000Z', member: 'the-builder' })
    srv.broadcaster.emit({ type: 'run.finished', sessionId: id, correlationId: 'cor-x', at: '2026-10-02T00:00:01.000Z' })
    srv.broadcaster.emit({ type: 'run.started', sessionId: 'ses-other', correlationId: 'cor-y', at: '2026-10-02T00:00:02.000Z' })

    const all = await gql(srv.port, `query { sessionEvents(sessionId: "${id}") { eventId type member } }`)
    const events = all.data!.sessionEvents as { type: string; member?: string }[]
    assert.deepEqual(
      events.map((e) => e.type),
      ['session.queued', 'session.started', 'run.started', 'run.finished']
    )
    assert.equal(events[2].member, 'the-builder')

    const bounded = await gql(srv.port, `query { sessionEvents(sessionId: "${id}", limit: 1) { type } }`)
    assert.deepEqual(bounded.data!.sessionEvents, [{ type: 'run.finished' }])

    const none = await gql(srv.port, `query { sessionEvents(sessionId: "${id}", limit: 0) { type } }`)
    assert.deepEqual(none.data!.sessionEvents, [])
    const negative = await gql(srv.port, `query { sessionEvents(sessionId: "${id}", limit: -3) { type } }`)
    assert.deepEqual(negative.data!.sessionEvents, [])

    const unknown = await gql(srv.port, 'query { sessionEvents(sessionId: "ses-none") { type } }')
    assert.equal(unknown.errors?.[0].extensions?.code, '404')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('the endpoint 400s a missing or non-string query', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const res = await jsonRequest(srv.port, 'POST', '/v1/graphql/session', {})
    assert.equal(res.status, 400)
    assert.match(res.body, /query must be a non-empty string/)
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('tenant isolation on the graph: scoped reads, no existence oracle, invalid tenant is 400', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const owner = { 'x-tenant-id': 'tenant-a' }
    const intruder = { 'x-tenant-id': 'tenant-b' }
    const id = await createSession(srv.port, 'the-builder', 'tenant scoped', undefined, owner)

    const found = await gql(srv.port, `query { session(id: "${id}") { id } }`, undefined, owner)
    assert.equal((found.data!.session as { id: string } | null)?.id, id)

    const hidden = await gql(srv.port, `query { session(id: "${id}") { id } }`, undefined, intruder)
    assert.equal(hidden.data!.session, null)

    const listed = await gql(srv.port, 'query { sessions { total } }', undefined, intruder)
    assert.equal((listed.data!.sessions as { total: number }).total, 0)

    const events = await gql(srv.port, `query { sessionEvents(sessionId: "${id}") { type } }`, undefined, intruder)
    assert.equal(events.errors?.[0].extensions?.code, '404')

    const room = await gql(srv.port, `query { roomMembers(sessionId: "${id}") { id } }`, undefined, intruder)
    assert.equal(room.errors?.[0].extensions?.code, '404')

    const cancel = await gql(srv.port, `mutation { cancelSession(id: "${id}") { status } }`, undefined, intruder)
    assert.equal(cancel.errors?.[0].extensions?.code, '404')

    const invalid = await gql(srv.port, `query { session(id: "${id}") { id } }`, undefined, { 'x-tenant-id': '!!!' })
    assert.equal(invalid.errors?.[0].extensions?.code, '400')
    assert.equal(invalid.errors?.[0].message, 'invalid tenant id')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('roomMembers is an empty roster for a live session and 404 otherwise', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir)
  try {
    const id = await createSession(srv.port, 'the-builder', 'room')
    const empty = await gql(srv.port, `query { roomMembers(sessionId: "${id}") { id name } }`)
    assert.deepEqual(empty.data!.roomMembers, [])

    const unknown = await gql(srv.port, 'query { roomMembers(sessionId: "ses-none") { id } }')
    assert.equal(unknown.errors?.[0].extensions?.code, '404')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})
