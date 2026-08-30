"use client";

import { useMemo, useState } from "react";
import type { BridgeEvent, Session } from "@/lib/types";
import { artifactsFor } from "@/lib/runProjection";
import { pairTools } from "@/lib/eventPairing";

export function SessionInspector({
  open,
  onClose,
  session,
  events,
}: {
  open: boolean;
  onClose: () => void;
  session: Session | null;
  events: BridgeEvent[];
}) {
  const [tab, setTab] = useState<"overview" | "reasoning" | "tools" | "decisions">("overview");
  const artifacts = useMemo(() => (session ? artifactsFor(session.correlationId, events) : null), [session, events]);

  if (!open) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[380px] flex-col border-l border-white/10 bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="text-xs uppercase tracking-widest text-muted">inspector</div>
        <button onClick={onClose} className="rounded px-2 py-1 text-sm text-muted hover:bg-raised">
          ✕
        </button>
      </div>
      {!session ? (
        <div className="p-4 text-sm text-muted">Select a node to see details.</div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-white/5 px-2 py-1">
            {(["overview", "reasoning", "tools", "decisions"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1.5 text-xs capitalize ${tab === t ? "bg-raised text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-4 text-sm">
            {tab === "overview" && (
              <div className="space-y-2">
                <div className="font-medium text-foreground">{session.task.prompt}</div>
                <div className="font-mono text-xs text-muted">{session.sessionId}</div>
                <div className="text-xs text-muted">status: {session.status} · {session.projectId ?? "no project"}</div>
                {session.output && <div className="rounded bg-raised p-2 text-xs whitespace-pre-wrap">{session.output}</div>}
                {session.error && <div className="rounded bg-danger/10 p-2 text-xs text-danger">{session.error}</div>}
              </div>
            )}
            {tab === "reasoning" && (
              <div className="space-y-2">
                {!artifacts || artifacts.reasoning.length === 0 ? (
                  <div className="text-xs text-muted">No reasoning yet — mediator has not streamed.</div>
                ) : (
                  artifacts.reasoning.map((e, i) => (
                    <div key={i} className="rounded border border-white/5 bg-raised/40 p-2">
                      <div className="text-[11px] text-muted">step {String((e as Record<string, unknown>).step ?? i)} · {String(e.member ?? "")}</div>
                      <div className="mt-1 text-xs leading-snug whitespace-pre-wrap">{String((e as Record<string, unknown>).content ?? (e as Record<string, unknown>).text ?? JSON.stringify(e))}</div>
                      {typeof (e as Record<string, unknown>).summary === "string" && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-accent">summary</summary>
                          <div className="mt-1 text-xs text-muted">{String((e as Record<string, unknown>).summary)}</div>
                        </details>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
            {tab === "tools" && (
              <div className="space-y-2">
                {pairTools(events.filter((e) => e.correlationId === session.correlationId)).length === 0 ? (
                  <div className="text-xs text-muted">No tool calls yet.</div>
                ) : (
                  pairTools(events.filter((e) => e.correlationId === session.correlationId)).map((p, i) => (
                    <div key={i} className="rounded border border-white/5 bg-raised/40 p-2">
                      <div className="text-xs font-medium text-foreground">{String(p.called.name ?? "tool")}</div>
                      <div className="text-[11px] text-muted">args: {JSON.stringify(p.called.args ?? p.called.arguments ?? "").slice(0, 200)}</div>
                      {p.result ? <div className="mt-1 text-xs whitespace-pre-wrap bg-ok/5 p-1.5 rounded">↳ {String((p.result as Record<string, unknown>).output ?? (p.result as Record<string, unknown>).result ?? JSON.stringify(p.result).slice(0, 300))}</div> : <div className="text-xs text-amber-300">running…</div>}
                    </div>
                  ))
                )}
              </div>
            )}
            {tab === "decisions" && (
              <div className="space-y-2">
                {!artifacts || artifacts.decisions.length === 0 ? <div className="text-xs text-muted">No decisions recorded.</div> : artifacts.decisions.map((e, i) => (
                  <div key={i} className="rounded border border-violet-500/20 bg-violet-500/10 p-2 text-xs">{JSON.stringify(e).slice(0, 300)}</div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
