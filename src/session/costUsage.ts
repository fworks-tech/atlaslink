import type { SessionBackend, CostUsageRow } from './sessionBackend'

/**
 * Pure extractor for the durable cost counter (issue #168, history phase).
 * Leaf module — type-only imports, so the daemon mirror chain, the boot
 * backfill and the API route can all share it without import cycles.
 */

/** UTC calendar day of an ISO timestamp, or null when it is not a date. */
export function dayOf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

function hasUsage(e: Record<string, unknown>): boolean {
  return ['promptTokens', 'completionTokens', 'stepCost'].some((k) => typeof e[k] === 'number')
}

/**
 * One reasoning mirror row's spend, or null when there is nothing to count.
 * Day comes from the payload's own timestamp (the original LLM-call time);
 * createdAt is the only fallback — envelope `at` is mirror-write time and
 * already dropped from the projection.
 */
export function costUsageOf(payload: Record<string, unknown>, fallbackDay?: string): CostUsageRow | null {
  if (payload.type !== 'reasoning' || !hasUsage(payload)) return null
  const day = dayOf(payload.timestamp) ?? (fallbackDay === undefined ? null : dayOf(fallbackDay))
  if (day === null) return null
  const agent = typeof payload.member === 'string' && payload.member.length > 0 ? payload.member : 'unknown'
  const model = typeof payload.model === 'string' ? payload.model : ''
  return { day, agent, model, promptTokens: num(payload.promptTokens), completionTokens: num(payload.completionTokens), stepCost: num(payload.stepCost) }
}

/**
 * One-shot backfill from the current list window into an empty counter table.
 * Guarded by the caller-visible rule: a non-empty table is never touched, so
 * a rerun can never double-count the increment-upsert rows. Anything already
 * aged out of the list window or the 300-event tail stays a floor — the
 * counter is exact from the migration forward.
 */
export async function backfillDailyCost(backend: SessionBackend): Promise<number> {
  if ((await backend.listDailyCost({})).length > 0) return 0
  const { sessions } = await backend.list({ limit: 500, offset: 0 })
  let written = 0
  for (const session of sessions) {
    for (const e of session.memberEvents ?? []) {
      const usage = costUsageOf(e, session.createdAt)
      if (!usage) continue
      await backend.recordCostUsage(usage)
      written += 1
    }
  }
  return written
}
