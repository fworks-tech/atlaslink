"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BridgeEvent, Session } from "@/lib/types";
import { artifactsFor } from "@/lib/runProjection";
import { pairTools } from "@/lib/eventPairing";
import { Markdown } from "@/components/Markdown";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SessionThread({ session, events, members, onJump }: { session: Session | null; events: BridgeEvent[]; members?: Array<{ name: string }>; onJump?: (nodeId: string) => void }) {
  const artifacts = useMemo(() => (session ? artifactsFor(session.correlationId, events) : null), [session, events]);
  const listRef = useRef<HTMLDivElement>(null);
  // stick-to-bottom chat behavior: follow new turns until the reader scrolls up
  const [atBottom, setAtBottom] = useState(true);
  const turnCount = session?.interaction?.length ?? 0;

  // a new session re-sticks to the bottom; derived during render (React's
  // "adjust state during render" pattern), not in an effect
  const [lastSid, setLastSid] = useState(session?.sessionId);
  if (session?.sessionId !== lastSid) {
    setLastSid(session?.sessionId);
    setAtBottom(true);
  }

  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [atBottom, turnCount, events.length]);

  if (!session) return <div className="rounded-xl border border-white/5 bg-surface p-4 text-sm text-muted">Select a session to see its thread.</div>;

  const turns = [...(session.interaction ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const here = members ?? [];

  return (
    <div className="relative flex h-[480px] max-h-[60vh] min-h-[320px] flex-col overflow-hidden rounded-xl border border-white/5 bg-surface">
      <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted" title={here.map((m) => m.name).join(", ")}>
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
        {turns.length === 0 && <div className="text-xs text-muted">No turns yet.</div>}
        {turns.map((t, i) => (
          <div key={i} className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-sm break-words ${t.role === "user" ? "bg-raised ml-auto" : t.role === "atlas" ? "bg-accent/10 border border-accent/30" : "bg-white/5"}`}>
            <div className="text-[10px] uppercase tracking-widest text-muted">{t.role}{t.member ? ` · ${t.member}` : ""}</div>
            <Markdown text={t.content} className="mt-1 text-sm leading-snug" />
          </div>
        ))}
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
                <div key={i} className="mt-1 truncate rounded bg-white/5 px-2 py-1 font-mono text-[11px] text-muted" title={String(p.called.name ?? "tool")}>
                  {p.result ? "✓" : "▸"} {String(p.called.name ?? "tool")}
                </div>
              ))}
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
