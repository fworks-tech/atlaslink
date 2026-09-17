"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BridgeEvent, Session } from "@/lib/types";
import type { ReceiptState } from "@/hooks/useDeliveryReceipts";
import { artifactsFor } from "@/lib/runProjection";
import { pairTools } from "@/lib/eventPairing";
import { Markdown } from "@/components/Markdown";

const TURN_WINDOW = 50;

const RECEIPT_TICK: Record<ReceiptState, string> = {
  sending: "…",
  sent: "✓",
  delivered: "✓✓",
  failed: "!",
};

const RECEIPT_LABEL: Record<ReceiptState, string> = {
  sending: "sending",
  sent: "sent",
  delivered: "delivered",
  failed: "failed to send",
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SessionThread({ session, events, members, onJump, assignReceipts }: { session: Session | null; events: BridgeEvent[]; members?: Array<{ name: string }>; onJump?: (nodeId: string) => void; assignReceipts?: (turns: Array<{ content: string; at?: string }>) => Map<number, ReceiptState> }) {
  const artifacts = useMemo(() => (session ? artifactsFor(session.correlationId, events) : null), [session, events]);
  const listRef = useRef<HTMLDivElement>(null);
  // stick-to-bottom chat behavior: follow new turns until the reader scrolls up
  const [atBottom, setAtBottom] = useState(true);
  const [shown, setShown] = useState(TURN_WINDOW);
  const turnCount = session?.interaction?.length ?? 0;

  // a new session re-sticks to the bottom; derived during render (React's
  // "adjust state during render" pattern), not in an effect
  const [lastSid, setLastSid] = useState(session?.sessionId);
  if (session?.sessionId !== lastSid) {
    setLastSid(session?.sessionId);
    setAtBottom(true);
    setShown(TURN_WINDOW);
  }

  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [atBottom, turnCount, events.length]);

  // growing the window prepends above the viewport — keep the visible turns
  // anchored instead of jumping up by the added height
  const prevHeight = useRef(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop += el.scrollHeight - prevHeight.current;
    prevHeight.current = el?.scrollHeight ?? 0;
  }, [shown]);

  // receipt ticks ride the visible turns in render order — the assignment is
  // greedy and pure, so re-renders never shift a tick onto another bubble.
  // lives above the early return: hook count must not depend on selection.
  const receipts = useMemo(() => {
    if (!session || !assignReceipts) return new Map<number, ReceiptState>();
    const visible = [...(session.interaction ?? [])]
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .slice(-shown);
    return assignReceipts(visible.map((t) => ({ content: String(t.content ?? ""), ...(t.at ? { at: String(t.at) } : {}) })));
  }, [session, assignReceipts, shown]);

  if (!session) return <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">Select a session to see its thread.</div>;

  const allTurns = [...(session.interaction ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const turns = allTurns.slice(-shown);
  const earlier = allTurns.length - turns.length;
  const here = members ?? [];

  return (
    <div className="relative flex h-[480px] max-h-[60vh] min-h-[320px] flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-3 py-2 text-xs uppercase tracking-widest text-muted" title={here.map((m) => m.name).join(", ")}>
        thread · {session.sessionId.slice(0, 8)}…{here.length > 0 ? ` · ${here.length} here` : ""}
      </div>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
        }}
        className="flex-1 space-y-2 overflow-auto overscroll-contain p-3"
      >
        {earlier > 0 && (
          <button
            type="button"
            onClick={() => setShown((s) => s + TURN_WINDOW)}
            className="sticky top-0 z-10 mx-auto block w-full rounded-lg bg-surface/95 px-2 py-1 text-[11px] text-muted backdrop-blur hover:text-foreground"
          >
            ↑ {earlier} earlier turn{earlier > 1 ? "s" : ""} — show {Math.min(TURN_WINDOW, earlier)} more
          </button>
        )}
        {turns.length === 0 && <div className="text-xs text-muted">No turns yet.</div>}
        {turns.map((t, i) => {
          const receipt = t.role === "user" ? receipts.get(i) : undefined;
          return (
            <div key={i} data-testid="turn" className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-sm break-words ${t.role === "user" ? "bg-raised ml-auto" : t.role === "atlas" ? "bg-accent/10 border border-accent/30" : "bg-line"}`}>
              <div className="text-[10px] uppercase tracking-widest text-muted">{t.role}{t.member ? ` · ${t.member}` : ""}{t.at && <span className="font-normal lowercase tracking-normal"> · {new Date(t.at).toLocaleTimeString()}</span>}</div>
              <Markdown text={t.content} className="mt-1 text-sm leading-snug" />
              {receipt ? (
                <div className={`mt-1 text-right text-[11px] ${receipt === "failed" ? "text-danger" : "text-muted"}`}>
                  <span aria-label={`message ${RECEIPT_LABEL[receipt]}`}>{RECEIPT_TICK[receipt]}</span>
                </div>
              ) : null}
            </div>
          );
        })}
        {artifacts && artifacts.reasoning.length > 0 && (
          <div className="pt-2">
            <div className="text-[10px] uppercase tracking-widest text-muted">reasoning stream</div>
            {artifacts.reasoning.slice(-6).map((e, i) => (
              <div key={i} className="mt-1 rounded bg-amber-500/10 p-2 text-xs min-w-0">
                <Markdown text={String((e as Record<string, unknown>).content ?? (e as Record<string, unknown>).text ?? "")} />
              </div>
            ))}
          </div>
        )}
        {(() => {
          const toolPairs = pairTools(events.filter((e) => e.correlationId === session.correlationId)).slice(-4);
          return toolPairs.length > 0 ? (
            <div className="pt-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">live activity</div>
              {toolPairs.map((p, i) => (
                <div key={i} className="mt-1 truncate rounded bg-line px-2 py-1 font-mono text-[11px] text-muted" title={String(p.called.name ?? "tool")}>
                  {p.result ? "✓" : "▸"} {String(p.called.name ?? "tool")}
                </div>
              ))}
            </div>
          ) : null;
        })()}
        {(() => {
          const runFailure = events.find((e) => e.type === "run.failed" && e.correlationId === session.correlationId);
          const errorText = typeof runFailure?.error === "string" ? runFailure.error : session.status === "failed" ? session.error : undefined;
          return errorText ? (
            <div role="alert" className="mt-2 rounded bg-danger/10 px-3 py-2 text-sm text-danger">
              <div className="text-[10px] uppercase tracking-widest">failed</div>
              <div className="mt-1 break-words">{errorText}</div>
            </div>
          ) : null;
        })()}
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => {
            const el = listRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            setAtBottom(true);
          }}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-accent/40 bg-surface/90 px-3 py-1 text-xs text-accent shadow-lg backdrop-blur hover:bg-accent/10"
        >
          ↓ jump to latest
        </button>
      )}
      {session.nextStep?.awaiting_input && (
        <div className="max-h-32 overflow-auto border-t border-accent/30 bg-accent/5 p-3 text-xs">
          <div className="font-medium text-accent">Atlas asks:</div>
          <div className="mt-1 text-foreground break-words">{session.nextStep.prompt}</div>
        </div>
      )}
    </div>
  );
}
