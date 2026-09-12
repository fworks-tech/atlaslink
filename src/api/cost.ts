import type { FastifyInstance } from 'fastify'
import type { SessionBackend } from '../session/sessionBackend'
import type { Session as AggregateSession } from '../session/types'
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

export async function registerCostRoutes(app: FastifyInstance, deps: { backend: SessionBackend }): Promise<void> {
  app.get('/cost', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const { sessions } = await tenantCtx.backend.list({ tenantId: tenantCtx.tenantId, limit: LIST_LIMIT, offset: 0 })
    return reply.send({ ok: true, ...aggregateCost(sessions) })
  })
}
