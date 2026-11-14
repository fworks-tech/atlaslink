import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backendForTenant } from '../session/backendFactory'
import { recipientsForMessage, threadParticipantIds } from './notify'
import {
  cleanup,
  collectStream,
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

async function setupRoom(port: number): Promise<{
  alice: { token: string; userId: string; tenantId: string }
  bob: { token: string; userId: string; tenantId: string }
  projectId: string
  sessionId: string
  correlationId: string
}> {
  const alice = await register(port, 'alice-n@example.com')
  const bob = await register(port, 'bob-n@example.com')
  const projectId = JSON.parse(
    (await jsonRequest(port, 'POST', '/v1/projects', { name: 'room' }, auth(alice.token))).body
  ).project.id
  await jsonRequest(port, 'PUT', `/v1/projects/${projectId}/members`, { userId: bob.userId, role: 'editor' }, auth(alice.token))
  const created = JSON.parse(
    (await jsonRequest(port, 'POST', '/v1/tasks', { member: 'm', prompt: 'p', projectId }, auth(alice.token))).body
  )
  return { alice, bob, projectId, sessionId: created.session.sessionId, correlationId: created.session.correlationId }
}

test('Phase B: mention round-trips via POST, lists with counts, reads, raw-stored XSS', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const { alice, bob, sessionId } = await setupRoom(srv.port)

    // unauthenticated bells are 401 — bells belong to a user
    assert.equal((await jsonRequest(srv.port, 'GET', '/v1/notifications')).status, 401)

    const xss = '<img src=x onerror=alert(1)> hey'
    const posted = await jsonRequest(
      srv.port,
      'POST',
      `/v1/tasks/${sessionId}/message`,
      { content: xss, mentions: [bob.userId] },
      auth(alice.token)
    )
    assert.equal(posted.status, 201)

    const list = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/notifications', undefined, auth(bob.token))).body)
    assert.equal(list.ok, true)
    assert.equal(list.total, 1)
    assert.equal(list.notifications[0].kind, 'mention')
    assert.equal(list.notifications[0].sessionId, sessionId)
    // stored raw — the dashboard escapes at render, never here
    assert.ok((list.notifications[0].excerpt as string).includes('<img src=x onerror=alert(1)>'))
    assert.equal(list.notifications[0].readAt, null)
    assert.equal(list.unreadCount, 1)
    assert.deepEqual(list.unreadBySession, { [sessionId]: 1 })

    // author gets no self-bell
    const aliceList = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/notifications', undefined, auth(alice.token))).body)
    assert.equal(aliceList.total, 0)

    // read it; unread-only filter empties; counts drop
    const notifId = list.notifications[0].id as string
    assert.equal((await jsonRequest(srv.port, 'PUT', `/v1/notifications/${notifId}/read`, undefined, auth(bob.token))).status, 200)
    const after = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/notifications?unreadOnly=true', undefined, auth(bob.token))).body)
    assert.equal(after.total, 0)
    assert.equal(after.unreadCount, 0)

    // cross-user read is 404, no oracle
    assert.equal((await jsonRequest(srv.port, 'PUT', `/v1/notifications/${notifId}/read`, undefined, auth(alice.token))).status, 404)
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})

test('Phase B: thread reply notifies prior authors; unknown mentions are dropped', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const { alice, bob, sessionId } = await setupRoom(srv.port)

    await jsonRequest(srv.port, 'POST', `/v1/tasks/${sessionId}/message`, { content: 'kickoff' }, auth(alice.token))
    const reply = await jsonRequest(
      srv.port,
      'POST',
      `/v1/tasks/${sessionId}/message`,
      { content: 'ack', parentId: 'm-0', mentions: ['ghost@example.com'] },
      auth(bob.token)
    )
    assert.equal(reply.status, 201)

    const aliceList = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/notifications', undefined, auth(alice.token))).body)
    assert.equal(aliceList.total, 1)
    assert.equal(aliceList.notifications[0].kind, 'reply')

    // unknown mention resolved to nobody — bob gets no bell for his own post
    const bobList = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/notifications', undefined, auth(bob.token))).body)
    assert.equal(bobList.total, 0)
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})

test('Phase B: agent ask notifies thread participants (approval bell)', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const { alice, bob, sessionId, correlationId } = await setupRoom(srv.port)
    await jsonRequest(srv.port, 'POST', `/v1/tasks/${sessionId}/message`, { content: 'go' }, auth(alice.token))
    await jsonRequest(srv.port, 'POST', `/v1/tasks/${sessionId}/message`, { content: 'noted' }, auth(bob.token))

    // force terminal, then alice asks a follow-up question
    const tb = backendForTenant(srv.backend, alice.tenantId)
    await tb.append({ type: 'session.failed', sessionId, correlationId, at: new Date().toISOString(), error: 'boom' })
    const followup = await jsonRequest(srv.port, 'POST', `/v1/tasks/${sessionId}/followup`, { content: 'retry?' }, auth(alice.token))
    assert.equal(followup.status, 201)

    // bob (prior participant) gets the approval bell; the asker never self-pings
    const bobList = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/notifications', undefined, auth(bob.token))).body)
    assert.ok(bobList.notifications.some((n: { kind: string }) => n.kind === 'approval'))
    const aliceList = JSON.parse((await jsonRequest(srv.port, 'GET', '/v1/notifications', undefined, auth(alice.token))).body)
    assert.ok(!aliceList.notifications.some((n: { kind: string }) => n.kind === 'approval'))
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})

