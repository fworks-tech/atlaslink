import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, jsonRequest, startServer, tmpDataDir } from '../../test/serverHarness'

interface GraphResult {
  data?: Record<string, unknown>
  errors?: { message: string; extensions?: { code?: string } }[]
}

async function gql(port: number, query: string): Promise<GraphResult> {
  const res = await jsonRequest(port, 'POST', '/v1/graphql/insights', { query })
  assert.equal(res.status, 200, `graph endpoint must answer 200: ${res.body}`)
  return JSON.parse(res.body) as GraphResult
}

interface TraceInput {
  member: string
  cost: number
  status: 'success' | 'error'
  input: number
  output: number
  total: number
  durationMs: number
  timestamp: string
}

function traceLine(t: TraceInput): string {
  return JSON.stringify({
    member: t.member,
    inputHash: 'h',
    outputHash: 'o',
    durationMs: t.durationMs,
    tokenCount: { input: t.input, output: t.output, total: t.total },
    cost: t.cost,
    qualityScore: null,
    status: t.status,
    correlationId: `cor-${t.timestamp}`,
    timestamp: t.timestamp,
    source: 'daemon',
    model: 'm1',
  })
}

const INSIGHTS_QUERY = `query {
  insights {
    count errorCount
    total { runs errors token { input output total } cost durationMs }
    byMember { member usage { runs errors cost } }
    byModel { model usage { runs } }
    topCost { member cost }
    topContext { member maxInputTokens }
    highestOutputRatio { member ratio }
    contextUtil { p50 p90 p99 }
    costTrend { first second changePct }
  }
}`

test('insights folds the trace store into the report graph', async () => {
  const dir = tmpDataDir()
  const traces = join(dir, 'traces.ndjson')
  const lines = [
    traceLine({ member: 'the-builder', cost: 0.01, status: 'success', input: 100, output: 50, total: 150, durationMs: 1000, timestamp: '2026-10-03T00:00:00.000Z' }),
    traceLine({ member: 'the-builder', cost: 0.02, status: 'success', input: 200, output: 100, total: 300, durationMs: 2000, timestamp: '2026-10-03T01:00:00.000Z' }),
    traceLine({ member: 'the-architect', cost: 0.05, status: 'error', input: 100, output: 400, total: 500, durationMs: 3000, timestamp: '2026-10-03T02:00:00.000Z' }),
    'not valid json {',
  ]
  writeFileSync(traces, lines.join('\n'), 'utf8')
  const srv = await startServer(dir, { insightsTracesPath: traces })
  try {
    const result = await gql(srv.port, INSIGHTS_QUERY)
    assert.equal(result.errors, undefined, JSON.stringify(result.errors))
    const report = result.data!.insights as {
      count: number
      errorCount: number
      total: { runs: number; errors: number; token: { input: number; output: number; total: number }; cost: number; durationMs: number }
      byMember: { member: string; usage: { runs: number; errors: number; cost: number } }[]
      byModel: { model: string; usage: { runs: number } }[]
      topCost: { member: string; cost: number }[]
      topContext: { member: string; maxInputTokens: number }[]
      highestOutputRatio: { member: string; ratio: number }[]
      contextUtil: { p50: number } | null
      costTrend: { first: number; second: number; changePct: number | null } | null
    }
    assert.equal(report.count, 3, 'garbage line must be dropped')
    assert.equal(report.errorCount, 1)
    assert.deepEqual(report.total.token, { input: 400, output: 550, total: 950 })
    assert.ok(Math.abs(report.total.cost - 0.08) < 1e-9)
    assert.equal(report.total.durationMs, 6000)
    assert.deepEqual(
      report.byMember.map((x) => x.member).sort(),
      ['the-architect', 'the-builder']
    )
    assert.equal(report.byMember.find((x) => x.member === 'the-architect')!.usage.errors, 1)
    assert.deepEqual(report.byModel, [{ model: 'm1', usage: { runs: 3 } }])
    assert.deepEqual(report.topCost.map((x) => x.member), ['the-architect', 'the-builder'])
    assert.deepEqual(report.topContext.map((x) => x.member), ['the-builder', 'the-architect'])
    assert.deepEqual(report.highestOutputRatio.map((x) => x.member), ['the-architect', 'the-builder'])
    assert.equal(report.highestOutputRatio[0].ratio, 4)
    assert.equal(report.contextUtil, null, 'no context-window stamps → null')
    assert.ok(report.costTrend)
    assert.ok(Math.abs(report.costTrend!.changePct! - 6) < 0.01)
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('a missing trace store reads as a zero report', async () => {
  const dir = tmpDataDir()
  const srv = await startServer(dir, { insightsTracesPath: join(dir, 'nope', 'traces.ndjson') })
  try {
    const result = await gql(srv.port, INSIGHTS_QUERY)
    assert.equal(result.errors, undefined, JSON.stringify(result.errors))
    const report = result.data!.insights as {
      count: number
      errorCount: number
      total: { runs: number; cost: number }
      byMember: unknown[]
      topCost: unknown[]
      contextUtil: unknown
      costTrend: unknown
    }
    assert.equal(report.count, 0)
    assert.equal(report.errorCount, 0)
    assert.equal(report.total.runs, 0)
    assert.equal(report.total.cost, 0)
    assert.deepEqual(report.byMember, [])
    assert.deepEqual(report.topCost, [])
    assert.equal(report.contextUtil, null)
    assert.equal(report.costTrend, null)
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('a zero first-half cost trend surfaces changePct as null, not a crash', async () => {
  const dir = tmpDataDir()
  const traces = join(dir, 'traces.ndjson')
  writeFileSync(
    traces,
    [
      traceLine({ member: 'the-builder', cost: 0, status: 'success', input: 10, output: 10, total: 20, durationMs: 100, timestamp: '2026-10-03T00:00:00.000Z' }),
      traceLine({ member: 'the-builder', cost: 5, status: 'success', input: 10, output: 10, total: 20, durationMs: 100, timestamp: '2026-10-03T01:00:00.000Z' }),
    ].join('\n'),
    'utf8'
  )
  const srv = await startServer(dir, { insightsTracesPath: traces })
  try {
    const result = await gql(srv.port, 'query { insights { count costTrend { first second changePct } } }')
    assert.equal(result.errors, undefined, JSON.stringify(result.errors))
    const trend = (result.data!.insights as { costTrend: { first: number; second: number; changePct: number | null } }).costTrend
    assert.equal(trend.first, 0)
    assert.equal(trend.second, 5)
    assert.equal(trend.changePct, null, 'Infinity from a zero first half must serialize as null')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})

test('the insights read path leaves the session write path untouched', async () => {
  const dir = tmpDataDir()
  const traces = join(dir, 'traces.ndjson')
  writeFileSync(traces, '', 'utf8')
  const srv = await startServer(dir, { insightsTracesPath: traces })
  try {
    const result = await gql(srv.port, 'query { insights { count } }')
    assert.equal((result.data!.insights as { count: number }).count, 0)

    const tasks = await jsonRequest(srv.port, 'GET', '/v1/tasks')
    const listed = JSON.parse(tasks.body) as { total: number }
    assert.equal(listed.total, 0, 'querying insights must not create or read sessions')
  } finally {
    await srv.close()
    cleanup(dir)
  }
})
