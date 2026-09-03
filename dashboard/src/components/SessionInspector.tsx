"use client";

import { useMemo, useState } from "react";
import type { BridgeEvent, Session } from "@/lib/types";
import { artifactsFor } from "@/lib/runProjection";
import { pairTools } from "@/lib/eventPairing";

export interface SelectedNode {
  id: string;
  type: string;
  data: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function NodeDetail({ node }: { node: SelectedNode }) {
  const d = asRecord(node.data);
  if (node.type === "reasoning") {
    const events = Array.isArray(d.events) ? (d.events as BridgeEvent[]) : [];
    const first = events[0] ? asRecord(events[0]) : {};
    const content = str(first.content, str(first.text, "reasoning"));
    const summary = str(first.summary);
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-muted">step {String(d.step ?? first.step ?? 0)} · {str(d.sessionId).slice(0, 14)}…</div>
        <div className="rounded bg-raised p-2 text-xs leading-snug whitespace-pre-wrap">{content.slice(0, 2000)}</div>
        {summary && <div className="text-xs text-muted">↳ {summary.slice(0, 500)}</div>}
        {events.length > 1 && <div className="text-[11px] text-muted">+{events.length - 1} more event(s) in this step</div>}
      </div>
    );
  }
  if (node.type === "tool") {
    const pair = asRecord(d.pair);
    const called = asRecord(pair.called);
    const result = pair.result ? asRecord(pair.result) : null;
    return (
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-foreground">{str(called.name, "tool")}</div>
        <div className="text-[11px] text-muted">args: {JSON.stringify(called.args ?? called.arguments ?? "").slice(0, 500)}</div>
        {result ? (
          <div className="mt-1 rounded bg-ok/5 p-1.5 text-xs whitespace-pre-wrap">↳ {str(result.output, str(result.result, JSON.stringify(result).slice(0, 500)))}</div>
        ) : (
          <div className="text-xs text-amber-300">running…</div>
        )}
      </div>
    );
  }
  if (node.type === "decision") {
    const event = asRecord(d.event);
    const outcome = str(event.outcome, JSON.stringify(d.event ?? {}).slice(0, 300));
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-muted">decision · {str(event.decisionId, str(d.sessionId, "")).slice(0, 40)}</div>
        <div className="rounded border border-violet-500/20 bg-violet-500/10 p-2 text-xs whitespace-pre-wrap">{outcome.slice(0, 1000)}</div>
      </div>
    );
  }
  if (node.type === "member") {
    return (
      <div className="space-y-1 text-xs">
        <div className="font-medium text-foreground">{str(d.member, node.id)}</div>
        <div className="text-muted">session: {str(d.sessionId).slice(0, 20)}…</div>
        <div className="text-muted">status: {d.active ? "active · holds the podium" : "completed"}</div>
      </div>
    );
  }
  if (node.type === "session" || node.type === "awaiting" || node.type === "terminal") {
    const session = asRecord(d.session);
    const task = asRecord(session.task);
    return (
      <div className="space-y-1 text-xs">
        <div className="font-medium text-foreground">{str(task.prompt, node.id).slice(0, 500)}</div>
        <div className="text-muted">status: {str(session.status, "")}</div>
      </div>
    );
  }
  return <div className="rounded bg-raised p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(node.data ?? {}).slice(0, 500)}</div>;
}

export function SessionInspector({
  open,
  onClose,
  session,
  events,
  selectedNode = null,
}: {
  open: boolean;
  onClose: () => void;
  session: Session | null;
  events: BridgeEvent[];
  selectedNode?: SelectedNode | null;
}) {
  const [tab, setTab] = useState<"overview" | "reasoning" | "tools" | "decisions">("overview");
  const [lastAutoId, setLastAutoId] = useState<string | null>(null);
  const artifacts = useMemo(() => (session ? artifactsFor(session.correlationId, events) : null), [session, events]);

  // Auto-select the relevant tab when a new node is clicked; manual tab
  // switches are preserved until the next node selection (render-phase
  // derived state, intentionally not in an effect).
  if (selectedNode && selectedNode.id !== lastAutoId) {
    setLastAutoId(selectedNode.id);
    if (selectedNode.type === "reasoning") setTab("reasoning");
    else if (selectedNode.type === "tool") setTab("tools");
    else if (selectedNode.type === "decision") setTab("decisions");
    else setTab("overview");
  }

  if (!open) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[380px] flex-col border-l border-white/10 bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="text-xs uppercase tracking-widest text-muted">inspector</div>
        <button onClick={onClose} className="rounded px-2 py-1 text-sm text-muted hover:bg-raised">
          ✕
        </button>
      </div>
      {!session && !selectedNode ? (
        <div className="p-4 text-sm text-muted">Select a node to see details.</div>
      ) : (
        <>
          {selectedNode && (
            <div className="border-b border-white/5 bg-raised/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-widest text-muted">selected node</span>
                <span className="rounded bg-accent/20 px-1.5 py-0.5 font-mono text-[11px] text-accent">{selectedNode.type}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] break-all text-muted">{selectedNode.id}</div>
              <div className="mt-2">
                <NodeDetail node={selectedNode} />
              </div>
            </div>
          )}
          {!session ? (
            <div className="p-4 text-xs text-muted">Session context not loaded yet — node payload shown above.</div>
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
        </>
      )}
    </div>
  );
}
