"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CostRow {
  agent: string;
  promptTokens: number;
  completionTokens: number;
  stepCost: number;
  models: string[];
}

interface CostPayload {
  breakdown: CostRow[];
  total: { promptTokens: number; completionTokens: number; stepCost: number };
}

export default function CostPage() {
  const [data, setData] = useState<CostPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/cost", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        setData((await res.json()) as CostPayload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to load cost data");
      }
    })();
  }, []);

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
          Couldn&apos;t load cost data ({error}).
        </div>
      ) : !data ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <span className="rounded bg-raised px-2 py-1 text-muted">{data.total.promptTokens.toLocaleString()} in tok</span>
            <span className="rounded bg-raised px-2 py-1 text-muted">{data.total.completionTokens.toLocaleString()} out tok</span>
            <span className="rounded bg-accent/20 px-2 py-1 text-accent">${data.total.stepCost.toFixed(4)}</span>
          </div>
          {data.breakdown.length === 0 ? (
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
                {data.breakdown.map((row) => (
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
