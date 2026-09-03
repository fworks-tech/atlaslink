"use client";

import { useMemo, useRef } from "react";
import type { BridgeEvent, Session } from "@/lib/types";
import { artifactsFor } from "@/lib/runProjection";
import { Markdown } from "@/components/Markdown";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SessionThread({ session, events, members, onJump }: { session: Session | null; events: BridgeEvent[]; members?: Array<{ name: string }>; onJump?: (nodeId: string) => void }) {
  const artifacts = useMemo(() => (session ? artifactsFor(session.correlationId, events) : null), [session, events]);
  const listRef = useRef<HTMLDivElement>(null);

  if (!session) return <div className="rounded-xl border border-white/5 bg-surface p-4 text-sm text-muted">Select a session to see its thread.</div>;

  const turns = [...(session.interaction ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const here = members ?? [];

  return (
    <div className="flex h-[480px] max-h-[60vh] min-h-[320px] flex-col overflow-hidden rounded-xl border border-white/5 bg-surface">
      <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted" title={here.map((m) => m.name).join(", ")}>
        thread · {session.sessionId.slice(0, 8)}…{here.length > 0 ? ` · ${here.length} here` : ""}
      </div>
      <div ref={listRef} className="flex-1 space-y-2 overflow-auto p-3">
        {turns.length === 0 && <div className="text-xs text-muted">No turns yet.</div>}
        {turns.map((t, i) => (
          <div key={i} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${t.role === "user" ? "bg-raised ml-auto" : t.role === "atlas" ? "bg-accent/10 border border-accent/30" : "bg-white/5"}`}>
            <div className="text-[10px] uppercase tracking-widest text-muted">{t.role}{t.member ? ` · ${t.member}` : ""}</div>
            <Markdown text={t.content} className="mt-1 text-sm leading-snug" />
          </div>
        ))}
        {artifacts && artifacts.reasoning.length > 0 && (
          <div className="pt-2">
            <div className="text-[10px] uppercase tracking-widest text-muted">reasoning stream</div>
            {artifacts.reasoning.slice(-6).map((e, i) => (
              <div key={i} className="mt-1 rounded bg-amber-500/10 p-2 text-xs">{String((e as Record<string, unknown>).content ?? (e as Record<string, unknown>).text ?? "").slice(0, 300)}</div>
            ))}
          </div>
        )}
      </div>
      {session.nextStep?.awaiting_input && (
        <div className="border-t border-accent/30 bg-accent/5 p-3 text-xs">
          <div className="font-medium text-accent">Atlas asks:</div>
          <div className="mt-1 text-foreground">{session.nextStep.prompt}</div>
        </div>
      )}
    </div>
  );
}
