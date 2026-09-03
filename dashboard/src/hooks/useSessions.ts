"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, getTasks } from "@/lib/api";
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
  // mirror for decisions that must read the list synchronously — updaters
  // run during render, so a flag set inside one is unreadable right after
  const sessionsRef = useRef<Session[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

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
    try {
      const res = await getTasks();
      setSessions(res.sessions);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      // keep the last good list — a failed poll must not blank the UI or
      // reject into a send flow that already succeeded
      setError(err instanceof Error ? err.message : "failed to load sessions");
    }
  }, []);

  // Deep-link hydration: the list is a one-shot page (limit 50), so a shared
  // ?session= id may be missing until a manual action triggers refresh.
  // Fetch the single row and merge it instead of leaving the selection null.
  const hydrateSession = useCallback(async (sessionId: string): Promise<Session> => {
    try {
      const res = await getSession(sessionId);
      const isNew = !sessionsRef.current.some((s) => s.sessionId === sessionId);
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.sessionId === sessionId);
        if (idx === -1) return [...prev, res.session];
        const next = [...prev];
        next[idx] = res.session;
        return next;
      });
      // an appended row was never counted by the server page
      if (isNew) setTotal((t) => t + 1);
      setError(null);
      return res.session;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load session");
      throw err;
    }
  }, []);

  return { sessions, total, loading, error, refresh, hydrateSession };
}