"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCost } from "@/hooks/useCost";
import { useCostHistory } from "@/hooks/useCostHistory";
import type { CostBucket } from "@/lib/api";

// fixed categorical palette — agent color derives from a name hash so the
// legend never reshuffles between renders or window changes
const PALETTE = ["#7dd3fc", "#86efac", "#fcd34d", "#f0abfc", "#fda4af", "#93c5fd", "#5eead4", "#fdba74"];

function colorFor(agent: string): string {
  let h = 0;
  for (let i = 0; i < agent.length; i++) h = (h * 31 + agent.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function HistoryChart({ buckets }: { buckets: CostBucket[] }) {
  const max = Math.max(0, ...buckets.map((b) => b.stepCost));
  const agents = useMemo(() => {
    const totals = new Map<string, number>();
    for (const b of buckets) for (const a of b.agents) totals.set(a.agent, (totals.get(a.agent) ?? 0) + a.stepCost);
    return [...totals.entries()].sort(([, x], [, y]) => y - x);
  }, [buckets]);
  if (buckets.length === 0) {
    return <p className="mt-6 text-sm text-muted">No spend in this window yet — run a session with a provider that reports usage.</p>;
  }
  return (
    <section aria-label="Daily spend by agent" className="mt-6">
      <div role="img" aria-label={`Daily LLM spend, ${buckets.length} days, most recent total $${buckets[buckets.length - 1].stepCost.toFixed(4)}`} className="flex h-40 items-end gap-1 overflow-x-auto rounded-xl border border-white/5 bg-surface p-4">
        {buckets.map((b) => (
          <div key={b.day} title={`${b.day} — $${b.stepCost.toFixed(4)}`} className="flex min-w-[18px] flex-1 flex-col justify-end self-stretch">
            {b.agents.map((a) => (
              <div
                key={a.agent}
                style={{ height: `${max > 0 && a.stepCost > 0 ? Math.max(2, (a.stepCost / max) * 100) : 0}%`, backgroundColor: colorFor(a.agent) }}
                className="w-full first:rounded-t"
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{buckets[0].day}</span>
        <span>{buckets[buckets.length - 1].day}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-3 text-sm">
        {agents.map(([agent, cost]) => (
          <li key={agent} className="flex items-center gap-1.5 text-muted">
            <span aria-hidden="true" style={{ backgroundColor: colorFor(agent) }} className="inline-block h-2.5 w-2.5 rounded-sm" />
            {agent} <span className="text-accent">${cost.toFixed(4)}</span>
          </li>
        ))}
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
        <div role="alert" className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
          Couldn&apos;t load cost data ({error}).{" "}
          <button type="button" onClick={() => void refresh()} className="underline hover:text-red-200">Retry</button>
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
            <div role="alert" className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
              Couldn&apos;t load cost history ({history.error}).{" "}
              <button type="button" onClick={() => void history.refresh()} className="underline hover:text-red-200">Retry</button>
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
                  <tr key={row.agent} className="border-t border-white/10">
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
