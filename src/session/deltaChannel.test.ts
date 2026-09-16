import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeltaChannel, DEFAULT_SNAPSHOT_EVERY, planWrite, reconstructRows } from './deltaChannel'
import type { CheckpointData } from 'agenthood/dist/checkpoint/RunCheckpoint.js'

function checkpoint(id: string, step: number, messageCount: number): CheckpointData {
  return {
    id,
    member: 'the-scribe',
    task: 't',
    step,
    messages: Array.from({ length: messageCount }, (_, i) => ({ role: 'assistant' as const, content: `msg-${i}` })),
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'm',
    activatedSkills: [],
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: `2026-01-01T00:00:0${step % 10}.000Z`,
  }
}

test('first write is a full snapshot', () => {
  const channel = new DeltaChannel()
  const row = channel.plan('cor-1', checkpoint('cor-1', 1, 3))
  assert.equal(row?.kind, 'full')
  const parsed = JSON.parse(row!.data)
  assert.equal(parsed.messages.length, 3)
})

test('append-only growth plans a delta carrying only the tail', () => {
  const channel = new DeltaChannel()
  channel.plan('cor-1', checkpoint('cor-1', 1, 3))
  const row = channel.plan('cor-1', checkpoint('cor-1', 2, 4))
  assert.equal(row?.kind, 'delta')
  const parsed = JSON.parse(row!.data)
  assert.equal(parsed.added.length, 1)
  assert.deepEqual(parsed.meta.messages, undefined)
  assert.equal(parsed.meta.step, 2)
})

test('double-persist of unchanged data plans no row', () => {
  const channel = new DeltaChannel()
  channel.plan('cor-1', checkpoint('cor-1', 1, 3))
  assert.equal(channel.plan('cor-1', checkpoint('cor-1', 1, 3)), null)
})

test('snapshot re-anchor after N deltas', () => {
  const channel = new DeltaChannel(2)
  assert.equal(channel.plan('cor-1', checkpoint('cor-1', 1, 1))?.kind, 'full')
  assert.equal(channel.plan('cor-1', checkpoint('cor-1', 2, 2))?.kind, 'delta')
  assert.equal(channel.plan('cor-1', checkpoint('cor-1', 3, 3))?.kind, 'delta')
  const fourth = channel.plan('cor-1', checkpoint('cor-1', 4, 4)) // 2 deltas stored -> re-anchor
  assert.equal(fourth?.kind, 'full')
})

test('message trim or reorder forces a full re-anchor', () => {
  const channel = new DeltaChannel()
  channel.plan('cor-1', checkpoint('cor-1', 1, 5))
  const trimmed = checkpoint('cor-1', 2, 3) // context was trimmed
  assert.equal(channel.plan('cor-1', trimmed)?.kind, 'full')
  // reorder: same length, different content — prefix check must catch it too
  const base = checkpoint('cor-1', 3, 3)
  channel.plan('cor-1', base)
  const reordered = checkpoint('cor-1', 4, 3)
  reordered.messages = [reordered.messages[2], reordered.messages[1], reordered.messages[0]]
  assert.equal(channel.plan('cor-1', reordered)?.kind, 'full')
})

test('reconstruct replays snapshot + deltas into the latest value', () => {
  const channel = new DeltaChannel(2)
  const rows: { kind: 'full' | 'delta'; step: number; data: string }[] = []
  for (let step = 1; step <= 5; step += 1) {
    const row = channel.plan('cor-1', checkpoint('cor-1', step, step))!
    rows.push({ kind: row.kind, step: rows.length, data: row.data })
    channel.push('cor-1', { ...row, step: rows.length })
  }
  const revived = channel.reconstruct('cor-1')
  assert.equal(revived?.messages.length, 5)
  assert.equal(revived?.step, 5)
  assert.equal(revived?.status, 'running')
  assert.equal(reconstructRows(rows)!.messages.length, 5)
})

test('reconstruct of a delta-only channel yields null', () => {
  assert.equal(reconstructRows([{ kind: 'delta', step: 0, data: '{"added":[],"baseCount":0,"meta":{}}' }]), null)
})

test('history mirrors the rows pushed through the channel', () => {
  const channel = new DeltaChannel()
  const first = channel.plan('cor-1', checkpoint('cor-1', 1, 1))!
  channel.push('cor-1', { ...first, step: 0 })
  const second = channel.plan('cor-1', checkpoint('cor-1', 2, 2))!
  channel.push('cor-1', { ...second, step: 1 })
  const history = channel.history('cor-1')
  assert.deepEqual(history.map((r) => r.kind), ['full', 'delta'])
})

test('planWrite default cadence matches DEFAULT_SNAPSHOT_EVERY', () => {
  assert.ok(DEFAULT_SNAPSHOT_EVERY >= 1)
  const before = { messageCount: 0, prefixJson: '[]', deltasSinceSnapshot: DEFAULT_SNAPSHOT_EVERY, lastMetaJson: '{}' }
  const { row } = planWrite(before, checkpoint('cor-1', 1, 1), DEFAULT_SNAPSHOT_EVERY)
  assert.equal(row?.kind, 'full')
})
