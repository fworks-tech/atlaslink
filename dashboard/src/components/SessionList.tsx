"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { StatusBadge } from "@/components/StatusBadge";
import { withLiveUpdates, formatDuration } from "@/lib/sessionProjection";

export const ROW_HEIGHT = 57;
export const OVERSCAN = 5;
export const VIRTUALIZE_AT = 30;

export function SessionList({ onSelect }: { onSelect?: (sessionId: string) => void }) {
  const { sessions, loading, error, refresh } = useSessions();
  const { events } = useEvents();
  const throttledEvents = useThrottledValue(events, 100);
  const live = useMemo(() => withLiveUpdates(sessions, throttledEvents), [sessions, throttledEvents]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(420);

  const onScroll = useCallback(() => {
    if (scrollerRef.current) setScrollTop(scrollerRef.current.scrollTop);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    setContainerHeight(el.clientHeight || 420);
    return () => ro.disconnect();
  }, [live.length]);

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-white/5 bg-surface" aria-busy="true" aria-label="Loading sessions">
        <div className="border-b border-white/5 px-4 py-3">
          <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
        </div>
        <div className="divide-y divide-white/5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
              <div className="ml-auto h-5 w-16 animate-pulse rounded-full bg-white/5" />
            </div>
          ))}
        </div>
      </div>
    );
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

  // Non-virtual path for small lists keeps the table simple and test-friendly
  if (live.length <= VIRTUALIZE_AT) {
    return (
      <div className="overflow-x-auto rounded-xl border border-white/5 bg-surface">
        <table className="w-full min-w-[640px] text-left text-sm">
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
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect ? () => onSelect(session.sessionId) : undefined}
                onKeyDown={
                  onSelect
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(session.sessionId);
                        }
                      }
                    : undefined
                }
                className={`border-b border-white/5 last:border-0 ${onSelect ? "cursor-pointer hover:bg-raised/60 focus-visible:outline-none focus-visible:bg-raised/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" : ""}`}
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

  // Windowed path for large lists — only the visible slice (+ overscan) hits the DOM
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + OVERSCAN;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(live.length, start + visibleCount + OVERSCAN * 2);
  const slice = live.slice(start, end);
  const topPad = start * ROW_HEIGHT;
  const bottomPad = (live.length - end) * ROW_HEIGHT;

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-white/5 text-xs uppercase tracking-widest text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">session</th>
              <th className="px-4 py-3 font-medium">member</th>
              <th className="px-4 py-3 font-medium">status</th>
              <th className="px-4 py-3 font-medium">created</th>
              <th className="px-4 py-3 font-medium">duration</th>
            </tr>
          </thead>
        </table>
      </div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="max-h-[60vh] overflow-auto overflow-x-hidden"
        role="region"
        aria-label="Sessions"
      >
        <table className="w-full min-w-[640px] text-left text-sm">
          <tbody>
            {topPad > 0 && (
              <tr aria-hidden="true">
                <td colSpan={5} style={{ height: topPad, padding: 0, border: 0 }} />
              </tr>
            )}
            {slice.map((session) => (
              <tr
                key={session.sessionId}
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect ? () => onSelect(session.sessionId) : undefined}
                onKeyDown={
                  onSelect
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(session.sessionId);
                        }
                      }
                    : undefined
                }
                style={{ height: ROW_HEIGHT }}
                className={`border-b border-white/5 last:border-0 ${onSelect ? "cursor-pointer hover:bg-raised/60 focus-visible:outline-none focus-visible:bg-raised/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" : ""}`}
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
            {bottomPad > 0 && (
              <tr aria-hidden="true">
                <td colSpan={5} style={{ height: bottomPad, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}