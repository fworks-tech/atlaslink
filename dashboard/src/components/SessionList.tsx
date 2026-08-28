"use client";

import { useMemo } from "react";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { StatusBadge } from "@/components/StatusBadge";
import type { Session, BridgeEvent } from "@/lib/types";

function toDate(at?: string): number {
  return at !== undefined ? Date.parse(at) : NaN;
}

/** Overlay session.* lifecycle events onto the loaded list, in arrival order. */
function withLiveUpdates(sessions: Session[], events: BridgeEvent[]): Session[] {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));

  for (const event of events) {
    const sessionId = event.sessionId;
    if (typeof sessionId !== "string") continue;

    const current = byId.get(sessionId);
    const patch: Partial<Session> = {};

    if (event.type === "session.created") {
      if (current === undefined) {
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

    if (current === undefined) continue;

    if (event.type === "session.running") {
      patch.status = "running";
      patch.startedAt = typeof event.at === "string" ? event.at : current.startedAt;
    } else if (event.type === "session.succeeded") {
      patch.status = "succeeded";
      patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
      patch.durationMs = typeof event.durationMs === "number" ? event.durationMs : current.durationMs;
      patch.output = typeof event.output === "string" ? event.output : current.output;
    } else if (event.type === "session.failed") {
      patch.status = "failed";
      patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
      patch.durationMs = typeof event.durationMs === "number" ? event.durationMs : current.durationMs;
      patch.error = typeof event.error === "string" ? event.error : current.error;
    } else if (event.type === "session.cancelled") {
      patch.status = "cancelled";
      patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
    }

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
              <td className="px-4 py-3 text-muted">
                {session.durationMs !== undefined && session.status !== "running"
                  ? `${(session.durationMs / 1000).toFixed(1)}s`
                  : session.status === "running"
                    ? "live…"
                    : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}