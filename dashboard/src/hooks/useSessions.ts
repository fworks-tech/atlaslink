"use client";

import { useCallback, useEffect, useState } from "react";
import { getTasks } from "@/lib/api";
import type { Session } from "@/lib/types";

/**
 * Loads the session list from GET /tasks. One-shot for now; Branch 3 wires
 * live events into the result via useEvents.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getTasks();
        if (cancelled) return;
        setSessions(res.sessions);
        setTotal(res.total);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load sessions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const res = await getTasks();
    setSessions(res.sessions);
    setTotal(res.total);
    setError(null);
  }, []);

  return { sessions, total, loading, error, refresh };
}