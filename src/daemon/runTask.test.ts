import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TaskRegistry, type Session } from '../tasks/taskRegistry'
import { runSession, type AppLike } from './runTask'
import type { RunEvent } from 'agenthood/dist/core/RunEventBus.js'
import { AskHumanSignal } from 'agenthood/dist/tools/human/AskHumanTool.js'
import { AtlasCheckpointStore } from '../session/checkpointStore'
import { SessionStore } from '../session/sessionStore'
import type { SessionBackend } from '../session/sessionBackend'

type FakeApp = AppLike & { subscribeCount: () => number; listenerCount: () => number }

function fakeApp(
  { events = [], result = { output: 'done', durationMs: 7 }, error }:
    { events?: Array<Record<string, unknown>>; result?: { output: string; durationMs: number }; error?: unknown } = {},
): FakeApp {
  const listeners = new Set<(event: RunEvent) => void>()
  let subscribeCount = 0
  return {
    subscribeCount: () => subscribeCount,
    listenerCount: () => listeners.size,
    events: {
      subscribe(fn: (event: RunEvent) => void) {
        subscribeCount += 1
        listeners.add(fn)
        return () => {
          void listeners.delete(fn)
        }
      },
    },
    runner: {
      async runMemberTask() {
        for (const event of events) {
          for (const fn of [...listeners]) {
            try {
              // @ts-expect-error: Record<string,unknown> -> RunEvent cast is intentional for fake event payloads
              fn(event as RunEvent)
            } catch {
              // mirrors RunEventBus.emit: subscriber errors never break the run
            }
          }
        }
        if (error) throw error
        return result
      },
    },
  }
}

function baseSession(registry: TaskRegistry): Session {
  return registry.create({ member: 'the-architect', prompt: 'plan the M2 bridge' })
}

test('runSession replays bus events then finalizes a succeeded session', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const received: Array<{ type?: string }> = []
  const app = fakeApp({ events: [{ type: 'run.started', member: 'the-architect', task: 'plan' }] })

  const finished = await runSession({
    registry,
    session,
    config: {},
    createApp: async () => app,
    onEvent: (event) => received.push(event),
  })

  assert.deepEqual(received.map((e) => e.type), ['run.started'])
  assert.equal(finished.status, 'succeeded')
  assert.equal(finished.output, 'done')
  assert.equal(finished.durationMs, 7)
  assert.ok(finished.startedAt)
  assert.ok(finished.finishedAt)
})

test('runSession marks a session failed when the member throws', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const app = fakeApp({ error: new Error('unknown member "the-nonexistent"') })

  const finished = await runSession({
    registry,
    session,
    config: {},
    createApp: async () => app,
  })

  assert.equal(finished.status, 'failed')
  assert.equal(finished.error, 'unknown member "the-nonexistent"')
  assert.equal(finished.output, undefined)
})

test('runSession finalizes failed even when the bus subscribers throw', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const app = fakeApp({
    events: [{ type: 'reasoning', step: 1, content: 'x' }],
    result: { output: 'ok', durationMs: 1 },
  })

  const finished = await runSession({
    registry,
    session,
    config: {},
    createApp: async () => app,
    onEvent: () => {
      throw new Error('subscriber exploded')
    },
  })

  assert.equal(finished.status, 'succeeded')
})

test('runSession unsubscribes from the bus after the run finishes', async () => {
  const registry = new TaskRegistry()
  const app = fakeApp({})

  await runSession({
    registry,
    session: baseSession(registry),
    config: {},
    createApp: async () => app,
    onEvent: () => {},
  })
  await runSession({
    registry,
    session: baseSession(registry),
    config: {},
    createApp: async () => app,
    onEvent: () => {},
  })

  assert.equal(app.listenerCount(), 0)
  assert.equal(app.subscribeCount(), 2)
})

test('runSession fails the session when createContext rejects', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)

  const finished = await runSession({
    registry,
    session,
    config: {},
    createApp: async () => { throw new Error('provider key missing') },
  })

  assert.equal(finished.status, 'failed')
  assert.equal(finished.error, 'provider key missing')
  assert.ok(finished.startedAt)
  assert.ok(finished.finishedAt)
})

test('runSession parks the session on AskHumanSignal and releases the slot', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const payload = { question: 'Ship it?', context: 'release vote' }
  const app = fakeApp({ error: new AskHumanSignal(payload) })

  const finished = await runSession({
    registry,
    session,
    config: {},
    createApp: async () => app,
  })

  assert.equal(finished.status, 'parked')
  assert.deepEqual(finished.question, payload)
  // park is not failure: no error, no output — and the runner promise settled
  // (it threw), so no orphan holds the pump slot when this returns
  assert.equal(finished.error, undefined)
  assert.equal(finished.output, undefined)
  assert.equal(app.listenerCount(), 0)
})

test('runSession finalizes CANCELLED the moment a steer aborts the in-flight run', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  let releaseOrphan!: (value: { output: string; durationMs: number }) => void
  const orphan = new Promise<{ output: string; durationMs: number }>((resolve) => {
    releaseOrphan = resolve
  })
  const app = fakeApp({})
  app.runner.runMemberTask = () => orphan

  const run = runSession({ registry, session, config: {}, createApp: async () => app })
  // let the run attach its controller, then steer mid-flight
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(registry.abort(session.id), true)

  const finished = await run
  assert.equal(finished.status, 'cancelled')
  assert.ok(finished.finishedAt)
  assert.equal(app.listenerCount(), 0)

  // the orphaned provider call completes later — its output is discarded and
  // the terminal state stands (no late succeed, no unhandled rejection)
  releaseOrphan({ output: 'too late', durationMs: 1 })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(registry.get(session.id)!.status, 'cancelled')
  assert.equal(registry.get(session.id)!.output, undefined)
})

