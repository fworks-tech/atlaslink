"use client";

import { useEffect, useState } from "react";
import { getTasks } from "@/lib/api";
import type { Session } from "@/lib/types";

const POLL_MS = 15000;
const MAX_ROWS = 3;

function askOf(s: Session): string {
  return s.question?.question ?? s.nextStep?.prompt ?? s.task.prompt;
}

function waitedSince(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

// Approval inbox (#154): sessions parked in awaiting_input, longest-waiting
// first, so no HITL ask drowns in the per-session view. Polls because a new
// ask can arrive on any session, not just the selected one.
export function ApprovalInbox({ onSelect }: { onSelect: (sessionId: string) => void }) {
  const [waiting, setWaiting] = useState<Session[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      getTasks(50, 0, undefined, "awaiting_input")
        .then((res) => {
          if (!alive) return;
          setWaiting(
            [...res.sessions].sort((a, b) =>
              (a.createdAt ?? a.startedAt ?? "").localeCompare(b.createdAt ?? b.startedAt ?? "")
            )
          );
        })
        .catch(() => {
          // keep the last snapshot; the next tick retries — a failed poll
          // must not blank the inbox or spam the console every 15s
        });
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (waiting.length === 0) return null;
  const visible = waiting.slice(0, MAX_ROWS);

  return (
    <section
      aria-label={`Approval inbox — ${waiting.length} session${waiting.length === 1 ? "" : "s"} waiting`}
      className="overflow-hidden rounded-xl border border-accent/25 bg-accent/5"
    >
      <div className="flex items-center gap-2 border-b border-accent/15 px-4 py-2 text-xs uppercase tracking-widest text-accent">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        waiting for you · {waiting.length}
      </div>
      <ul className="divide-y divide-white/5">
        {visible.map((s) => (
          <li key={s.sessionId}>
            <button
              type="button"
              onClick={() => onSelect(s.sessionId)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/5"
            >
              <span className="shrink-0 rounded bg-raised px-2 py-0.5 text-[11px] text-muted">
                {s.nextStep?.member ?? s.task.member}
              </span>
              <span className="min-w-0 flex-1 truncate" title={askOf(s)}>
                {askOf(s)}
              </span>
              <span className="shrink-0 text-xs text-muted">waiting {waitedSince(s.createdAt ?? s.startedAt)}</span>
            </button>
          </li>
        ))}
        {waiting.length > MAX_ROWS && <li className="px-4 py-2 text-xs text-muted">+{waiting.length - MAX_ROWS} more</li>}
      </ul>
    </section>
  );
}
