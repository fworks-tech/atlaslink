import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TaskRegistry, type Session } from '../tasks/taskRegistry'
import { runSession, type AppLike } from './runTask'
import type { RunEvent } from 'agenthood/dist/core/RunEventBus.js'
import { AskHumanSignal } from 'agenthood/dist/tools/human/AskHumanSignal.js'

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
  const questions = { questions: [{ label: 'Ship it?', options: ['yes', 'no'] }] }
  const app = fakeApp({ error: new AskHumanSignal(questions) })

  const finished = await runSession({
    registry,
    session,
    config: {},
    createApp: async () => app,
  })

  assert.equal(finished.status, 'parked')
  assert.deepEqual(finished.question, questions)
  // park is not failure: no error, no output — and the runner promise settled
  // (it threw), so no orphan holds the pump slot when this returns
  assert.equal(finished.error, undefined)
  assert.equal(finished.output, undefined)
  assert.equal(app.listenerCount(), 0)
})
