import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import { loadDaemonConfig } from './config'
import type { DaemonConfig } from './config'
import { validateConfig, MissingApiKeyError } from './daemon/contextFactory'
import { TaskRegistry, msg } from './tasks/taskRegistry'
import { log as logger } from './log'
import { runSession } from './daemon/runTask'
import { EventLogStore } from './bridge/EventLogStore'
import { EventBroadcaster } from './bridge/EventBroadcaster'
import { SessionQueue } from './bridge/SessionQueue'
import { SseHandler } from './bridge/sseEndpoint'
import { createSessionBackend } from './session/backendFactory'
import { SessionStore } from './session/sessionStore'
import type { SessionBackend } from './session/sessionBackend'
import type { SessionDelta, AskHumanQuestion } from './session/types'
import type { BridgeEnvelope } from './bridge/EventLogStore'
import { VersionConflictError } from './session/types'
import { registerTaskRoutes } from './api/tasks'
import { registerProjectRoutes } from './api/projects'
import { registerTokenGate } from './api/auth'
import rateLimit from '@fastify/rate-limit'
import cors from '@fastify/cors'
import type { LLMConfig } from 'agenthood/dist/llm/types.js'
import type { RunEvent } from 'agenthood/dist/core/RunEventBus.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/**
 * The runner hands us `unknown` (custom AppLike fakes, future runners) — a
 * malformed question mirrors without it rather than crashing the seam or
 * storing an unusable payload the projection would choke on.
 */
export function asAskHumanQuestion(value: unknown): AskHumanQuestion | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const questions = (value as { questions?: unknown }).questions
  if (!Array.isArray(questions) || questions.length === 0) return undefined
  if (questions.some((q) => typeof (q as { label?: unknown })?.label !== 'string')) return undefined
  return value as AskHumanQuestion
}

function parseArgs(argv: string[]): { runMode: boolean; member?: string; task?: string } {
  let runMode = false
  let member: string | undefined
  let task: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') {
      runMode = true
      member = argv[i + 1]
      task = argv.slice(i + 2).join(' ').trim()
      break
    }
  }
  return { runMode, member, task }
}

function friendlyKeyError(err: unknown): string {
  return err instanceof MissingApiKeyError
    ? `\n${err.message}\nRun \`cp .env.example .env\` and set the key, or add GROQ_API_KEY/use Ollama.\n`
    : err instanceof Error ? err.message : String(err)
}

async function runOnce({ config, member, task }: { config: LLMConfig; member: string; task: string }): Promise<boolean> {
  const registry = new TaskRegistry()
  const session = registry.create({ member, prompt: task })
  logger.info('session created', { correlationId: session.correlationId, member: session.task.member })
  const finished = await runSession({
    registry,
    session,
    config,
    onEvent: (event: RunEvent) => {
      logger.info('run event', {
        correlationId: session.correlationId,
        type: event.type,
        ...('step' in event ? { step: (event as { step: number }).step } : {}),
        ...('name' in event ? { name: (event as { name: string }).name } : {}),
      })
    },
  })
  if (finished.status === 'succeeded') {
    console.log(`\n✔ ${finished.task.member} result:\n${finished.output}\n`)
    return true
  }
  console.error(`\n✘ ${finished.task.member} failed: ${finished.error}\n`)
  return false
}

/**
 * Build the daemon HTTP server with its routes wired against the given event
 * log. Does not listen; `listen()` manages the port. The returned broadcaster,
 * queue, and sse handler let run code (POST /runs) and the entrypoint (shutdown)
 * drive the live stream, and let tests inject fakes.
 *
 * The app runs on Fastify (ADR-006 Decision 1) with `logger: false`; the
 * ADR-005 `request` envelope is emitted by an `onResponse` hook through the
 * `src/log.ts` facade so the logged shape stays the shipped contract.
 */
