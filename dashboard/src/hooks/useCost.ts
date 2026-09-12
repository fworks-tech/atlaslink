"use client";

import { useCallback, useEffect, useState } from "react";
import { getCost, type CostAgentRow } from "@/lib/api";

interface CostTotal {
  promptTokens: number;
  completionTokens: number;
  stepCost: number;
}

/**
 * Lifetime rollup from GET /cost. Same cold-start retry contract as
 * useSessions — shares the shape, not the fetcher.
 */
export function useCost() {
  const [breakdown, setBreakdown] = useState<CostAgentRow[]>([]);
  const [total, setTotal] = useState<CostTotal>({ promptTokens: 0, completionTokens: 0, stepCost: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; ; ++attempt) {
        try {
          const res = await getCost();
          if (cancelled) return;
          setBreakdown(res.breakdown);
          setTotal(res.total);
          setError(null);
          break;
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "failed to load cost data");
          const status = (err as { status?: number }).status;
          if (attempt >= 7 || ![404, 502, 503, 504].includes(status ?? 500)) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await getCost();
      setBreakdown(res.breakdown);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load cost data");
    }
  }, []);

  return { breakdown, total, loading, error, refresh };
}
