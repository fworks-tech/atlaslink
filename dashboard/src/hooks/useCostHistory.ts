"use client";

import { useCallback, useEffect, useState } from "react";
import { getCostHistory, type CostBucket } from "@/lib/api";

/**
 * Daily spend buckets from GET /cost/history. Same cold-start contract as
 * useSessions: the Render free tier answers wake-class failures while
 * spinning, so retry those instead of dead-ending on the first blip.
 */
export function useCostHistory() {
  const [buckets, setBuckets] = useState<CostBucket[]>([]);
  const [since, setSince] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; ; ++attempt) {
        try {
          const res = await getCostHistory();
          if (cancelled) return;
          setBuckets(res.buckets);
          setSince(res.since);
          setUntil(res.until);
          setError(null);
          break;
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "failed to load cost history");
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
      const res = await getCostHistory();
      setBuckets(res.buckets);
      setSince(res.since);
      setUntil(res.until);
      setError(null);
    } catch (err) {
      // keep the last good buckets — a failed poll must not blank the chart
      setError(err instanceof Error ? err.message : "failed to load cost history");
    }
  }, []);

  return { buckets, since, until, loading, error, refresh };
}