export async function createAppServer(params: {
  log: EventLogStore
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
  backend?: SessionBackend
  bindHost?: string
  version?: string
  rateLimit?: { max: number; timeWindow: string }
  corsOrigins?: string[]
}): Promise<{ server: Server; broadcaster: EventBroadcaster; sse: SseHandler; queue: SessionQueue; app: FastifyInstance }> {
  const { log, registry, queue, sse } = params
  const backend = params.backend ?? new SessionStore()
  const appVersion = params.version ?? version
  const rateLimitOpts = params.rateLimit ?? { max: 100, timeWindow: '1 minute' }
  // Explicit allowlist, never a wildcard: the browser must only ever read this
  // API from the dashboard origin (dev + production). Server-to-server callers
  // carry no Origin header and are unaffected.
  const corsOrigins = params.corsOrigins ?? ['http://localhost:3001', 'https://atlas.flabs.tech']

  // Fastify's serverFactory lets the entrypoint (and tests) own the socket:
  // `server.listen(port)` drives Fastify's router without app.listen().
  let server: Server
  const app = Fastify({
    logger: false,
    ignoreTrailingSlash: true,
    serverFactory: (handler) => {
      server = createServer((req, res) => handler(req, res))
      return server
    },
  })

  // Root-level rate limit registered before any route so its onRoute hook sees
  // every route (gated scope included); /health opts out below.
  await app.register(rateLimit, {
    ...rateLimitOpts,
    errorResponseBuilder: () => ({ statusCode: 429, message: 'rate limit exceeded' }),
  })

  // CORS at the root so preflight short-circuits before the gated scope's auth
  // gate (OPTIONS never needs a bearer token). Allowlist only.
  await app.register(cors, { origin: corsOrigins })

  app.addHook('onResponse', (request, reply, done) => {
    // long-lived SSE streams do not emit a request envelope (same as pre-Fastify)
    const route = request.routeOptions.url
    if (route !== '/events' && route !== '/events/:sessionId') {
      logger.info('request', {
        method: request.method,
        url: request.url,
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      })
    }
    done()
  })

  // --- Safety health ---
  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true, name: 'atlaslink', version: appVersion, uptime: process.uptime() }))

  // --- Account-facing surface (spec §3/§6/§7) ---
  // One security boundary for /runs, /events, and the task-rest routes: the
  // pre-auth bearer gate (fail-closed on non-loopback binds) plus the root rate
  // limit. /health stays on the root app, outside the gate, unthrottled.
  app.register(async (api) => {
    registerTokenGate(api, { bindHost: params.bindHost })

    // --- M4 Project API: project-scoped session workspace ---
    registerProjectRoutes(api, { backend })

    // --- POST /runs (M3 preview, spec §6): delegate a session to the queue ---
    api.post(
      '/runs',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['member', 'prompt'],
            properties: {
              member: { type: 'string' },
              prompt: { type: 'string' },
            },
          },
        },
      },
      async (request, reply) => {
        const { member, prompt } = request.body as { member: string; prompt: string }
        const session = registry.create({ member, prompt })
        queue.declareSession(session)
        logger.info('session delegated', { sessionId: session.id, correlationId: session.correlationId, member })
        return reply.code(202).send({ ok: true, session: { id: session.id, status: session.status } })
      },
    )

    // --- SSE endpoint: GET /events ---
    // Fastify cedes the socket (reply.hijack) and the existing SseHandler owns the
    // stream — the reconnection contract (Last-Event-ID, ping, bridge.gap/shutdown)
    // survives the framework swap untouched (ADR-006 Decision 2).
    api.get('/events', (request, reply) => {
      reply.hijack()
      sse.handle(request.raw, reply.raw)
    })

    // --- M3 Task API (spec §3/§7): token-gated, store-backed, queue-driven ---
    registerTaskRoutes(api, { backend, registry, queue, sse })
  })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ ok: false, error: 'not found' })
  })

  // Route/validation errors keep the { ok: false, error } envelope the pre-Fastify
  // router returned; server internals never leak on 5xx (fail-closed).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500
    const message = status >= 500 ? 'internal error' : error.message
    return reply.code(status).send({ ok: false, error: message })
  })

  // boot the lifecycle so the router, hooks, and 404 handler are live before the
  // caller (or a test) attaches the socket with server.listen()
  await app.ready()

  return { server: server!, broadcaster: sse.broadcaster, sse, queue, app }
}

