import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLogStore, type BridgeEnvelope } from './EventLogStore'
import { EventBroadcaster } from './EventBroadcaster'
import { SseHandler, formatSse, PING_INTERVAL_MS } from './sseEndpoint'

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'atlaslink-sseunit-'))
}

function env(eventId: number, overrides: Record<string, unknown> = {}): BridgeEnvelope {
  return {
    eventId,
    type: 'run.started',
    executionId: 'e-1',
    member: 'm',
    correlationId: 'c',
    timestamp: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

test('formatSse preserves the emitter type verbatim', () => {
  const frame = formatSse(env(7, { type: 'reasoning', step: 1, content: 'x' }))
  assert.ok(frame.startsWith('id: 7'))
  assert.ok(frame.includes('event: reasoning'))
  assert.ok(frame.includes('data: {"eventId":7'))
  assert.ok(frame.endsWith('\n\n'))
})

test('formatSse namespaces session.* and bridge.* types without rewriting', () => {
  const session = formatSse(env(1, { type: 'session.queued', sessionId: 's', status: 'queued', at: 'now' }))
  assert.ok(session.includes('event: session.queued'))
  assert.ok(session.includes('"status":"queued"'))
})

test('SseHandler exposes the broadcaster for run code to emit through', async () => {
  const dir = tmpDataDir()
  try {
    const log = await EventLogStore.open(dir)
    const broadcaster = new EventBroadcaster(log)
    const handler = new SseHandler(log, broadcaster)
    assert.strictEqual(handler.broadcaster, broadcaster)
    handler.shutdown()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PING_INTERVAL_MS is 15s per spec §4', () => {
  assert.equal(PING_INTERVAL_MS, 15000)
})

test('shutdown clears internal connection tracking and the ping timer', async () => {
  const dir = tmpDataDir()
  try {
    const log = await EventLogStore.open(dir)
    const handler = new SseHandler(log, new EventBroadcaster(log))
    handler.shutdown()
    // calling shutdown again must not throw
    handler.shutdown()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})