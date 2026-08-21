import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDaemonConfig, loadEnvFile, DEFAULT_HOST, DEFAULT_PORT } from './config'
import { validateConfig } from './daemon/contextFactory'

test('loadDaemonConfig uses documented defaults', async () => {
  const previous = {
    ATLASLINK_HOST: process.env.ATLASLINK_HOST,
    ATLASLINK_PORT: process.env.ATLASLINK_PORT,
  }
  delete process.env.ATLASLINK_HOST
  delete process.env.ATLASLINK_PORT
  try {
    const config = await loadDaemonConfig()
    assert.equal(config.host, DEFAULT_HOST)
    assert.equal(config.port, DEFAULT_PORT)
    assert.match(config.dataDir, /data$/)
    assert.ok(config.agenthood)
  } finally {
    if (previous.ATLASLINK_HOST !== undefined) process.env.ATLASLINK_HOST = previous.ATLASLINK_HOST
    if (previous.ATLASLINK_PORT !== undefined) process.env.ATLASLINK_PORT = previous.ATLASLINK_PORT
  }
})

test('loadDaemonConfig honours env overrides and parses the agenthood provider chain', async () => {
  const previous = { HOST: process.env.ATLASLINK_HOST, PORT: process.env.ATLASLINK_PORT }
  process.env.ATLASLINK_HOST = '0.0.0.0'
  process.env.ATLASLINK_PORT = '8080'
  try {
    const config = await loadDaemonConfig()
    assert.equal(config.host, '0.0.0.0')
    assert.equal(config.port, 8080)
    const providers = config.agenthood.providers ?? []
    assert.ok(providers.length >= 1)
    assert.equal(providers[0].name, 'opencode-go')
  } finally {
    if (previous.HOST !== undefined) process.env.ATLASLINK_HOST = previous.HOST
    if (previous.PORT !== undefined) process.env.ATLASLINK_PORT = previous.PORT
  }
})

test('loadDaemonConfig rejects a non-numeric port', async () => {
  const previous = process.env.ATLASLINK_PORT
  process.env.ATLASLINK_PORT = 'not-a-port'
  try {
    await assert.rejects(loadDaemonConfig(), /invalid ATLASLINK_PORT/)
  } finally {
    if (previous !== undefined) process.env.ATLASLINK_PORT = previous
    else delete process.env.ATLASLINK_PORT
  }
})

test('loadEnvFile applies project .env over an exported stale variable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlaslink-env-'))
  const envPath = join(dir, '.env')
  writeFileSync(envPath, `OPENCODE_API_KEY=new-secret\nQUOTED_VALUE="with quotes"\n# ignored\nEMPTY_VAR=\n`)
  const previousKey = process.env.OPENCODE_API_KEY
  const previousQuoted = process.env.QUOTED_VALUE
  const previousEmpty = process.env.EMPTY_VAR

  process.env.OPENCODE_API_KEY = 'stale-exported-secret'
  delete process.env.QUOTED_VALUE
  delete process.env.EMPTY_VAR
  try {
    loadEnvFile(envPath)
    assert.equal(process.env.OPENCODE_API_KEY, 'new-secret')
    assert.equal(process.env.QUOTED_VALUE, 'with quotes')
    assert.equal(process.env.EMPTY_VAR, undefined)
  } finally {
    if (previousKey !== undefined) process.env.OPENCODE_API_KEY = previousKey
    else delete process.env.OPENCODE_API_KEY
    if (previousQuoted !== undefined) process.env.QUOTED_VALUE = previousQuoted
    else delete process.env.QUOTED_VALUE
    if (previousEmpty !== undefined) process.env.EMPTY_VAR = previousEmpty
    else delete process.env.EMPTY_VAR
    rmSync(dir, { recursive: true, force: true })
  }
})

test('validateConfig throws a clear error when the provider key is missing', () => {
  const previous = process.env.OPENCODE_API_KEY
  delete process.env.OPENCODE_API_KEY
  try {
    assert.throws(() => validateConfig({ provider: 'opencode-go' }), /OPENCODE_API_KEY not set/)
  } finally {
    if (previous !== undefined) process.env.OPENCODE_API_KEY = previous
  }
})

test('loadAgenthoodConfig fails fast on a corrupt config file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlaslink-config-'))
  const configDir = join(dir, '.agenthood')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'config.json'), '{ not json')

  const cwd = process.cwd()
  process.chdir(dir)
  try {
    // loadDaemonConfig reads process.cwd()/.agenthood/config.json
    await assert.rejects(import('./config').then((m) => m.loadDaemonConfig()), /Invalid JSON/)
  } finally {
    process.chdir(cwd)
    rmSync(dir, { recursive: true, force: true })
  }
})