async function listen(config: DaemonConfig): Promise<{ server: Server; sse: SseHandler; registry: TaskRegistry; queue: SessionQueue }> {
  const registry = new TaskRegistry()
  const backend = await createSessionBackend()

  const log = await EventLogStore.open(config.dataDir, { maxBytes: 10 * 1024 * 1024 })
  const broadcaster = new EventBroadcaster(log)
  const sse = new SseHandler(log, broadcaster)

  const queue = new SessionQueue({
    broadcaster,
     registry,
     runner: async (sessionId) => {
       const session = registry.get(sessionId)!
       // Mirror lifecycle into the store so GET /tasks read the live aggregate.
       // /runs-created sessions live only in the registry — the store stays the
       // /tasks surface, so a missing aggregate is skipped, not invented. A
       // cancelled aggregate is final: never overwrite it with the run outcome.
       const mirror = async (delta: SessionDelta): Promise<void> => {
         const current = await backend.get(sessionId)
         if (!current || current.status === 'cancelled') return
         try {
           await backend.readModifyWrite(sessionId, current.version, () => [delta])
         } catch (err) {
           if (!(err instanceof VersionConflictError)) throw err
           // a cancel landed between read and write — the aggregate moved on,
           // and the store already reflects the terminal decision; mirror drops
         }
       }
       const at = (): string => new Date().toISOString()
       try {
         await mirror({ type: 'session.running', correlationId: session.correlationId, at: at() })
         await runSession({
           registry,
           session,
           config: config.agenthood,
           onEvent: (event: RunEvent) => broadcaster.emit({ eventId: 0, ...event }),
         })
       } catch (err) {
         logger.error('session run threw unexpectedly', {
           sessionId,
           correlationId: session.correlationId,
           error: msg(err),
         })
       }
        const final = registry.get(sessionId)!
        if (final.status === 'succeeded') {
          await mirror({ type: 'session.succeeded', correlationId: final.correlationId, at: at(), output: final.output, durationMs: final.durationMs })
        } else if (final.status === 'failed') {
          await mirror({ type: 'session.failed', correlationId: final.correlationId, at: at(), error: final.error, durationMs: final.durationMs })
        } else if (final.status === 'parked') {
          // the worker returned on AskHumanSignal — slot free, question in hand.
          // Park is the most time-sensitive transition, so it fans out live
          // instead of waiting for a dashboard refetch (store stays truth).
          const question = asAskHumanQuestion(final.question)
          const parkedAt = at()
          await mirror({
            type: 'session.awaiting_input',
            correlationId: final.correlationId,
            at: parkedAt,
            member: final.task.member,
            ...(question !== undefined ? { question } : {}),
          })
          try {
            const envelope: BridgeEnvelope = {
              eventId: 0, // assigned by the broadcaster
              type: 'session.awaiting_input',
              sessionId,
              correlationId: final.correlationId,
              member: final.task.member,
              at: parkedAt,
              ...(question !== undefined ? { question } : {}),
            }
            broadcaster.emit(envelope)
          } catch {
            // best-effort; store is truth
          }
        }
     },
   })

  const { server } = await createAppServer({
    log,
    registry,
    queue,
    sse,
    backend,
    bindHost: config.host,
    corsOrigins: config.corsOrigins,
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, resolve)
  })

  logger.info('daemon online', { host: config.host, port: config.port, version })
  return { server, sse, registry, queue }
}

async function main(): Promise<void> {
  const { runMode, member, task } = parseArgs(process.argv.slice(2))
  const config: DaemonConfig = await loadDaemonConfig()

  try {
    validateConfig(config.agenthood)
  } catch (err) {
    logger.error(friendlyKeyError(err))
    process.exit(1)
  }

  if (runMode) {
    if (!member || !task) {
      console.error('Usage: atlaslink --run <member> "<task>"')
      process.exit(1)
    }
    const ok = await runOnce({ config: config.agenthood, member, task })
    process.exit(ok ? 0 : 1)
  }

  const { server, sse } = await listen(config)

  const shutdown = (signal: string): void => {
    logger.info('shutdown signal', { signal })
    sse.shutdown()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

// Only boot the daemon when executed directly (e.g. `tsx src/server.ts`), never
// when imported by tests.
if (process.argv[1] && new URL(`file://${resolve(process.argv[1])}`).href === import.meta.url) {
  main().catch((err) => {
    logger.error('startup failed', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}