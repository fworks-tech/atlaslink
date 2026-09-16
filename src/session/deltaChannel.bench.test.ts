import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeltaChannel } from './deltaChannel'
import type { CheckpointData } from 'agenthood/dist/checkpoint/RunCheckpoint.js'

/**
 * The issue's merge gate: for a long run (1000 reasoning steps), storing a
 * full checkpoint blob every step vs the delta channel must show at least a
 * 50% reduction in bytes at rest. Both simulations keep the same message
 * growth (one ~200-char assistant message per step) and identical snapshot
 * cadence, so the comparison isolates the encoding.
 */

const STEPS = 1000
const MSG_BYTES = 200

function checkpoint(id: string, step: number): CheckpointData {
  return {
    id,
    member: 'the-scribe',
    task: 't',
    step,
    messages: Array.from({ length: step }, (_, i) => ({ role: 'assistant' as const, content: `m${i}`.padEnd(MSG_BYTES, 'x') })),
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'm',
    activatedSkills: [],
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('delta channel stores at least 50% fewer bytes than full snapshots', () => {
  let fullBytes = 0
  for (let step = 1; step <= STEPS; step += 1) {
    fullBytes += JSON.stringify(checkpoint('cor-1', step)).length
  }

  const channel = new DeltaChannel()
  let deltaBytes = 0
  let rows = 0
  for (let step = 1; step <= STEPS; step += 1) {
    const row = channel.plan('cor-1', checkpoint('cor-1', step))!
    deltaBytes += row.data.length
    channel.push('cor-1', { ...row, step: rows })
    rows += 1
  }

  const reduction = 1 - deltaBytes / fullBytes
  assert.ok(
    reduction >= 0.5,
    `expected >=50% reduction, got ${(reduction * 100).toFixed(1)}% (full=${fullBytes} delta=${deltaBytes})`,
  )
})

test('delta channel reconstructs the final value after a 1000-step run', () => {
  const channel = new DeltaChannel()
  for (let step = 1; step <= STEPS; step += 1) {
    const row = channel.plan('cor-1', checkpoint('cor-1', step))!
    channel.push('cor-1', { ...row, step })
  }
  const revived = channel.reconstruct('cor-1')
  assert.equal(revived?.messages.length, STEPS)
  assert.equal(revived?.messages[STEPS - 1].content.length, MSG_BYTES)
})
