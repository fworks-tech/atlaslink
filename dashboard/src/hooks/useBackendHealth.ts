"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type BackendHealth = "unknown" | "waking" | "healthy" | "down";

const HEALTH_PATH = "/api/health";
const TIMEOUT_MS = 7000;
const WAKING_INTERVAL_MS = 1500;
const HEALTHY_INTERVAL_MS = 15000;
const SLOW_THRESHOLD_MS = 2500;

export function useBackendHealth() {
  const [health, setHealth] = useState<BackendHealth>("unknown");
  const [attempt, setAttempt] = useState(0);
  const consecutiveFailures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);

  const check = useCallback(async () => {
    const start = performance.now();
    try {
      const res = await fetch(HEALTH_PATH, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const elapsed = performance.now() - start;
      if (cancelled.current) return;

      if (!res.ok) {
        // Render returns 502/503 while waking
        if ([502, 503, 504].includes(res.status)) {
          consecutiveFailures.current += 1;
          setAttempt((a) => a + 1);
          setHealth(consecutiveFailures.current >= 2 ? "down" : "waking");
        } else {
          consecutiveFailures.current += 1;
          setHealth("down");
        }
        return;
      }

      if (elapsed > SLOW_THRESHOLD_MS) {
        consecutiveFailures.current = 0;
        setHealth("waking");
        return;
      }

      consecutiveFailures.current = 0;
      setHealth("healthy");
    } catch (err) {
      if (cancelled.current) return;
      const isTimeout =
        err instanceof DOMException && err.name === "TimeoutError";
      consecutiveFailures.current += 1;
      setAttempt((a) => a + 1);
      // First timeout/network error is "waking" (cold start), second+ is "down"
      if (consecutiveFailures.current >= 2 || !isTimeout) {
        // keep "waking" for first timeout so message stays friendly
        setHealth(consecutiveFailures.current >= 3 ? "down" : "waking");
      } else {
        setHealth("waking");
      }
    }
  }, []);

  const schedule = useCallback(
    (nextHealth: BackendHealth) => {
      if (timer.current) clearTimeout(timer.current);
      const interval =
        nextHealth === "healthy" ? HEALTHY_INTERVAL_MS : WAKING_INTERVAL_MS;
      timer.current = setTimeout(async () => {
        if (cancelled.current) return;
        await check();
      }, interval);
    },
    [check],
  );

  // Drive polling loop off health changes
  useEffect(() => {
    schedule(health);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [health, schedule]);

  // Initial check
  useEffect(() => {
    cancelled.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check();
    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [check]);

  const retry = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    check();
  }, [check]);

  return { health, attempt, retry };
}
