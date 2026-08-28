"use client";

import { useMemo } from "react";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { StatusBadge } from "@/components/StatusBadge";
import type { Session, BridgeEvent } from "@/lib/types";

function toDate(at?: string): number {
  return at !== undefined ? Date.parse(at) : NaN;
}

/** What each terminal/in-flight lifecycle event means, as data — not an if-chain. */
const LIFECYCLE_TRANSITIONS: Record<string, (patch: Partial<Session>, event: BridgeEvent, current: Session) => void> = {
  "session.running": (patch, event, current) => {
    patch.status = "running";
    patch.startedAt = typeof event.at === "string" ? event.at : current.startedAt;
  },
  "session.succeeded": (patch, event, current) => {
    patch.status = "succeeded";
    patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
    patch.durationMs = typeof event.durationMs === "number" ? event.durationMs : current.durationMs;
    patch.output = typeof event.output === "string" ? event.output : current.output;
  },
  "session.failed": (patch, event, current) => {
    patch.status = "failed";
    patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
    patch.durationMs = typeof event.durationMs === "number" ? event.durationMs : current.durationMs;
    patch.error = typeof event.error === "string" ? event.error : current.error;
  },
  "session.cancelled": (patch, event, current) => {
    patch.status = "cancelled";
    patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
  },
};

function formatDuration(session: Session): string {
  if (session.durationMs !== undefined && session.status !== "running") {
    return `${(session.durationMs / 1000).toFixed(1)}s`;
  }
  if (session.status === "running") return "live…";
  return "—";
}

/** Overlay session.* lifecycle events onto the loaded list, in arrival order. */
export function withLiveUpdates(sessions: Session[], events: BridgeEvent[]): Session[] {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));

  for (const event of events) {
    const sessionId = event.sessionId;
    if (typeof sessionId !== "string") continue;

    // creation is not a patch — build the row when it first appears
    if (event.type === "session.created") {
      if (!byId.has(sessionId)) {
        byId.set(sessionId, {
          sessionId,
          correlationId: typeof event.correlationId === "string" ? event.correlationId : "",
          status: "queued",
          version: 0,
          task: {
            member: typeof event.member === "string" ? event.member : "unknown",
            prompt: typeof event.prompt === "string" ? event.prompt : "",
          },
          createdAt: typeof event.at === "string" ? event.at : undefined,
        });
      }
      continue;
    }

    const current = byId.get(sessionId);
    const transition = current === undefined ? undefined : LIFECYCLE_TRANSITIONS[event.type];
    if (current === undefined || transition === undefined) continue;

    const patch: Partial<Session> = {};
    transition(patch, event, current);
    byId.set(sessionId, { ...current, ...patch });
  }

  return [...byId.values()].sort(
    (a, b) => toDate(b.createdAt) - toDate(a.createdAt) || a.sessionId.localeCompare(b.sessionId),
  );
}

export function SessionList({ onSelect }: { onSelect?: (sessionId: string) => void }) {
  const { sessions, loading, error, refresh } = useSessions();
  const { events } = useEvents();
  const live = useMemo(() => withLiveUpdates(sessions, events), [sessions, events]);

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted">Loading sessions…</p>;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-danger">
        <p>{error}</p>
        <button onClick={() => void refresh()} className="mt-3 text-accent underline">
          retry
        </button>
      </div>
    );
  }

  if (live.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-surface/50 px-6 py-10 text-center">
        <p className="text-sm text-muted">
          No sessions yet. Start one above — e.g. “Fix issue #42 — login redirects to
          /dashboard” — and it appears here the moment it is created.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/5 text-xs uppercase tracking-widest text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">session</th>
            <th className="px-4 py-3 font-medium">member</th>
            <th className="px-4 py-3 font-medium">status</th>
            <th className="px-4 py-3 font-medium">created</th>
            <th className="px-4 py-3 font-medium">duration</th>
          </tr>
        </thead>
        <tbody>
          {live.map((session) => (
            <tr
              key={session.sessionId}
              onClick={onSelect ? () => onSelect(session.sessionId) : undefined}
              className={`border-b border-white/5 last:border-0 ${onSelect ? "cursor-pointer hover:bg-raised/60" : ""}`}
            >
              <td className="max-w-xs truncate px-4 py-3 pr-8">
                <div className="truncate text-foreground">{session.task.prompt}</div>
                <div className="mt-0.5 font-mono text-xs text-muted">{session.sessionId}</div>
              </td>
              <td className="px-4 py-3 text-foreground">{session.task.member}</td>
              <td className="px-4 py-3">
                <StatusBadge status={session.status} />
              </td>
              <td className="px-4 py-3 text-muted">
                {session.createdAt ? new Date(session.createdAt).toLocaleTimeString() : "—"}
              </td>
              <td className="px-4 py-3 text-muted">{formatDuration(session)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}