test('runSession suppresses a late AskHumanSignal from the aborted orphan', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  let rejectOrphan!: (err: unknown) => void
  const orphan = new Promise<{ output: string; durationMs: number }>((_, reject) => {
    rejectOrphan = reject
  })
  const app = fakeApp({})
  app.runner.runMemberTask = () => orphan

  const run = runSession({ registry, session, config: {}, createApp: async () => app })
  await new Promise((r) => setTimeout(r, 10))
  registry.abort(session.id)
  assert.equal((await run).status, 'cancelled')

  // the orphan parks into the void — a late park must not resurrect a
  // cancelled session, and the rejection must not go unhandled
  rejectOrphan(new AskHumanSignal({ question: 'Late?' }))
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(registry.get(session.id)!.status, 'cancelled')
  assert.equal(registry.get(session.id)!.question, undefined)
})

function liveCheckpoint(id: string, step: number): Parameters<AtlasCheckpointStore['save']>[0] {
  return {
    id,
    member: 'the-architect',
    task: 'plan the M2 bridge',
    step,
    messages: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: '',
    activatedSkills: [],
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('runSession persists the live checkpoint row on park', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const backend = new SessionStore()
  const checkpoints = new AtlasCheckpointStore(backend)
  checkpoints.save(liveCheckpoint(session.correlationId, 3))
  const app = fakeApp({ error: new AskHumanSignal({ question: 'Ship it?' }) })

  const finished = await runSession({
    registry,
    session,
    config: {},
    checkpointStore: checkpoints,
    createApp: async () => app,
  })

  assert.equal(finished.status, 'parked')
  const row = await backend.loadCheckpoint(session.correlationId)
  assert.ok(row)
  assert.equal(row.sessionId, session.id)
  assert.ok(row.data.includes('"step":3'))
})

test('runSession still parks when the checkpoint persist fails', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const failing = {
    saveCheckpoint: async () => { throw new Error('db down') },
  } as unknown as SessionBackend
  const checkpoints = new AtlasCheckpointStore(failing)
  checkpoints.save(liveCheckpoint(session.correlationId, 1))
  const app = fakeApp({ error: new AskHumanSignal({ question: 'Ship it?' }) })

  const finished = await runSession({
    registry,
    session,
    config: {},
    checkpointStore: checkpoints,
    createApp: async () => app,
  })

  assert.equal(finished.status, 'parked')
  assert.deepEqual(finished.question, { question: 'Ship it?' })
})

test('runSession forwards the resume link to the runner after hydrating', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const backend = new SessionStore()
  await backend.saveCheckpoint('cor-orig', 'ses-orig', JSON.stringify(liveCheckpoint('cor-orig', 5)))
  const checkpoints = new AtlasCheckpointStore(backend)
  const app = fakeApp({})
  let seen: unknown
  app.runner.runMemberTask = (async (...args: unknown[]) => {
    seen = args[3]
    return { output: 'resumed', durationMs: 1 }
  }) as typeof app.runner.runMemberTask

  const finished = await runSession({
    registry,
    session,
    config: {},
    checkpointStore: checkpoints,
    resume: { checkpointId: 'cor-orig', reply: 'us-east' },
    createApp: async () => app,
  })

  assert.deepEqual(seen, { checkpointId: 'cor-orig', reply: 'us-east' })
  assert.equal(finished.status, 'succeeded')
  assert.equal(finished.output, 'resumed')
  // hydrated into the live mirror for the runner to consume
  assert.equal(checkpoints.load('cor-orig')?.step, 5)
})

test('runSession degrades to a fresh run when the checkpoint row is gone', async () => {  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const checkpoints = new AtlasCheckpointStore(new SessionStore())
  const app = fakeApp({})
  let seen: unknown = 'unset'
  app.runner.runMemberTask = (async (...args: unknown[]) => {
    seen = args[3]
    return { output: 'fresh', durationMs: 1 }
  }) as typeof app.runner.runMemberTask

  const finished = await runSession({
    registry,
    session,
    config: {},
    checkpointStore: checkpoints,
    resume: { checkpointId: 'cor-gone', reply: 'us-east' },
    createApp: async () => app,
  })

  assert.equal(seen, undefined)
  assert.equal(finished.status, 'succeeded')
  assert.equal(finished.output, 'fresh')
})

test('runSession re-park of a resumed run persists under the lineage id', async () => {
  const registry = new TaskRegistry()
  const session = baseSession(registry)
  const backend = new SessionStore()
  await backend.saveCheckpoint('cor-orig', 'ses-orig', JSON.stringify(liveCheckpoint('cor-orig', 5)))
  const checkpoints = new AtlasCheckpointStore(backend)
  const app = fakeApp({ error: new AskHumanSignal({ question: 'And now?' }) })

  const finished = await runSession({
    registry,
    session,
    config: {},
    checkpointStore: checkpoints,
    resume: { checkpointId: 'cor-orig', reply: 'us-east' },
    createApp: async () => app,
  })

  assert.equal(finished.status, 'parked')
  // lineage id, not the follow-up correlationId — the next reply resumes it again
  const row = await backend.loadCheckpoint('cor-orig')
  assert.ok(row)
  assert.equal(row.sessionId, session.id)
  assert.equal(await backend.loadCheckpoint(session.correlationId), null)
})
