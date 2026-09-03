import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ApplicationContext } from 'agenthood/dist/runtime/ApplicationContext.js'
import { StubProvider } from 'agenthood/dist/llm/providers/StubProvider.js'
import type { LLMConfig } from 'agenthood/dist/llm/types.js'
import type { RunEvent } from 'agenthood/dist/core/RunEventBus.js'
import { TaskRegistry } from '../tasks/taskRegistry'
import { runSession, type AppLike } from './runTask'
import { foldReplyPrompt, replyToParked } from '../api/sessionActions'
import { SessionStore } from '../session/sessionStore'
import type { SessionQueue } from '../bridge/SessionQueue'
import { DEFAULT_TENANT_ID } from '../session/migrations'

// Approval round-trip through the REAL runner: a stub-scripted provider parks
// the run on ask_human, the reply path spawns the linked follow-up on the
// interactive lane, and the follow-up runs to SUCCEEDED. sessionActions stays
// importable here because it pulls no Fastify server — only types, the store,
// and the fold caps — so the reply half is wired end to end, not just parked.
const STUB_CONFIG: LLMConfig = { providers: [{ name: 'stub' }], model: 'stub' }
const QUESTION = 'Proceed?'
const CONTEXT = 'scope'
const REPLY = 'yes, proceed'

const previousCwd = process.cwd()
const scrubbedKeys = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENCODE_API_KEY'] as const
const savedKeys = new Map<string, string | undefined>()

afterEach(() => {
  StubProvider.resetScript()
  delete process.env.AGENTHOOD_STUB_PROVIDER
  for (const key of scrubbedKeys) {
    const saved = savedKeys.get(key)
    if (saved === undefined) delete process.env[key]
    else process.env[key] = saved
  }
  savedKeys.clear()
  if (process.cwd() !== previousCwd) process.chdir(previousCwd)
})

function scrubProviderKeys(): void {
  for (const key of scrubbedKeys) {
    if (!savedKeys.has(key)) savedKeys.set(key, process.env[key])
    delete process.env[key]
  }
}

async function realApp(tmpDir: string, correlationId: string, track: { active: number }): Promise<AppLike> {
  const app = await ApplicationContext.create(tmpDir, STUB_CONFIG)
  app.ctx.source = 'api'
  app.ctx.correlationId = correlationId
  const subscribe = app.events.subscribe.bind(app.events)
  app.events.subscribe = (fn) => {
    track.active += 1
    const unsubscribe = subscribe(fn)
    return () => {
      track.active -= 1
      unsubscribe()
    }
  }
  return app
}

test('approval round-trips through the stubbed runner: park, reply, linked resume succeeds', async () => {
  // hermetic by construction: stub gate on, real provider keys scrubbed so a
  // fallback can only fail closed — never dial out — and the project dir is a
  // fresh temp dir so metrics/traces never touch the repo
  process.env.AGENTHOOD_STUB_PROVIDER = '1'
  scrubProviderKeys()
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitl-spike-'))
  const track = { active: 0 }
  const createApp = ({ correlationId }: { config: LLMConfig; correlationId: string }): Promise<AppLike> =>
    realApp(tmpDir, correlationId, track)

  try {
    const registry = new TaskRegistry()
    const session = registry.create({ member: 'the-builder', prompt: 'ship the release' })
    const seen: RunEvent[] = []

    StubProvider.enqueueScript([
      { content: '', toolCalls: [{ id: 'call-1', name: 'ask_human', args: { question: QUESTION, context: CONTEXT } }] },
    ])
    const parked = await runSession({ registry, session, config: STUB_CONFIG, createApp, onEvent: (e) => seen.push(e) })

    assert.equal(parked.status, 'parked')
    assert.deepEqual(parked.question, { question: QUESTION, context: CONTEXT })
    assert.equal(parked.error, undefined)
    assert.equal(track.active, 0)
    const awaiting = seen.filter((e) => e.type === 'run.awaiting_input')
    assert.equal(awaiting.length, 1)
    assert.equal(awaiting[0].type, 'run.awaiting_input')
    if (awaiting[0].type !== 'run.awaiting_input') throw new Error('unreachable')
    assert.equal(awaiting[0].question, QUESTION)
    assert.equal(awaiting[0].context, CONTEXT)

    const backend = new SessionStore()
    const at = new Date().toISOString()
    await backend.append({ type: 'session.created', sessionId: session.id, correlationId: session.correlationId, at, member: 'the-builder', prompt: 'ship the release', tenantId: DEFAULT_TENANT_ID })
    await backend.append({ type: 'session.running', sessionId: session.id, correlationId: session.correlationId, at })
    await backend.append({ type: 'session.awaiting_input', sessionId: session.id, correlationId: session.correlationId, at, member: 'the-builder', question: { question: QUESTION, context: CONTEXT } })

    const declares: Array<{ id: string; lane: string | undefined }> = []
    const queue = {
      declareSession: (s: { id: string }, opts?: { lane?: string }) => {
        declares.push({ id: s.id, lane: opts?.lane })
      },
    } as unknown as SessionQueue
    const replied = await replyToParked(
      { backend, registry, queue, broadcaster: { emit: () => {} } },
      session.id,
      DEFAULT_TENANT_ID,
      REPLY,
    )
    assert.equal(replied.code, 201)
    if (replied.code !== 201) throw new Error('unreachable')
    assert.deepEqual(declares, [{ id: replied.followupId, lane: 'interactive' }])

    const followup = registry.get(replied.followupId)
    assert.ok(followup)
    assert.equal(followup.task.member, 'the-builder')
    assert.equal(followup.task.prompt, foldReplyPrompt('ship the release', QUESTION, CONTEXT, REPLY))
    assert.equal(replied.session.status, 'awaiting_input')

    StubProvider.enqueueScript([{ content: 'done' }])
    const finished = await runSession({ registry, session: followup, config: STUB_CONFIG, createApp })
    assert.equal(finished.status, 'succeeded')
    assert.equal(finished.output, 'done')
    assert.equal(track.active, 0)
    assert.equal(registry.get(session.id)!.status, 'parked')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
