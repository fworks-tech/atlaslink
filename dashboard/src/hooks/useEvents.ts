"use client";

import { useEffect, useRef, useState } from "react";
import type { BridgeEvent } from "@/lib/types";

export type ConnectionState = "connecting" | "connected" | "disconnected";

/** Event types the bridge emits; we register a listener per named type. */
const EVENT_TYPES = [
  "session.created",
  "session.running",
  "session.succeeded",
  "session.failed",
  "session.cancelled",
  "run.started",
  "run.finished",
  "run.failed",
  "reasoning",
  "tool.called",
  "tool.result",
  "decision.recorded",
  "provenance.recorded",
  "bridge.gap",
  "bridge.shutdown",
] as const;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_BUFFERED_EVENTS = 200;

/**
 * Subscribes to the daemon's global SSE stream through the Next.js rewrite
 * (/api/events). Reconnection is managed manually so the state is observable:
 * onerror closes the stream, backs off exponentially (1s → 2s → 4s … capped at
 * 30s), and reconnects. `connection` drives the sidebar indicator.
 */
export function useEvents({ enabled = true }: { enabled?: boolean } = {}) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const onFrame = (raw: string): void => {
      try {
        const event = JSON.parse(raw) as BridgeEvent;
        setEvents((prev) => [...prev.slice(-(MAX_BUFFERED_EVENTS - 1)), event]);
      } catch {
        // comment frames (": keep-alive", ": ping") carry no data — not events
      }
    };

    const connect = (): void => {
      setConnection("connecting");
      const es = new EventSource("/api/events");
      esRef.current = es;
      for (const type of EVENT_TYPES) es.addEventListener(type, (msg) => onFrame(msg.data));
      es.addEventListener("message", (msg) => onFrame(msg.data));
      es.onopen = () => {
        attempt.current = 0;
        setConnection("connected");
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (cancelled) return;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt.current, RECONNECT_MAX_MS);
        attempt.current += 1;
        setConnection("disconnected");
        timer.current = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [enabled]);

  return { connection, events };
}