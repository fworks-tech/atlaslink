import type { CostBucket } from "@/lib/api";

export type CostGranularity = "daily" | "weekly" | "monthly";

export const MAX_LEGEND_AGENTS = 7;

/**
 * Monday (ISO week start) for a YYYY-MM-DD day, computed in UTC so the
 * bucket a day lands in never shifts with the viewer's timezone.
 */
export function weekStartOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

/** Calendar-month label for a YYYY-MM-DD day, as the month-start date. */
export function monthStartOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

interface AgentAcc {
  promptTokens: number;
  completionTokens: number;
  stepCost: number;
  models: Set<string>;
}

function emptyBucket(day: string): { bucket: CostBucket; acc: Map<string, AgentAcc> } {
  return {
    bucket: { day, promptTokens: 0, completionTokens: 0, stepCost: 0, agents: [] },
    acc: new Map(),
  };
}

function finalize(entry: { bucket: CostBucket; acc: Map<string, AgentAcc> }): CostBucket {
  const { bucket, acc } = entry;
  bucket.agents = [...acc.entries()]
    .map(([agent, a]) => ({
      agent,
      promptTokens: a.promptTokens,
      completionTokens: a.completionTokens,
      stepCost: a.stepCost,
      models: [...a.models].sort(),
    }))
    .sort((x, y) => y.stepCost - x.stepCost || x.agent.localeCompare(y.agent));
  return bucket;
}

/**
 * Roll already-fetched daily buckets up to weekly (ISO weeks starting
 * Monday, labeled by week-start date) or calendar months (labeled by
 * month-start date). Pure: never mutates the input, output sorted by day.
 */
export function aggregateBuckets(buckets: CostBucket[], granularity: CostGranularity): CostBucket[] {
  const sorted = [...buckets].sort((a, b) => a.day.localeCompare(b.day));
  if (granularity === "daily") return sorted.map((b) => ({ ...b, agents: [...b.agents] }));
  const keyOf = granularity === "weekly" ? weekStartOf : monthStartOf;
  const groups = new Map<string, { bucket: CostBucket; acc: Map<string, AgentAcc> }>();
  for (const b of sorted) {
    const key = keyOf(b.day);
    let entry = groups.get(key);
    if (!entry) {
      entry = emptyBucket(key);
      groups.set(key, entry);
    }
    entry.bucket.promptTokens += b.promptTokens;
    entry.bucket.completionTokens += b.completionTokens;
    entry.bucket.stepCost += b.stepCost;
    for (const a of b.agents) {
      let agent = entry.acc.get(a.agent);
      if (!agent) {
        agent = { promptTokens: 0, completionTokens: 0, stepCost: 0, models: new Set() };
        entry.acc.set(a.agent, agent);
      }
      agent.promptTokens += a.promptTokens;
      agent.completionTokens += a.completionTokens;
      agent.stepCost += a.stepCost;
      for (const m of a.models) agent.models.add(m);
    }
  }
  return [...groups.values()].map(finalize).sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Total stepCost per agent across the (already aggregated) buckets, highest
 * first. Name tie-break keeps colors and legend order stable between renders.
 */
export function rankAgents(buckets: CostBucket[]): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const b of buckets) {
    for (const a of b.agents) totals.set(a.agent, (totals.get(a.agent) ?? 0) + a.stepCost);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export interface LegendSplit {
  visible: Array<[string, number]>;
  overflow: { count: number; cost: number } | null;
}

/** Cap the legend at the top N agents; the rest fold into one overflow row. */
export function splitLegend(
  ranked: Array<[string, number]>,
  limit: number = MAX_LEGEND_AGENTS,
): LegendSplit {
  const visible = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  if (rest.length === 0) return { visible, overflow: null };
  return {
    visible,
    overflow: { count: rest.length, cost: rest.reduce((sum, [, cost]) => sum + cost, 0) },
  };
}
