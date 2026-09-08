"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BridgeEvent, Session } from "@/lib/types";
import { artifactsFor } from "@/lib/runProjection";
import { pairTools } from "@/lib/eventPairing";
import { Markdown } from "@/components/Markdown";
import { NodeConfigPanel } from "@/components/NodeConfigPanel";
import { DEFAULT_CONFIG, isAgentConfig, tweaksToConfig, type AgentConfig } from "@/lib/config";

export interface SelectedNode {
  id: string;
  type: string;
  data: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

// Shows agent config for member/session nodes. Draft nodes (composer overlay)
// get an editable panel wired to onConfigChange; live nodes show read-only
// values derived from the session's tweaks.
function ConfigSection({
  node,
  session,
  onConfigChange,
}: {
  node: SelectedNode;
  session: Session | null;
  onConfigChange?: (nodeId: string, config: AgentConfig) => void;
}) {
  const data = asRecord(node.data);
  const isDraft = Boolean(data.draft) || node.id.startsWith("draft-");

  let config: AgentConfig;
  if (isDraft) {
    config = isAgentConfig(data.config) ? (data.config as AgentConfig) : DEFAULT_CONFIG;
  } else {
    config = tweaksToConfig(session?.tweaks);
  }

  if (isDraft) {
    return (
      <div className="mt-2 border-t border-white/5 pt-2">
        <div className="mb-1 text-[11px] uppercase tracking-widest text-muted">config</div>
        <NodeConfigPanel
          config={config}
          editable={true}
          onChange={(next) => onConfigChange?.(node.id, next)}
        />
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-white/5 pt-2">
      <div className="mb-1 text-[11px] uppercase tracking-widest text-muted">config</div>
      <NodeConfigPanel config={config} editable={false} onChange={() => {}} />
    </div>
  );
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function Clamped({ text, max, className }: { text: string; max: number; className?: string }) {
  const cut = text.length > max;
  return <div className={className} title={cut ? text : undefined}>{cut ? `${text.slice(0, max)}…` : text}</div>;
}

type InspectorTab = "overview" | "reasoning" | "tools" | "decisions";

function tabForNodeType(type: string): InspectorTab {
  if (type === "reasoning") return "reasoning";
  if (type === "tool") return "tools";
  if (type === "decision") return "decisions";
  return "overview";
}

function NodeDetail({
  node,
  session,
  onConfigChange,
}: {
  node: SelectedNode;
  session: Session | null;
  onConfigChange?: (nodeId: string, config: AgentConfig) => void;
}) {
  const d = asRecord(node.data);
  if (node.type === "reasoning") {
    const events = Array.isArray(d.events) ? (d.events as BridgeEvent[]) : [];
    const first = events[0] ? asRecord(events[0]) : {};
    const content = str(first.content, str(first.text, "reasoning"));
    const summary = str(first.summary);
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-muted">step {String(d.step ?? first.step ?? 0)} · {str(d.sessionId).slice(0, 14)}…</div>
        <Markdown text={content} className="rounded bg-raised p-2 text-xs leading-snug" />
        {summary && <Clamped text={`↳ ${summary}`} max={500} className="text-xs text-muted" />}
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
        <Clamped text={`args: ${JSON.stringify(called.args ?? called.arguments ?? "")}`} max={500} className="text-[11px] break-words text-muted" />
        {result ? (
          <Markdown text={str(result.output, str(result.result, JSON.stringify(result)))} className="mt-1 rounded bg-ok/5 p-1.5 text-xs" />
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
        <Markdown text={outcome} className="rounded border border-violet-500/20 bg-violet-500/10 p-2 text-xs" />
      </div>
    );
  }
  if (node.type === "member") {
    const d = asRecord(node.data);
    return (
      <div className="space-y-1 text-xs">
        <div className="font-medium text-foreground">{str(d.member, node.id)}</div>
        <div className="text-muted">session: {str(d.sessionId).slice(0, 20)}…</div>
        <div className="text-muted">status: {d.active ? "active · holds the podium" : "completed"}</div>
        <ConfigSection node={node} session={session} onConfigChange={onConfigChange} />
      </div>
    );
  }
  if (node.type === "session" || node.type === "awaiting" || node.type === "terminal") {
    const nodeSession = asRecord(d.session);
    const task = asRecord(nodeSession.task);
    return (
      <div className="space-y-1 text-xs">
        <Clamped text={str(task.prompt, node.id)} max={500} className="font-medium text-foreground break-words" />
        <div className="text-muted">status: {str(nodeSession.status, "")}</div>
        <ConfigSection node={node} session={session} onConfigChange={onConfigChange} />
      </div>
    );
  }
  return <Clamped text={JSON.stringify(node.data ?? {})} max={500} className="rounded bg-raised p-2 font-mono text-[11px] break-words whitespace-pre-wrap" />;
}

export function SessionInspector({
  open,
  onClose,
  session,
  events,
  selectedNode = null,
  contextLoading = false,
  onConfigChange,
}: {
  open: boolean;
  onClose: () => void;
  session: Session | null;
  events: BridgeEvent[];
  selectedNode?: SelectedNode | null;
  contextLoading?: boolean;
  onConfigChange?: (nodeId: string, config: AgentConfig) => void;
}) {
  const [tab, setTab] = useState<InspectorTab>("overview");
  const panelRef = useRef<HTMLDivElement>(null);
  const [lastAutoId, setLastAutoId] = useState<string | null>(null);
  const artifacts = useMemo(() => (session ? artifactsFor(session.correlationId, events) : null), [session, events]);

  // Auto-select the relevant tab on a new node selection; manual choices win
  // until the next selection. Derived during render (React's
  // "adjust state during render" pattern) — deliberately not in an effect so
  // no cascading render occurs. Clearing the selection resets the latch so
  // reopening the same node auto-switches again.
  if (!selectedNode) {
    if (lastAutoId !== null) {
      setLastAutoId(null);
    }
  } else if (selectedNode.id !== lastAutoId) {
    setLastAutoId(selectedNode.id);
    setTab(tabForNodeType(selectedNode.type));
  }
  const counts: Record<InspectorTab, number | null> = {
    overview: null,
    reasoning: artifacts ? artifacts.reasoning.length : null,
    tools: session ? pairTools(events.filter((e) => e.correlationId === session.correlationId)).length : null,
    decisions: artifacts ? artifacts.decisions.length : null,
  };
  const activeTab = tab;
  const handleTab = (t: InspectorTab) => {
    setTab(t);
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Session inspector"
      className="fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-[90vw] flex-col border-l border-white/10 bg-surface shadow-2xl outline-none"
    >
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
              <section aria-label="Selected node payload" className="mt-2 max-h-[45vh] min-h-0 overflow-y-auto">
                <NodeDetail node={selectedNode} session={session} onConfigChange={onConfigChange} />
              </section>
            </div>
          )}
          {!session ? (
            <div className="p-4 text-xs text-muted">{contextLoading ? "Loading session context…" : "Session context not loaded yet — node payload shown above."}</div>
          ) : (
          <>
          <div className="flex gap-1 border-b border-white/5 px-2 py-1">
            {(["overview", "reasoning", "tools", "decisions"] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleTab(t)}
                className={`rounded px-3 py-1.5 text-xs capitalize ${activeTab === t ? "bg-raised text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {t}
                {counts[t] ? <span className="ml-1 rounded-full bg-accent/20 px-1.5 text-[10px] text-accent">{counts[t]}</span> : null}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-4 text-sm">
            {activeTab === "overview" && (
              <div className="space-y-2">
                <div className="font-medium text-foreground break-words">{session.task.prompt}</div>
                <div className="font-mono text-xs text-muted break-all">{session.sessionId}</div>
                <div className="text-xs text-muted">status: {session.status} · {session.projectId ?? "no project"}</div>
                {session.output && <Markdown text={session.output} className="rounded bg-raised p-2 text-xs" />}
                {session.error && <div className="rounded bg-danger/10 p-2 text-xs text-danger">{session.error}</div>}
              </div>
            )}
            {activeTab === "reasoning" && (
              <div className="space-y-2">
                {!artifacts || artifacts.reasoning.length === 0 ? (
                  <div className="text-xs text-muted">No reasoning yet — mediator has not streamed.</div>
                ) : (
                  artifacts.reasoning.map((e, i) => (
                    <div key={i} className="rounded border border-white/5 bg-raised/40 p-2">
                      <div className="text-[11px] text-muted">step {String((e as Record<string, unknown>).step ?? i)} · {String(e.member ?? "")}</div>
                      <Markdown text={String((e as Record<string, unknown>).content ?? (e as Record<string, unknown>).text ?? JSON.stringify(e))} className="mt-1 text-xs leading-snug" />
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
            {activeTab === "tools" && (
              <div className="space-y-2">
                {pairTools(events.filter((e) => e.correlationId === session.correlationId)).length === 0 ? (
                  <div className="text-xs text-muted">No tool calls yet.</div>
                ) : (
                  pairTools(events.filter((e) => e.correlationId === session.correlationId)).map((p, i) => (
                    <div key={i} className="rounded border border-white/5 bg-raised/40 p-2">
                      <div className="text-xs font-medium text-foreground">{String(p.called.name ?? "tool")}</div>
                      <Clamped text={`args: ${JSON.stringify(p.called.args ?? p.called.arguments ?? "")}`} max={200} className="text-[11px] break-words text-muted" />
                      {p.result ? <Markdown text={String((p.result as Record<string, unknown>).output ?? (p.result as Record<string, unknown>).result ?? JSON.stringify(p.result))} className="mt-1 rounded bg-ok/5 p-1.5 text-xs" /> : <div className="text-xs text-amber-300">running…</div>}
                    </div>
                  ))
                )}
              </div>
            )}
            {activeTab === "decisions" && (
              <div className="space-y-2">
                {!artifacts || artifacts.decisions.length === 0 ? <div className="text-xs text-muted">No decisions recorded.</div> : artifacts.decisions.map((e, i) => (
                  <Clamped key={i} text={JSON.stringify(e)} max={300} className="rounded border border-violet-500/20 bg-violet-500/10 p-2 text-xs break-words" />
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
