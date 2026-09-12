import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costUsageOf, backfillDailyCost, dayOf } from './costUsage'
import { SessionStore } from './sessionStore'

test('dayOf takes the UTC calendar day or null', () => {
  assert.equal(dayOf('2026-09-10T23:30:00.000Z'), '2026-09-10')
  assert.equal(dayOf('not-a-date'), null)
  assert.equal(dayOf(undefined), null)
})

test('costUsageOf extracts one reasoning row, else null', () => {
  assert.deepEqual(
    costUsageOf({ type: 'reasoning', member: 'the-builder', model: 'm1', timestamp: '2026-09-10T12:00:00.000Z', promptTokens: 10, completionTokens: 4, stepCost: 0.002 }),
    { day: '2026-09-10', agent: 'the-builder', model: 'm1', promptTokens: 10, completionTokens: 4, stepCost: 0.002 }
  )
  assert.equal(costUsageOf({ type: 'tool.called', member: 'm', timestamp: '2026-09-10T12:00:00.000Z' }), null)
  assert.equal(costUsageOf({ type: 'reasoning', member: 'm', timestamp: '2026-09-10T12:00:00.000Z' }), null)
  assert.equal(costUsageOf({ type: 'reasoning', member: 'm' }), null)
})

test('costUsageOf prefers the payload clock, then createdAt, then null', () => {
  const base = { type: 'reasoning', member: 'm', promptTokens: 1, completionTokens: 1, stepCost: 0.001 }
  assert.equal(costUsageOf({ ...base, timestamp: '2026-09-10T12:00:00.000Z' }, '2026-09-11T00:00:00.000Z')?.day, '2026-09-10')
  assert.equal(costUsageOf({ ...base, timestamp: 'junk' }, '2026-09-11T00:00:00.000Z')?.day, '2026-09-11')
  assert.equal(costUsageOf({ ...base, timestamp: 'junk' }), null)
  assert.equal(costUsageOf({ ...base }, '2026-09-12T00:00:00.000Z')?.agent, 'm')
  assert.equal(costUsageOf({ type: 'reasoning', timestamp: '2026-09-10T12:00:00.000Z', promptTokens: 1, completionTokens: 0, stepCost: 0 })?.agent, 'unknown')
})

const reasoningEvent = (payload: Record<string, unknown>) => ({
  type: 'member.event' as const,
  sessionId: 'ses-1',
  correlationId: 'cor-1',
  at: '2026-09-10T12:00:01Z',
  payload,
})

test('backfillDailyCost fills an empty table from member events', async () => {
  const store = new SessionStore()
  await store.append({ type: 'session.created', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-09-10T12:00:00Z', member: 'the-builder', prompt: 'p' })
  await store.append(reasoningEvent({ type: 'reasoning', member: 'the-builder', model: 'm1', timestamp: '2026-09-10T12:00:00.000Z', promptTokens: 10, completionTokens: 4, stepCost: 0.002 }))
  assert.equal(await backfillDailyCost(store), 1)
  assert.deepEqual(await store.listDailyCost({}), [
    { day: '2026-09-10', agent: 'the-builder', model: 'm1', promptTokens: 10, completionTokens: 4, stepCost: 0.002 },
  ])
})

test('backfillDailyCost never touches a non-empty table', async () => {
  const store = new SessionStore()
  await store.append({ type: 'session.created', sessionId: 'ses-1', correlationId: 'cor-1', at: '2026-09-10T12:00:00Z', member: 'the-builder', prompt: 'p' })
  await store.append(reasoningEvent({ type: 'reasoning', member: 'the-builder', model: 'm1', timestamp: '2026-09-10T12:00:00.000Z', promptTokens: 10, completionTokens: 4, stepCost: 0.002 }))
  await store.recordCostUsage({ day: '2026-09-01', agent: 'seed', model: '', promptTokens: 1, completionTokens: 1, stepCost: 0.001 })
  assert.equal(await backfillDailyCost(store), 0)
  assert.deepEqual(await store.listDailyCost({}), [
    { day: '2026-09-01', agent: 'seed', model: '', promptTokens: 1, completionTokens: 1, stepCost: 0.001 },
  ])
})
