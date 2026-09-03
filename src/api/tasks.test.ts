import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventLogStore } from '../bridge/EventLogStore'
import { EventBroadcaster } from '../bridge/EventBroadcaster'
import { SessionQueue } from '../bridge/SessionQueue'
import { SseHandler } from '../bridge/sseEndpoint'
import { createAppServer } from '../server'
import { TaskRegistry } from '../tasks/taskRegistry'
import { SessionStore } from '../session/sessionStore'
import { tmpDataDir, runEnv, startServer, jsonRequest, collectStream, cleanup } from '../test/serverHarness'

test('POST /tasks creates a queued session in the store and returns 201', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const res = await jsonRequest(srv.port, 'POST', '/tasks', {
      member: 'the-scribe',
      prompt: 'describe the diff',
      tweaks: { provider: 'groq' },
    })
    assert.equal(res.status, 201)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.session.sessionId.startsWith('ses-'))
    assert.ok(parsed.session.correlationId.startsWith('cor-'))
    assert.equal(parsed.session.status, 'queued')
    assert.equal(parsed.session.version, 1)
    assert.deepEqual(parsed.session.tweaks, { provider: 'groq' })
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /tasks rejects a missing prompt with the error envelope', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const res = await jsonRequest(srv.port, 'POST', '/tasks', { member: 'the-scribe' })
    assert.equal(res.status, 400)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, false)
    assert.equal(typeof parsed.error, 'string')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /tasks/{id} returns the current aggregate; unknown ids 404', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body)
    const id = created.session.sessionId
    const res = await jsonRequest(srv.port, 'GET', `/tasks/${id}`)
    assert.equal(res.status, 200)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.session.status, 'queued')
    assert.equal(parsed.session.task.member, 'm')

    const missing = await jsonRequest(srv.port, 'GET', '/tasks/ses-nope')
    assert.equal(missing.status, 404)
    assert.equal(JSON.parse(missing.body).error, 'unknown session')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /tasks lists sessions newest-first with filters and pagination', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    await jsonRequest(srv.port, 'POST', '/tasks', { member: 'a', prompt: 'first' })
    await jsonRequest(srv.port, 'POST', '/tasks', { member: 'b', prompt: 'second' })

    const all = JSON.parse((await jsonRequest(srv.port, 'GET', '/tasks')).body)
    assert.equal(all.total, 2)
    assert.equal(all.sessions.length, 2)
    assert.equal(all.limit, 50)
    assert.equal(all.offset, 0)
    assert.notEqual(all.sessions[0].sessionId, all.sessions[1].sessionId)

    const paged = JSON.parse((await jsonRequest(srv.port, 'GET', '/tasks?limit=1&offset=0&status=queued')).body)
    assert.equal(paged.sessions.length, 1)
    assert.equal(paged.total, 2)

    const bad = await jsonRequest(srv.port, 'GET', '/tasks?limit=999')
    assert.equal(bad.status, 400)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('cancel moves a queued session to cancelled (202); a terminal session conflicts (409)', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const id = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session.sessionId

    const cancelled = await jsonRequest(srv.port, 'POST', `/tasks/${id}/cancel`)
    assert.equal(cancelled.status, 202)
    const cancelledBody = JSON.parse(cancelled.body)
    assert.equal(cancelledBody.status, 'cancelled')
    assert.equal(cancelledBody.session.status, 'cancelled')

    const again = await jsonRequest(srv.port, 'POST', `/tasks/${id}/cancel`)
    assert.equal(again.status, 409)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('cancel of a running session is acknowledged as best-effort', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session
    const id = created.sessionId
    await srv.backend.append({ type: 'session.running', sessionId: id, correlationId: created.correlationId, at: new Date().toISOString() })

    const res = await jsonRequest(srv.port, 'POST', `/tasks/${id}/cancel`)
    assert.equal(res.status, 202)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.status, 'running')
    assert.equal(parsed.session.status, 'running')
    assert.equal(parsed.cancel, 'best-effort')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /events/{id} replays and live-tails only that session\'s events', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session
    const cor = created.correlationId

    srv.broadcaster.emit(runEnv(0, { type: 'run.started', correlationId: cor }))
    srv.broadcaster.emit(runEnv(1, { type: 'run.started', correlationId: 'cor-other' }))

    const body = await collectStream(
      `http://127.0.0.1:${srv.port}/events/${created.sessionId}`,
      { 'Last-Event-ID': '0' },
      900
    )
    assert.ok(body.includes('"correlationId":"' + cor + '"'))
    assert.ok(!body.includes('"correlationId":"cor-other"'))
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('task-rest routes refuse a non-loopback bind without a token (fail-closed)', async () => {
  const previous = process.env.ATLASLINK_API_TOKEN
  delete process.env.ATLASLINK_API_TOKEN
  const dir = tmpDataDir()
  try {
    const log = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(log)
    const sse = new SseHandler(log, broadcaster)
    const registry = new TaskRegistry()
    const queue = new SessionQueue({ broadcaster, registry, runner: async () => {} })
    const backend = new SessionStore()
    await assert.rejects(
      () => createAppServer({ log, registry, queue, sse, backend, bindHost: '0.0.0.0' }),
      /ATLASLINK_API_TOKEN must be set/
    )
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_API_TOKEN
    else process.env.ATLASLINK_API_TOKEN = previous
    cleanup(dir)
  }
})

test('the bearer token gate (spec §7) protects /runs, /events, and the task-rest routes', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir, { token: 'secret' })

    const deniedTasks = await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })
    assert.equal(deniedTasks.status, 401)
    const deniedRuns = await jsonRequest(srv.port, 'POST', '/runs', { member: 'm', prompt: 'p' })
    assert.equal(deniedRuns.status, 401)
    const deniedEvents = await jsonRequest(srv.port, 'GET', '/events')
    assert.equal(deniedEvents.status, 401)

    const wrong = await jsonRequest(srv.port, 'GET', '/tasks', undefined, { authorization: 'Bearer nope' })
    assert.equal(wrong.status, 401)

    const allowed = await jsonRequest(
      srv.port,
      'POST',
      '/tasks',
      { member: 'm', prompt: 'p' },
      { authorization: 'Bearer secret' }
    )
    assert.equal(allowed.status, 201)
    const allowedRuns = await jsonRequest(
      srv.port,
      'POST',
      '/runs',
      { member: 'm', prompt: 'p' },
      { authorization: 'Bearer secret' }
    )
    assert.equal(allowedRuns.status, 202)

    // /health sits on the root app, outside the gated scope — probes stay open
    const health = await jsonRequest(srv.port, 'GET', '/health')
    assert.equal(health.status, 200)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('the gated scope rate-limits the cost-bearing surface (429 after the cap)', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir, { rateLimit: { max: 2, timeWindow: '1 second' } })
    await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })
    await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })
    const limited = await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })
    assert.equal(limited.status, 429)
    assert.equal(JSON.parse(limited.body).error, 'rate limit exceeded')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /tasks with projectId creates a session in that project', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    // Create a project first
    const projRes = await jsonRequest(srv.port, 'POST', '/projects', { name: 'test-project' })
    const project = JSON.parse(projRes.body).project

    const res = await jsonRequest(srv.port, 'POST', '/tasks', {
      member: 'the-scribe',
      prompt: 'describe the diff',
      projectId: project.id,
    })
    assert.equal(res.status, 201)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.session.projectId, project.id)

    // Verify the session appears in the project's task list
    const listRes = await jsonRequest(srv.port, 'GET', `/tasks?projectId=${project.id}`)
    const list = JSON.parse(listRes.body)
    assert.equal(list.total, 1)
    assert.equal(list.sessions[0].projectId, project.id)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /projects creates a project and GET /projects lists it', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const res = await jsonRequest(srv.port, 'POST', '/projects', { name: 'my-project' })
    assert.equal(res.status, 201)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.project.id.startsWith('proj-'))
    assert.equal(parsed.project.name, 'my-project')

    const list = JSON.parse((await jsonRequest(srv.port, 'GET', '/projects')).body)
    assert.equal(list.projects.length, 1)
    assert.equal(list.projects[0].name, 'my-project')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('GET /projects/:id returns a project; unknown ids 404', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/projects', { name: 'p' })).body)
    const res = await jsonRequest(srv.port, 'GET', `/projects/${created.project.id}`)
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.body).project.name, 'p')

    const missing = await jsonRequest(srv.port, 'GET', '/projects/proj-nope')
    assert.equal(missing.status, 404)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('CORS allows only the configured origins and preflight does not need a token', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir, { token: 'secret' })

    // an allowlisted origin gets the CORS header on real (non-preflight) responses
    const ok = await jsonRequest(srv.port, 'GET', '/health', undefined, {
      origin: 'http://localhost:3001',
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:3001')

    // an unknown origin is refused CORS access (no allow header) — but the API
    // itself still answers, so a non-browser caller is never blocked
    const unknown = await jsonRequest(
      srv.port,
      'POST',
      '/tasks',
      { member: 'm', prompt: 'p' },
      { origin: 'https://evil.example', authorization: 'Bearer secret' }
    )
    assert.equal(unknown.status, 201)
    assert.equal(unknown.headers['access-control-allow-origin'], undefined)

    // a credentialed preflight short-circuits before the bearer gate
    const preflight = await jsonRequest(srv.port, 'OPTIONS', '/tasks', undefined, {
      origin: 'http://localhost:3001',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization',
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:3001')

    // the gated surface still enforces the token for real requests without one
    const denied = await jsonRequest(srv.port, 'GET', '/tasks', undefined, {
      origin: 'http://localhost:3001',
    })
    assert.equal(denied.status, 401)

    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('DELETE /projects/:id removes the project and its sessions', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/projects', { name: 'to-delete' })).body)
    const id = created.project.id
    await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p', projectId: id })
    const del = await jsonRequest(srv.port, 'DELETE', `/projects/${id}`)
    assert.equal(del.status, 200)
    assert.equal(JSON.parse(del.body).ok, true)
    const missing = await jsonRequest(srv.port, 'GET', `/projects/${id}`)
    assert.equal(missing.status, 404)
    const list = JSON.parse((await jsonRequest(srv.port, 'GET', '/projects')).body)
    assert.equal(list.projects.some((p: { id: string }) => p.id === id), false)
    const tasks = JSON.parse((await jsonRequest(srv.port, 'GET', `/tasks?projectId=${id}`)).body)
    assert.equal(tasks.total, 0)
    const again = await jsonRequest(srv.port, 'DELETE', `/projects/${id}`)
    assert.equal(again.status, 404)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /tasks/:id/message appends chat without changing status', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const id = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session.sessionId

    const res = await jsonRequest(srv.port, 'POST', `/tasks/${id}/message`, { content: 'hello?' })
    assert.equal(res.status, 201)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.session.status, 'queued')
    assert.equal(parsed.session.version, 2)
    assert.equal(parsed.session.interaction.length, 2)
    assert.equal(parsed.session.interaction.at(-1).role, 'user')
    assert.equal(parsed.session.interaction.at(-1).content, 'hello?')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /tasks/:id/message on a running session keeps it running', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const created = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session
    const id = created.sessionId
    await srv.backend.append({ type: 'session.running', sessionId: id, correlationId: created.correlationId, at: new Date().toISOString() })

    const res = await jsonRequest(srv.port, 'POST', `/tasks/${id}/message`, { content: 'ping' })
    assert.equal(res.status, 201)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.session.status, 'running')
    assert.equal(parsed.session.interaction.at(-1).content, 'ping')

    // the session still lists under its lifecycle status, not under chat noise
    const running = JSON.parse((await jsonRequest(srv.port, 'GET', '/tasks?status=running')).body)
    assert.equal(running.sessions.some((s: { sessionId: string }) => s.sessionId === id), true)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /tasks/:id/message is tenant-isolated', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const id = JSON.parse(
      (await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' }, { 'x-tenant-id': 'tenant-a' })).body
    ).session.sessionId

    const foreign = await jsonRequest(srv.port, 'POST', `/tasks/${id}/message`, { content: 'hi' }, { 'x-tenant-id': 'tenant-b' })
    assert.equal(foreign.status, 404)
    assert.equal(JSON.parse(foreign.body).error, 'unknown session')

    const foreignGet = await jsonRequest(srv.port, 'GET', `/tasks/${id}`, undefined, { 'x-tenant-id': 'tenant-b' })
    assert.equal(foreignGet.status, 404)

    const own = await jsonRequest(srv.port, 'POST', `/tasks/${id}/message`, { content: 'hi' }, { 'x-tenant-id': 'tenant-a' })
    assert.equal(own.status, 201)
    assert.equal(JSON.parse(own.body).session.interaction.at(-1).content, 'hi')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /tasks/:id/message 404s unknown sessions and 409s terminal ones', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const missing = await jsonRequest(srv.port, 'POST', '/tasks/ses-nope/message', { content: 'hi' })
    assert.equal(missing.status, 404)
    assert.equal(JSON.parse(missing.body).error, 'unknown session')

    const id = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session.sessionId
    await jsonRequest(srv.port, 'POST', `/tasks/${id}/cancel`)
    const terminal = await jsonRequest(srv.port, 'POST', `/tasks/${id}/message`, { content: 'late' })
    assert.equal(terminal.status, 409)
    assert.equal(JSON.parse(terminal.body).error, 'session already terminated')
    await srv.close()
  } finally {
    cleanup(dir)
  }
})

test('POST /tasks/:id/message rejects missing or empty content with the error envelope', async () => {
  const dir = tmpDataDir()
  try {
    const srv = await startServer(dir)
    const id = JSON.parse((await jsonRequest(srv.port, 'POST', '/tasks', { member: 'm', prompt: 'p' })).body).session.sessionId

    const missing = await jsonRequest(srv.port, 'POST', `/tasks/${id}/message`, {})
    assert.equal(missing.status, 400)
    assert.equal(JSON.parse(missing.body).ok, false)

    const empty = await jsonRequest(srv.port, 'POST', `/tasks/${id}/message`, { content: '' })
    assert.equal(empty.status, 400)
    await srv.close()
  } finally {
    cleanup(dir)
  }
})