test('Phase B: SSE stream delivers the bell live to the mentioned user only', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const { alice, bob, sessionId } = await setupRoom(srv.port)

    const bobStream = collectStream(
      `http://127.0.0.1:${srv.port}/v1/notifications/stream`,
      { authorization: `Bearer ${bob.token}` },
      2500
    )
    const aliceStream = collectStream(
      `http://127.0.0.1:${srv.port}/v1/notifications/stream`,
      { authorization: `Bearer ${alice.token}` },
      2500
    )
    await new Promise((r) => setTimeout(r, 300))
    await jsonRequest(
      srv.port,
      'POST',
      `/v1/tasks/${sessionId}/message`,
      { content: 'you are it', mentions: [bob.userId] },
      auth(alice.token)
    )
    const [bobData, aliceData] = await Promise.all([bobStream, aliceStream])
    assert.ok(bobData.includes('notification.created'), `bob stream missed the bell: ${bobData.slice(0, 200)}`)
    assert.ok(!aliceData.includes('notification.created'), 'author must not receive their own bell')
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})

test('notify helpers: participant distinctness and mention precedence', () => {
  const session = {
    sessionId: 'ses-1',
    interaction: [
      { role: 'user', at: 't', content: 'a', authorId: 'u-1' },
      { role: 'user', at: 't', content: 'b', authorId: 'u-1' },
      { role: 'atlas', at: 't', content: 'c' },
      { role: 'user', at: 't', content: 'd', authorId: 'u-2' },
    ],
  } as unknown as Parameters<typeof threadParticipantIds>[0]
  assert.deepEqual(threadParticipantIds(session, 'u-2'), ['u-1'])
  assert.deepEqual(threadParticipantIds(session), ['u-1', 'u-2'])
})

test('notify helpers: recipientsForMessage resolves mentions, skips self, adds repliers', async () => {
  const { SessionStore } = await import('../session/sessionStore')
  const backend = new SessionStore()
  const session = {
    sessionId: 'ses-1',
    tenantId: 'default',
    interaction: [{ role: 'user', at: 't', content: 'a', authorId: 'u-1' }],
  } as unknown as Parameters<typeof recipientsForMessage>[1]
  const directory = { resolveUserId: async (tenant: string, m: string) => (m === 'bob' && tenant === 'default' ? 'u-2' : null) }
  const recipients = await recipientsForMessage(backend, session, {
    authorId: 'u-1',
    mentions: ['bob', 'u-1', 'ghost'],
    parentId: 'm-0',
    directory,
  })
  // bob mentioned; self-mention dropped; ghost unknown; parentId adds u-1's... excluded (author) → only bob
  assert.deepEqual([...recipients.entries()], [['u-2', 'mention']])
})

test('Phase B: malformed parentIds are rejected at commit, valid ones nest', async () => {
  const dir = tmpDataDir()
  const { authStore, close: closeAuth } = await createAuthStore()
  const srv = await startServer(dir, { authStore, jwtSecret: JWT_SECRET })
  try {
    const { alice, sessionId } = await setupRoom(srv.port)
    await jsonRequest(srv.port, 'POST', `/v1/tasks/${sessionId}/message`, { content: 'root' }, auth(alice.token))
    // turns: m-0 is the session prompt, m-1 is 'root'. Out-of-range,
    // non-numeric, and cross-session-shaped ids fail.
    for (const parentId of ['m-x', '../../x']) {
      const bad = await jsonRequest(srv.port, 'POST', `/v1/tasks/${sessionId}/message`, { content: 'dangling', parentId }, auth(alice.token))
      assert.equal(bad.status, 400, parentId)
    }
    for (const parentId of ['m-9', 'm-2']) {
      const dangling = await jsonRequest(srv.port, 'POST', `/v1/tasks/${sessionId}/message`, { content: 'dangling', parentId }, auth(alice.token))
      assert.equal(dangling.status, 409, parentId)
    }
    // m-1 addresses 'root'
    const good = await jsonRequest(srv.port, 'POST', `/v1/tasks/${sessionId}/message`, { content: 'nested', parentId: 'm-1' }, auth(alice.token))
    assert.equal(good.status, 201)
  } finally {
    await srv.close()
    closeAuth()
    cleanup(dir)
  }
})

test('notify helpers: bulk directory resolves a message with one fetch', async () => {
  const { SessionStore } = await import('../session/sessionStore')
  const backend = new SessionStore()
  const session = {
    sessionId: 'ses-1',
    tenantId: 'default',
    interaction: [],
  } as unknown as Parameters<typeof recipientsForMessage>[1]
  let fetches = 0
  const users = [{ id: 'u-2', email: 'bob@example.com' }]
  const directory = {
    resolveUserId: async (_t: string, m: string) => {
      fetches += 1
      return users.find((u) => u.id === m || u.email === m)?.id ?? null
    },
    resolveUserIds: async (_t: string, mentions: string[]) => {
      fetches += 1
      return mentions.map((m) => users.find((u) => u.id === m || u.email === m)?.id ?? null)
    },
  }
  const recipients = await recipientsForMessage(backend, session, {
    authorId: 'u-1',
    mentions: ['bob@example.com', 'u-2', 'ghost'],
    directory,
  })
  assert.deepEqual([...recipients.keys()], ['u-2'])
  assert.equal(fetches, 1)
})
