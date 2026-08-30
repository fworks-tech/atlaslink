"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Returns `value` throttled to at most one update per `intervalMs`.
 * Leading edge fires immediately; trailing edge flushes the latest value
 * when the window ends. Keeps `withLiveUpdates` (O(n) over 200 buffered
 * SSE events) from running on every frame during bridge bursts.
 */
export function useThrottledValue<T>(value: T, intervalMs = 100): T {
  const [throttled, setThrottled] = useState(value);
  const last = useRef(value);
  const throttledRef = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    throttledRef.current = throttled;
  }, [throttled]);

  useEffect(() => {
    last.current = value;
    if (timer.current) return;
    // leading edge
    setThrottled(value);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (last.current !== throttledRef.current) setThrottled(last.current);
    }, intervalMs);
  }, [value, intervalMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return throttled;
}
