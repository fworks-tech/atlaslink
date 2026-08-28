"use client";

import { useMemo } from "react";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { StatusBadge } from "@/components/StatusBadge";
import { withLiveUpdates, formatDuration } from "@/lib/sessionProjection";

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