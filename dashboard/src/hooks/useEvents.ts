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
  "session.awaiting_input",
  "session.user_reply",
  "session.parked",
  "session.message",
  "session.steer",
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
const LAST_EVENT_ID_KEY = "atlaslink:lastEventId";

/**
 * Subscribes to the daemon's global SSE stream through the Next.js rewrite
 * (/api/events). Reconnection is managed manually so the state is observable:
 * onerror closes the stream, backs off exponentially with jitter (1s → 2s → 4s …
 * capped at 30s + random(0–1s)), and reconnects. The last received eventId is
 * persisted to sessionStorage so reconnections resume cleanly via
 * Last-Event-ID. `connection` drives the sidebar indicator.
 */
export function useEvents({ enabled = true }: { enabled?: boolean } = {}) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const lastEventId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const onFrame = (raw: string): void => {
      try {
        const event = JSON.parse(raw) as BridgeEvent;
        if ("eventId" in event && typeof event.eventId === "number") {
          lastEventId.current = String(event.eventId);
          try {
            sessionStorage.setItem(LAST_EVENT_ID_KEY, String(event.eventId));
          } catch {
            // sessionStorage unavailable (private mode) — resume still works via EventSource default
          }
        }
        setEvents((prev) => [...prev.slice(-(MAX_BUFFERED_EVENTS - 1)), event]);
      } catch {
        // comment frames (": keep-alive", ": ping") carry no data — not events
      }
    };

    const connect = (): void => {
      setConnection("connecting");
      const url = new URL("/api/events", window.location.origin);
      const savedId = lastEventId.current ?? sessionStorage.getItem(LAST_EVENT_ID_KEY);
      if (savedId) url.searchParams.set("lastEventId", savedId);
      const es = new EventSource(url.toString());
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
        const backoff = Math.min(RECONNECT_BASE_MS * 2 ** attempt.current, RECONNECT_MAX_MS);
        const jitter = Math.floor(Math.random() * 1000);
        attempt.current += 1;
        setConnection("disconnected");
        timer.current = setTimeout(connect, backoff + jitter);
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