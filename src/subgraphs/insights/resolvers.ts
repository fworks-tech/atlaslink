import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'graphql'
import { buildSubgraphSchema } from '@apollo/subgraph'
import type { FastifyInstance } from 'fastify'
import { buildInsightsReport, readTraceEnvelopes, type InsightsReport, type PerGroup } from '../../bridge/insights'
import { registerSubgraph } from '../executor'
import type {
  Resolvers,
  InsightsReport as GraphInsightsReport,
  UsageGroup,
  MemberUsage,
  ModelUsage,
} from './graphql'

const typeDefs = parse(readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8'))

/** Per-request resolver context: only the trace store location — a process-global read (#295). */
export interface InsightsSubgraphDeps {
  /** NDJSON trace store; defaults to the project-cwd location the CLI reads. */
  tracesPath?: string
}

/**
 * Projects a usage group onto the graph shape checked by the generated type.
 *
 * @param g - aggregated usage counters
 * @returns the graph-shaped group
 */
function mapGroup(g: PerGroup): UsageGroup {
  return { runs: g.runs, errors: g.errors, token: g.token, cost: g.cost, durationMs: g.durationMs }
}

/**
 * Folds the trace report onto the GraphQL `InsightsReport` shape; JSON cannot
 * carry Infinity (a zero first half), so the trend change surfaces as null.
 *
 * @param report - report built from the trace envelopes
 * @returns the graph-shaped report
 */
function mapReport(report: InsightsReport): GraphInsightsReport {
  return {
    generatedAt: report.generatedAt,
    count: report.count,
    errorCount: report.errorCount,
    total: mapGroup(report.total),
    byMember: Object.entries(report.byMember).map(([member, usage]): MemberUsage => ({ member, usage: mapGroup(usage) })),
    byModel: Object.entries(report.byModel).map(([model, usage]): ModelUsage => ({ model, usage: mapGroup(usage) })),
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

/** Schema-derived resolver map — types generated from schema.graphql (#324). */
const resolvers: Resolvers = {
  Query: {
    insights: (_parent, _args, deps) =>
      mapReport(buildInsightsReport(readTraceEnvelopes(deps.tracesPath ?? resolve(process.cwd(), '.agenthood', 'traces', 'traces.ndjson')))),
  },
}

/**
 * Mounts the insights subgraph on `/v1/graphql/insights` behind the shared
 * executor envelope (HTTP 200 with a GraphQL body).
 *
 * @param app - Fastify instance that owns the `/v1` scope
 * @param deps - trace store location (the deps object doubles as context)
 */
export function registerInsightsSubgraph(app: FastifyInstance, deps: InsightsSubgraphDeps = {}): void {
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }])
  registerSubgraph(app, 'insights', schema, () => deps)
}
