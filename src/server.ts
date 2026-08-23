import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadDaemonConfig } from './config'
import type { DaemonConfig } from './config'
import { validateConfig, MissingApiKeyError } from './daemon/contextFactory'
import { TaskRegistry } from './tasks/taskRegistry'
import { runSession } from './daemon/runTask'
import { EventLogStore } from './bridge/EventLogStore'
import { EventBroadcaster } from './bridge/EventBroadcaster'
import { SessionQueue } from './bridge/SessionQueue'
import { SseHandler } from './bridge/sseEndpoint'
import type { LLMConfig } from 'agenthood/dist/llm/types.js'
import type { RunEvent } from 'agenthood/dist/core/RunEventBus.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

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
  console.log(`\n[session] ${session.task.member} — ${session.task.prompt}\n`)
  const finished = await runSession({
    registry,
    session,
    config,
    onEvent: (event: RunEvent) => {
      console.log(`[event] ${event.type}${'step' in event ? ` #${event.step}` : ''}${'name' in event ? ` ${event.name}` : ''}`)
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
 */
export function createAppServer(params: {
  log: EventLogStore
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
  version?: string
}): { server: Server; broadcaster: EventBroadcaster; sse: SseHandler; queue: SessionQueue } {
  const { log, registry, queue, sse } = params
  const appVersion = params.version ?? version

  const server = createServer((req, res) => {
    // --- SSE endpoint: GET /events ---
    if (req.method === 'GET' && req.url === '/events') {
      sse.handle(req, res)
      return
    }

    // --- Safety health ---
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/health/')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, name: 'atlaslink', version: appVersion, uptime: process.uptime() }))
      return
    }

    // --- POST /runs (M3 preview, spec §6): delegate a session to the queue ---
    if (req.method === 'POST' && req.url === '/runs') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { member?: unknown; prompt?: unknown }
          if (typeof parsed.member !== 'string' || typeof parsed.prompt !== 'string') {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'member and prompt are required strings' }))
            return
          }
          const session = registry.create({ member: parsed.member, prompt: parsed.prompt })
          queue.declareSession(session)
          res.writeHead(202, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, session: { id: session.id, status: session.status } }))
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
        }
      })
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'not found' }))
  })

  return { server, broadcaster: sse.broadcaster, sse, queue }
}

async function listen(config: DaemonConfig): Promise<{ server: Server; sse: SseHandler; registry: TaskRegistry; queue: SessionQueue }> {
  const registry = new TaskRegistry()

  const log = await EventLogStore.open(config.dataDir, { maxBytes: 10 * 1024 * 1024 })
  const broadcaster = new EventBroadcaster(log)
  const sse = new SseHandler(log, broadcaster)

  const queue = new SessionQueue({
    broadcaster,
    registry,
    runner: async (sessionId) => {
      const session = registry.get(sessionId)!
      try {
        await runSession({
          registry,
          session,
          config: config.agenthood,
          onEvent: (event: RunEvent) => broadcaster.emit({ eventId: 0, ...event }),
        })
      } catch {
        /* runSession already fails the session */
      }
    },
  })

  const { server } = createAppServer({ log, registry, queue, sse })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, resolve)
  })

  console.log(`[daemon] atlaslink online at http://${config.host}:${config.port} (v${version})`)
  return { server, sse, registry, queue }
}

async function main(): Promise<void> {
  const { runMode, member, task } = parseArgs(process.argv.slice(2))
  const config: DaemonConfig = await loadDaemonConfig()

  try {
    validateConfig(config.agenthood)
  } catch (err) {
    console.error(friendlyKeyError(err))
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
    console.log(`\n[daemon] ${signal} received, shutting down`)
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
    console.error(`[daemon] startup failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}