import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateCost } from './cost'
import type { Session as AggregateSession } from '../session/types'

const session = (memberEvents?: Record<string, unknown>[]): AggregateSession => ({ memberEvents }) as AggregateSession

test('aggregateCost rolls tokens and cost per agent, sorted by spend', () => {
  const { breakdown, total } = aggregateCost([
    session([
      { type: 'reasoning', member: 'the-builder', model: 'm1', promptTokens: 10, completionTokens: 4, stepCost: 0.002 },
      { type: 'reasoning', member: 'the-architect', model: 'm2', promptTokens: 20, completionTokens: 8, stepCost: 0.004 },
      { type: 'tool.called', member: 'the-builder' },
      { type: 'reasoning', member: 'the-architect', model: 'm3', promptTokens: 1, completionTokens: 1, stepCost: 0.001 },
    ]),
  ])
  assert.equal(breakdown.length, 2)
  assert.equal(breakdown[0].agent, 'the-architect')
  assert.deepEqual(breakdown[0].models, ['m2', 'm3'])
  assert.equal(breakdown[0].promptTokens, 21)
  assert.equal(total.stepCost, 0.007)
})

test('aggregateCost is zero-shaped for empty input', () => {
  assert.deepEqual(aggregateCost([]), { breakdown: [], total: { promptTokens: 0, completionTokens: 0, stepCost: 0 } })
  assert.deepEqual(aggregateCost([session(undefined)]).total, { promptTokens: 0, completionTokens: 0, stepCost: 0 })
})
