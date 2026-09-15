"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { BridgeEvent } from "@/lib/types";

export type ReceiptState = "sending" | "sent" | "delivered" | "failed";

// A send the SSE stream never echoes stays "sent" past this age — the commit
// landed (HTTP 201) but observation lagged, so never fake "delivered".
const SETTLE_MS = 30_000;
// Per-tab memory only: enough for a session's recent sends, never a log.
const MAX_RECEIPTS = 20;

interface Receipt {
  key: string;
  sessionId: string;
  content: string;
  sentAt: number;
  state: "sending" | "sent" | "failed";
}

export interface ReceiptTurn {
  content: string;
  at?: string;
}

function eventContent(e: BridgeEvent): string | null {
  const content = e.reply ?? e.message;
  return typeof content === "string" ? content : null;
}

/**
 * Optimistic per-turn delivery receipts. The store gives turns no ids, so a
 * send is correlated by (session, exact content, turn at or after the send) —
 * oldest-first when identical contents repeat. Historical turns (sent before
 * page load) honestly show no tick: unknown, not delivered.
 */
export function useDeliveryReceipts(events: BridgeEvent[]) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const keyRef = useRef(0);

  const trackSend = useCallback((sessionId: string, content: string): string => {
    const key = `r${keyRef.current++}`;
    const receipt: Receipt = { key, sessionId, content, sentAt: Date.now(), state: "sending" };
    setReceipts((prev) => [...prev.slice(-(MAX_RECEIPTS - 1)), receipt]);
    return key;
  }, []);

  const settleSend = useCallback((key: string, ok: boolean): void => {
    setReceipts((prev) => prev.map((r) => (r.key === key ? { ...r, state: ok ? "sent" : "failed" } : r)));
  }, []);

  // Delivered echoes observed on the live stream, keyed by correlation with
  // their event times — a resend of identical content must wait for its own
  // echo, not inherit the previous send's delivery.
  const delivered = useMemo(() => {
    const seen = new Map<string, number[]>();
    for (const e of events) {
      if (e.type !== "session.user_reply" && e.type !== "session.steer" && e.type !== "session.message") continue;
      const content = eventContent(e);
      if (content === null || typeof e.correlationId !== "string") continue;
      const at = typeof e.at === "string" ? Date.parse(e.at) : Number.MAX_SAFE_INTEGER;
      const key = `${e.correlationId}::${content}`;
      const list = seen.get(key);
      if (list) list.push(at);
      else seen.set(key, [at]);
    }
    return seen;
  }, [events]);

  // Greedy oldest-first assignment over turns in render order — pure, so
  // re-renders assign identically and never consume a receipt twice.
  const assign = useCallback(
    (sessionId: string, correlationId: string, turns: ReceiptTurn[]): Map<number, ReceiptState> => {
      const assigned = new Map<number, ReceiptState>();
      const used = new Set<string>();
      const now = Date.now();
      turns.forEach((turn, index) => {
        const turnTime = turn.at ? Date.parse(turn.at) : Number.MAX_SAFE_INTEGER;
        const match = receipts
          .filter((r) => r.sessionId === sessionId && r.content === turn.content && !used.has(r.key) && r.sentAt <= turnTime)
          .sort((a, b) => a.sentAt - b.sentAt)[0];
        if (!match) return;
        used.add(match.key);
        const echoes = delivered.get(`${correlationId}::${match.content}`) ?? [];
        if (match.state === "failed") assigned.set(index, "failed");
        else if (echoes.some((t) => t >= match.sentAt)) assigned.set(index, "delivered");
        else if (now - match.sentAt > SETTLE_MS) assigned.set(index, "sent");
        else assigned.set(index, match.state);
      });
      return assigned;
    },
    [receipts, delivered]
  );

  return { trackSend, settleSend, assign };
}
