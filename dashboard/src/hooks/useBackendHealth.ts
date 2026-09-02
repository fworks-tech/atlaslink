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
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const healthRef = useRef<BackendHealth>("unknown");
  const wasHealthy = useRef(false);

  useEffect(() => {
    healthRef.current = health;
  }, [health]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- check is stable (refs only)
  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const start = performance.now();
    try {
      const res = await fetch(HEALTH_PATH, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const elapsed = performance.now() - start;
      if (cancelled.current) return;

      if (!res.ok) {
        consecutiveFailures.current += 1;
        setAttempt((a) => a + 1);
        if ([502, 503, 504].includes(res.status)) {
          setHealth(consecutiveFailures.current >= 3 ? "down" : "waking");
        } else {
          setHealth("down");
        }
        return;
      }

      // Only treat slowness as waking if we were not already healthy
      // (avoids false overlay on a loaded-but-healthy backend)
      if (elapsed > SLOW_THRESHOLD_MS && !wasHealthy.current) {
        consecutiveFailures.current = 0;
        setHealth("waking");
        return;
      }

      consecutiveFailures.current = 0;
      wasHealthy.current = true;
      setAttempt(0);
      setHealth("healthy");
    } catch (err) {
      if (cancelled.current) return;
      const isAbort =
        err instanceof DOMException &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      // isAbort is kept for future severity tuning; currently all failures
      // escalate the same (waking for first 2, down at 3+) — see review #6
      void isAbort;
      consecutiveFailures.current += 1;
      setAttempt((a) => a + 1);
      setHealth(consecutiveFailures.current >= 3 ? "down" : "waking");
    } finally {
      inFlight.current = false;
      if (!cancelled.current) {
        const next = healthRef.current;
        const interval = next === "healthy" ? HEALTHY_INTERVAL_MS : WAKING_INTERVAL_MS;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void check(), interval);
      }
    }
  }, []);

  // Single polling loop: initial check + interval driven from check() finally
  useEffect(() => {
    cancelled.current = false;
    void check();
    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [check]);

  const retry = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setHealth("waking");
    void check();
  }, [check]);

  return { health, attempt, retry };
}
