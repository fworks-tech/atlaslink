import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig as loadAgenthoodConfig } from 'agenthood/dist/commands/config.js'
import type { LLMConfig } from 'agenthood/dist/llm/types.js'

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 3000

export interface DaemonConfig {
  host: string
  port: number
  dataDir: string
  agenthood: LLMConfig
}

/**
 * Loads the project .env with project-first semantics. Node's own
 * `--env-file` does NOT override variables already exported by the parent
 * shell, which lets a stale OPENCODE_API_KEY silently shadow the repo's .env
 * (every provider call then fails auth). This loader unconditionally applies
 * non-empty values from the project .env so the file is the source of truth
 * for local runs. Empty values are skipped so explicitly-provided vars keep
 * working in CI-like environments.
 */
export function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!key || !value) continue
    process.env[key] = value
  }
}

loadEnvFile(resolve(process.cwd(), '.env'))

/**
 * Loads both the atlaslink daemon settings (env-driven) and the agenthood
 * LLM config (.agenthood/config.json). The daemon must run from the project
 * root: many agenthood paths (metrics, skill discovery, config) resolve
 * against process.cwd().
 */
export async function loadDaemonConfig(): Promise<DaemonConfig> {
  const host = process.env.ATLASLINK_HOST ?? DEFAULT_HOST
  const port = Number(process.env.ATLASLINK_PORT ?? DEFAULT_PORT)
  const dataDir = resolve(process.cwd(), 'data')

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid ATLASLINK_PORT "${process.env.ATLASLINK_PORT}"`)
  }

  const agenthood = await loadAgenthoodConfig()
  return { host, port, dataDir, agenthood }
}