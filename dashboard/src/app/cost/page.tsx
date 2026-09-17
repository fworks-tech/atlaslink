"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCost } from "@/hooks/useCost";
import { useCostHistory } from "@/hooks/useCostHistory";
import type { CostBucket } from "@/lib/api";
import {
  aggregateBuckets,
  rankAgents,
  splitLegend,
  type CostGranularity,
} from "./aggregation";

// fixed categorical palette — visible agents take colors by rank (highest
// spend first) so the legend never reshuffles between renders or window
// changes; the last swatch is reserved for the "+N more" overflow segment
const PALETTE = ["#7dd3fc", "#86efac", "#fcd34d", "#f0abfc", "#fda4af", "#93c5fd", "#5eead4", "#fdba74"];
const OVERFLOW_COLOR = PALETTE[PALETTE.length - 1];

const GRANULARITIES: CostGranularity[] = ["daily", "weekly", "monthly"];

function HistoryChart({ buckets }: { buckets: CostBucket[] }) {
  const [granularity, setGranularity] = useState<CostGranularity>("daily");
  const aggregated = useMemo(() => aggregateBuckets(buckets, granularity), [buckets, granularity]);
  const ranked = useMemo(() => rankAgents(aggregated), [aggregated]);
  const { visible, overflow } = useMemo(() => splitLegend(ranked), [ranked]);
  const visibleSet = useMemo(() => new Set(visible.map(([agent]) => agent)), [visible]);
  const colorByAgent = useMemo(
    () => new Map(visible.map(([agent], i) => [agent, PALETTE[i % (PALETTE.length - 1)]] as const)),
    [visible],
  );
  const max = Math.max(0, ...aggregated.map((b) => b.stepCost));
  const label = granularity === "daily" ? "Daily" : granularity === "weekly" ? "Weekly" : "Monthly";
  const periodNoun = granularity === "daily" ? "days" : granularity === "weekly" ? "weeks" : "months";
  if (buckets.length === 0) {
    return <p className="mt-6 text-sm text-muted">No spend in this window yet — run a session with a provider that reports usage.</p>;
  }
  const last = aggregated[aggregated.length - 1];
  return (
    <section aria-label={`${label} spend by agent`} className="mt-6">
      <div role="group" aria-label="Granularity" className="mb-3 flex gap-2">
        {GRANULARITIES.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={granularity === g}
            onClick={() => setGranularity(g)}
            className={
              granularity === g
                ? "rounded bg-accent/20 px-2 py-1 text-sm text-accent"
                : "rounded bg-raised px-2 py-1 text-sm text-muted hover:text-foreground"
            }
          >
            {g === "daily" ? "Daily" : g === "weekly" ? "Weekly" : "Monthly"}
          </button>
        ))}
      </div>
      <div role="img" aria-label={`${label} LLM spend, ${aggregated.length} ${periodNoun}, most recent total $${last.stepCost.toFixed(4)}`} className="flex h-40 items-end gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-4">
        {aggregated.map((b) => {
          const byAgent = new Map(b.agents.map((a) => [a.agent, a.stepCost]));
          const overflowCost = b.agents
            .filter((a) => !visibleSet.has(a.agent))
            .reduce((sum, a) => sum + a.stepCost, 0);
          return (
            <div key={b.day} title={`${b.day} — $${b.stepCost.toFixed(4)}`} className="flex min-w-[18px] flex-1 flex-col justify-end self-stretch">
              {visible.map(([agent]) => {
                const cost = byAgent.get(agent) ?? 0;
                if (cost <= 0) return null;
                return (
                  <div
                    key={agent}
                    style={{ height: `${max > 0 ? Math.max(2, (cost / max) * 100) : 0}%`, backgroundColor: colorByAgent.get(agent) }}
                    className="w-full last:rounded-t"
                  />
                );
              })}
              {overflow && overflowCost > 0 ? (
                <div
                  style={{ height: `${max > 0 ? Math.max(2, (overflowCost / max) * 100) : 0}%`, backgroundColor: OVERFLOW_COLOR }}
                  className="w-full last:rounded-t"
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{aggregated[0].day}</span>
        <span>{last.day}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-3 text-sm">
        {visible.map(([agent, cost]) => (
          <li key={agent} className="flex items-center gap-1.5 text-muted">
            <span aria-hidden="true" style={{ backgroundColor: colorByAgent.get(agent) }} className="inline-block h-2.5 w-2.5 rounded-sm" />
            {agent} <span className="text-accent">${cost.toFixed(4)}</span>
          </li>
        ))}
        {overflow ? (
          <li className="flex items-center gap-1.5 text-muted">
            <span aria-hidden="true" style={{ backgroundColor: OVERFLOW_COLOR }} className="inline-block h-2.5 w-2.5 rounded-sm" />
            +{overflow.count} more <span className="text-accent">${overflow.cost.toFixed(4)}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export default function CostPage() {
  const { breakdown, total, loading, error, refresh } = useCost();
  const history = useCostHistory();

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cost</h1>
        <p className="mt-2 text-sm leading-6 text-muted">LLM spend rolled up per agent from durable reasoning events.</p>
      </header>
      <Link href="/" className="text-sm text-muted underline hover:text-foreground">
        ← Back to diagram
      </Link>
      {error ? (
        <div role="alert" className="mt-6 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          Couldn&apos;t load cost data ({error}).{" "}
          <button type="button" onClick={() => void refresh()} className="underline hover:text-danger">Retry</button>
        </div>
      ) : loading ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <span className="rounded bg-raised px-2 py-1 text-muted">{total.promptTokens.toLocaleString()} in tok</span>
            <span className="rounded bg-raised px-2 py-1 text-muted">{total.completionTokens.toLocaleString()} out tok</span>
            <span className="rounded bg-accent/20 px-2 py-1 text-accent">${total.stepCost.toFixed(4)}</span>
          </div>
          {history.error ? (
            <div role="alert" className="mt-6 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              Couldn&apos;t load cost history ({history.error}).{" "}
              <button type="button" onClick={() => void history.refresh()} className="underline hover:text-danger">Retry</button>
            </div>
          ) : history.loading ? (
            <p className="mt-6 text-sm text-muted">Loading history…</p>
          ) : (
            <HistoryChart buckets={history.buckets} />
          )}
          {breakdown.length === 0 ? (
            <p className="mt-6 text-sm text-muted">No token usage recorded yet — run a session with a provider that reports usage.</p>
          ) : (
            <table className="mt-6 w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2">Agent</th>
                  <th className="py-2">In&nbsp;tok</th>
                  <th className="py-2">Out&nbsp;tok</th>
                  <th className="py-2">Cost</th>
                  <th className="py-2">Models</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.agent} className="border-t border-line">
                    <td className="py-2 text-foreground">{row.agent}</td>
                    <td className="py-2 text-muted">{row.promptTokens.toLocaleString()}</td>
                    <td className="py-2 text-muted">{row.completionTokens.toLocaleString()}</td>
                    <td className="py-2 text-accent">${row.stepCost.toFixed(4)}</td>
                    <td className="py-2 text-muted">{row.models.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
