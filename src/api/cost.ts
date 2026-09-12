import type { FastifyInstance } from 'fastify'
import type { SessionBackend, CostUsageRow } from '../session/sessionBackend'
import type { Session as AggregateSession } from '../session/types'
import { backfillDailyCost } from '../session/costUsage'
import { tenantBackendForRequest } from './tenant'

/**
 * LLM spend rollup from durable member.event mirrors (issue #168). Reasoning
 * payloads carry model/promptTokens/completionTokens/stepCost, so the cost
 * surface is derived, never stored — recompute from the store on read.
 * The store caps memberEvents at the last 300 per session, so this totals a
 * floor, not the full history — true lifetime sums need a bucketed counter.
 */

const LIST_LIMIT = 500

interface CostRow {
  agent: string
  promptTokens: number
  completionTokens: number
  stepCost: number
  models: string[]
}

/** One pass over the aggregates; reasoning rows without token fields contribute zero, not NaN. */
export function aggregateCost(sessions: AggregateSession[]): { breakdown: CostRow[]; total: { promptTokens: number; completionTokens: number; stepCost: number } } {
  const byAgent = new Map<string, CostRow>()
  const total = { promptTokens: 0, completionTokens: 0, stepCost: 0 }
  for (const session of sessions) {
    for (const e of session.memberEvents ?? []) {
      if (e.type !== 'reasoning') continue
      const agent = typeof e.member === 'string' && e.member.length > 0 ? e.member : 'unknown'
      const row = byAgent.get(agent) ?? { agent, promptTokens: 0, completionTokens: 0, stepCost: 0, models: [] }
      row.promptTokens += num(e.promptTokens)
      row.completionTokens += num(e.completionTokens)
      row.stepCost += num(e.stepCost)
      if (typeof e.model === 'string' && e.model.length > 0 && !row.models.includes(e.model)) row.models.push(e.model)
      byAgent.set(agent, row)
      total.promptTokens += num(e.promptTokens)
      total.completionTokens += num(e.completionTokens)
      total.stepCost += num(e.stepCost)
    }
  }
  return { breakdown: [...byAgent.values()].sort((a, b) => b.stepCost - a.stepCost), total }
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

interface CostBucket {
  day: string
  promptTokens: number
  completionTokens: number
  stepCost: number
  agents: CostRow[]
}

/**
 * Buckets are shaped from exact counter rows — the read-time window scan is
 * gone, so old days survive session aging and the 300-event tail trim.
 */
export function bucketRows(rows: CostUsageRow[]): { buckets: CostBucket[] } {
  const days = new Map<string, { total: { promptTokens: number; completionTokens: number; stepCost: number }; byAgent: Map<string, CostRow> }>()
  for (const row of rows) {
    const slot = days.get(row.day) ?? { total: { promptTokens: 0, completionTokens: 0, stepCost: 0 }, byAgent: new Map<string, CostRow>() }
    const agentRow = slot.byAgent.get(row.agent) ?? { agent: row.agent, promptTokens: 0, completionTokens: 0, stepCost: 0, models: [] }
    agentRow.promptTokens += row.promptTokens
    agentRow.completionTokens += row.completionTokens
    agentRow.stepCost += row.stepCost
    if (row.model.length > 0 && !agentRow.models.includes(row.model)) agentRow.models.push(row.model)
    slot.byAgent.set(row.agent, agentRow)
    slot.total.promptTokens += row.promptTokens
    slot.total.completionTokens += row.completionTokens
    slot.total.stepCost += row.stepCost
    days.set(row.day, slot)
  }
  return {
    buckets: [...days.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, slot]) => ({
        day,
        ...slot.total,
        agents: [...slot.byAgent.values()].sort((a, b) => b.stepCost - a.stepCost),
      })),
  }
}

const HISTORY_WINDOW_DAYS = 30

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// one backfill per tenant at a time: concurrent first-hits share the single
// fill instead of each writing the same increment rows twice
const backfillInflight = new Map<string, Promise<number>>()

async function ensureCostBackfill(backend: SessionBackend, tenantKey: string): Promise<void> {
  let inflight = backfillInflight.get(tenantKey)
  if (!inflight) {
    inflight = backfillDailyCost(backend).finally(() => {
      backfillInflight.delete(tenantKey)
    })
    backfillInflight.set(tenantKey, inflight)
  }
  await inflight
}

export async function registerCostRoutes(app: FastifyInstance, deps: { backend: SessionBackend }): Promise<void> {
  app.get('/cost', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const { sessions } = await tenantCtx.backend.list({ tenantId: tenantCtx.tenantId, limit: LIST_LIMIT, offset: 0 })
    return reply.send({ ok: true, ...aggregateCost(sessions) })
  })

  app.get<{ Querystring: { since?: string; until?: string } }>(
    '/cost/history',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            since: { type: 'string' },
            until: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const { since, until } = request.query
      if (since !== undefined && Number.isNaN(Date.parse(since))) {
        return reply.code(400).send({ ok: false, error: 'since must be an ISO-8601 date-time' })
      }
      if (until !== undefined && Number.isNaN(Date.parse(until))) {
        return reply.code(400).send({ ok: false, error: 'until must be an ISO-8601 date-time' })
      }
      // default window: the last 30 UTC days — the table is exact, so the
      // window only bounds the response, never the history itself
      const now = new Date()
      const from = since === undefined ? isoDay(new Date(now.getTime() - (HISTORY_WINDOW_DAYS - 1) * 86400000)) : isoDay(new Date(Date.parse(since)))
      const to = until === undefined ? isoDay(now) : isoDay(new Date(Date.parse(until)))
      await ensureCostBackfill(tenantCtx.backend, tenantCtx.tenantId ?? 'default')
      const rows = await tenantCtx.backend.listDailyCost({ since: from, until: to })
      return reply.send({ ok: true, since: from, until: to, ...bucketRows(rows) })
    },
  )
}
