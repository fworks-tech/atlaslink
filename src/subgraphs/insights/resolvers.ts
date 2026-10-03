import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'graphql'
import { buildSubgraphSchema } from '@apollo/subgraph'
import type { FastifyInstance } from 'fastify'
import { buildInsightsReport, readTraceEnvelopes, type InsightsReport, type PerGroup } from '../../bridge/insights'
import { registerSubgraph } from '../executor'

const typeDefs = parse(readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8'))

export interface InsightsSubgraphDeps {
  /** NDJSON trace store; defaults to the project-cwd location the CLI reads. */
  tracesPath?: string
}

function mapGroup(g: PerGroup): Record<string, unknown> {
  return { runs: g.runs, errors: g.errors, token: g.token, cost: g.cost, durationMs: g.durationMs }
}

function mapReport(report: InsightsReport): Record<string, unknown> {
  return {
    generatedAt: report.generatedAt,
    count: report.count,
    errorCount: report.errorCount,
    total: mapGroup(report.total),
    byMember: Object.entries(report.byMember).map(([member, usage]) => ({ member, usage: mapGroup(usage) })),
    byModel: Object.entries(report.byModel).map(([model, usage]) => ({ model, usage: mapGroup(usage) })),
    topCost: report.topCost,
    topContext: report.topContext,
    highestOutputRatio: report.highestOutputRatio,
    contextUtil: report.contextUtil,
    // JSON cannot carry Infinity (a zero first half) — surface it as null
    costTrend: report.costTrend
      ? { ...report.costTrend, changePct: Number.isFinite(report.costTrend.changePct) ? report.costTrend.changePct : null }
      : null,
  }
}

const resolvers = {
  Query: {
    insights: (_: unknown, __: unknown, deps: InsightsSubgraphDeps) =>
      mapReport(buildInsightsReport(readTraceEnvelopes(deps.tracesPath ?? resolve(process.cwd(), '.agenthood', 'traces', 'traces.ndjson')))),
  },
}

export function registerInsightsSubgraph(app: FastifyInstance, deps: InsightsSubgraphDeps = {}): void {
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }])
  registerSubgraph(app, 'insights', schema, () => deps)
}
