import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { loadDaemonConfig } from './config'
import type { DaemonConfig } from './config'
import { validateConfig, MissingApiKeyError } from './daemon/contextFactory'
import { TaskRegistry } from './tasks/taskRegistry'
import { runSession } from './daemon/runTask'
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

async function listen({ host, port }: { host: string; port: number }): Promise<Server> {
  const registry = new TaskRegistry()

  const server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/health/')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, name: 'atlaslink', version, uptime: process.uptime() }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'not found' }))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

  console.log(`[daemon] atlaslink online at http://${host}:${port} (v${version})`)
  return server
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

  const server = await listen(config)

  const shutdown = (signal: string): void => {
    console.log(`\n[daemon] ${signal} received, shutting down`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error(`[daemon] startup failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
