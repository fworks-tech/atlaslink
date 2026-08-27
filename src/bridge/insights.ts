import type { TraceEnvelope } from 'agenthood/dist/core/types.js'

export interface TokenBuckets {
  input: number
  output: number
  total: number
}

export interface PerGroup {
  runs: number
  errors: number
  token: TokenBuckets
  cost: number
  durationMs: number
}

export interface InsightsReport {
  generatedAt: string
  count: number
  errorCount: number
  total: PerGroup
  byMember: Record<string, PerGroup>
  byModel: Record<string, PerGroup>
  topCost: { member: string; cost: number; token: TokenBuckets }[]
  topContext: { member: string; maxInputTokens: number; avgInputTokens: number }[]
  highestOutputRatio: { member: string; ratio: number }[]
  /** Context utilization percentiles across runs that reported a context window (branch 5). */
  contextUtil: { p50: number; p90: number; p99: number } | null
  /** Cost growth between the first and second halves of the window. */
  costTrend: { first: number; second: number; changePct: number } | null
}

const emptyGroup = (): PerGroup => ({
  runs: 0,
  errors: 0,
  token: { input: 0, output: 0, total: 0 },
  cost: 0,
  durationMs: 0,
})

function addGroup(target: PerGroup, e: TraceEnvelope): void {
  target.runs += 1
  target.errors += e.status === 'error' ? 1 : 0
  target.token.input += e.tokenCount?.input ?? 0
  target.token.output += e.tokenCount?.output ?? 0
  target.token.total += e.tokenCount?.total ?? 0
  target.cost += e.cost ?? 0
  target.durationMs += e.durationMs ?? 0
}

function fold(envelopes: TraceEnvelope[]): PerGroup {
  return envelopes.reduce((acc, e) => {
    addGroup(acc, e)
    return acc
  }, emptyGroup())
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(Math.max(Math.floor((p / 100) * sorted.length) - 1, 0), sorted.length - 1)
  return sorted[idx]
}

/** Bucket state built by a single pass over the chronologically ordered envelope list. */
interface Classified {
  ordered: TraceEnvelope[]
  total: PerGroup
  byMember: Record<string, PerGroup>
  byModel: Record<string, PerGroup>
  inputByMember: Record<string, number[]>
  ratioByMember: Record<string, number[]>
  utilSamples: number[]
  contextWindowReported: boolean
}

/**
 * One chronological pass that folds totals, buckets by member and model, and
 * collects the per-member samples (input tokens, output/input ratio) plus the
 * context-utilization observations (branch 5 stamps) the rankings consume.
 */
function classify(envelopes: TraceEnvelope[]): Classified {
  const ordered = [...envelopes].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const byMember: Record<string, PerGroup> = {}
  const byModel: Record<string, PerGroup> = {}
  const inputByMember: Record<string, number[] | undefined> = {}
  const ratioByMember: Record<string, number[] | undefined> = {}
  const utilSamples: number[] = []
  let contextWindowReported = false

  for (const e of ordered) {
    const member = e.member || 'unknown'
    const model = e.model || 'unknown'
    byMember[member] ??= emptyGroup()
    addGroup(byMember[member], e)
    byModel[model] ??= emptyGroup()
    addGroup(byModel[model], e)

    const input = e.tokenCount?.input ?? 0
    const output = e.tokenCount?.output ?? 0
    inputByMember[member] ??= []
    inputByMember[member]!.push(input)
    if (output > 0 && input > 0) {
      ratioByMember[member] ??= []
      ratioByMember[member]!.push(output / input)
    }

    const window = (e as TraceEnvelope & { contextWindow?: number }).contextWindow
    const util = (e as TraceEnvelope & { contextUtil?: number }).contextUtil
    if (typeof window === 'number' && typeof util === 'number' && window > 0) {
      contextWindowReported = true
      utilSamples.push(util)
    }
  }

  return {
    ordered,
    total: fold(ordered),
    byMember,
    byModel,
    inputByMember: inputByMember as Record<string, number[]>,
    ratioByMember: ratioByMember as Record<string, number[]>,
    utilSamples,
    contextWindowReported,
  }
}

/** Top-5 optimization levers — cost centers, context pressure, output-ratio outliers — plus the window cost trend. */
function rankings(
  c: Classified
): Pick<InsightsReport, 'topCost' | 'topContext' | 'highestOutputRatio' | 'costTrend'> {
  const topCost = Object.entries(c.byMember)
    .map(([member, g]) => ({ member, cost: g.cost, token: g.token }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)

  const topContext = Object.entries(c.inputByMember)
    .map(([member, arr]) => ({
      member,
      maxInputTokens: arr.reduce((a, b) => (b > a ? b : a), 0),
      avgInputTokens: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    }))
    .sort((a, b) => b.maxInputTokens - a.maxInputTokens)
    .slice(0, 5)

  const highestOutputRatio = Object.entries(c.ratioByMember)
    .map(([member, arr]) => ({
      member,
      ratio: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100,
    }))
    .filter((x) => x.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5)

  let costTrend: InsightsReport['costTrend'] = null
  if (c.ordered.length >= 2) {
    const mid = Math.floor(c.ordered.length / 2)
    const first = c.ordered.slice(0, mid).reduce((a, e) => a + (e.cost ?? 0), 0)
    const second = c.ordered.slice(mid).reduce((a, e) => a + (e.cost ?? 0), 0)
    const changePct = first > 0 ? Math.round(((second - first) / first) * 100) / 100 : second > 0 ? Infinity : 0
    costTrend = { first, second, changePct }
  }

  return { topCost, topContext, highestOutputRatio, costTrend }
}

/**
 * Pure aggregator over recorded trace envelopes. Produces a cost/token/reliability
 * report grouped by member and model, plus the optimization levers (top cost
 * centers, context-pressure candidates, output-ratio outliers) and a cost trend
 * across the window. Kept pure and side-effect free so it is trivially testable
 * and can also be computed server-side on the M2 bridge.
 */
export function buildInsightsReport(envelopes: TraceEnvelope[]): InsightsReport {
  const classified = classify(envelopes)
  const { topCost, topContext, highestOutputRatio, costTrend } = rankings(classified)
  const util = [...classified.utilSamples].sort((a, b) => a - b)
  const rankedP = (p: number): number => percentile(util, p)

  return {
    generatedAt: new Date().toISOString(),
    count: classified.ordered.length,
    errorCount: classified.total.errors,
    total: classified.total,
    byMember: classified.byMember,
    byModel: classified.byModel,
    topCost,
    topContext,
    highestOutputRatio,
    contextUtil: classified.contextWindowReported
      ? { p50: rankedP(50), p90: rankedP(90), p99: rankedP(99) }
      : null,
    costTrend,
  }
}