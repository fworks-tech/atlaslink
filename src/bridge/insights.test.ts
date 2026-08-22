import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInsightsReport } from './insights'
import type { TraceEnvelope } from 'agenthood/dist/core/types.js'

function envelope(overrides: Partial<TraceEnvelope> & Record<string, unknown> = {}): TraceEnvelope {
  return {
    member: 'the-architect',
    inputHash: 'h',
    outputHash: 'h',
    durationMs: 1000,
    tokenCount: { input: 100, output: 10, total: 110 },
    cost: 0.01,
    qualityScore: null,
    status: 'success',
    correlationId: 'cor-1',
    timestamp: '2026-08-22T00:00:00.000Z',
    source: 'api',
    model: 'deepseek-v4-flash',
    ...overrides,
  }
}

test('aggregates totals, errors, and groups by member and model', () => {
  const report = buildInsightsReport([
    envelope({ timestamp: '2026-08-22T00:00:00.000Z' }),
    envelope({ timestamp: '2026-08-22T00:00:01.000Z', member: 'the-scribe', model: 'deepseek-v4-pro' }),
    envelope({ timestamp: '2026-08-22T00:00:02.000Z', status: 'error' }),
  ])

  assert.equal(report.count, 3)
  assert.equal(report.errorCount, 1)
  assert.equal(report.total.token.input, 300)
  assert.equal(report.total.token.output, 30)
  assert.equal(report.total.cost, 0.03)
  assert.equal(report.byMember['the-architect'].runs, 2)
  assert.equal(report.byMember['the-scribe'].cost, 0.01)
  assert.equal(report.byModel['deepseek-v4-pro'].runs, 1)
  assert.equal(report.byModel['deepseek-v4-flash'].cost, 0.02)
})

test('errors are counted but still aggregated into cost/tokens', () => {
  const report = buildInsightsReport([
    envelope({ status: 'error' }),
    envelope({ status: 'error' }),
  ])
  assert.equal(report.errorCount, 2)
  assert.equal(report.byMember['the-architect'].errors, 2)
  assert.equal(report.byMember['the-architect'].cost, 0.02)
})

test('ranks top cost centers by cost descending', () => {
  const report = buildInsightsReport([
    envelope({ member: 'the-reviewer', cost: 0.4 }),
    envelope({ member: 'the-architect', cost: 0.2 }),
    envelope({ member: 'the-scribe', cost: 0.1 }),
  ])
  assert.deepEqual(report.topCost.map((x) => x.member), ['the-reviewer', 'the-architect', 'the-scribe'])
})

test('identifies high-input (context-pressure) and high-output-ratio members', () => {
  const report = buildInsightsReport([
    envelope({ member: 'the-reviewer', tokenCount: { input: 9000, output: 90, total: 9090 } }),
    envelope({ member: 'the-scribe', tokenCount: { input: 1000, output: 800, total: 1800 } }),
  ])
  assert.equal(report.topContext[0].member, 'the-reviewer')
  assert.equal(report.topContext[0].maxInputTokens, 9000)
  assert.equal(report.highestOutputRatio[0].member, 'the-scribe')
  assert.ok(report.highestOutputRatio[0].ratio > report.highestOutputRatio[1].ratio)
})

test('reports context utilization percentiles when envelopes carry contextWindow/contextUtil', () => {
  const report = buildInsightsReport([
    envelope({ contextWindow: 1000, contextUtil: 0.5 }),
    envelope({ contextWindow: 1000, contextUtil: 0.9 }),
    envelope({ contextWindow: 1000, contextUtil: 0.2 }),
  ])
  assert.ok(report.contextUtil, 'contextUtil should be present')
  assert.ok(report.contextUtil!.p50 <= report.contextUtil!.p90)
  assert.ok(report.contextUtil!.p90 <= report.contextUtil!.p99)
})

test('leaves contextUtil null when no envelopes report a context window', () => {
  const report = buildInsightsReport([envelope(), envelope()])
  assert.equal(report.contextUtil, null)
})

test('computes cost trend between first and second halves', () => {
  const report = buildInsightsReport([
    envelope({ cost: 0.01 }), envelope({ cost: 0.01 }), // first half = 0.02
    envelope({ cost: 0.03 }), envelope({ cost: 0.03 }), // second half = 0.06
  ])
  assert.ok(report.costTrend)
  assert.equal(report.costTrend!.first, 0.02)
  assert.equal(report.costTrend!.second, 0.06)
  assert.equal(report.costTrend!.changePct, 2) // +200%
})

test('returns null costTrend for empty input', () => {
  const report = buildInsightsReport([])
  assert.equal(report.count, 0)
  assert.equal(report.costTrend, null)
  assert.equal(report.contextUtil, null)
})