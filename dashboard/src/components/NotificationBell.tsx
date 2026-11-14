"use client";

import { useState } from "react";
import type { Notification } from "@/lib/types";

const KIND_LABEL: Record<Notification["kind"], string> = {
  mention: "@mention",
  reply: "reply",
  approval: "needs you",
};

/**
 * Per-user notification bell (Phase B): unread badge + dropdown, mark-read
 * on open. Excerpts render as plain text (never HTML) — the server stores
 * raw, the client never interprets it.
 */
export function NotificationBell({
  notifications,
  unreadCount,
  onMarkRead,
  onSelectSession,
}: {
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onSelectSession?: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        className="relative rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm text-foreground transition-colors hover:border-accent/40"
      >
        <span aria-hidden>🔔</span>
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-5 text-background"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-auto rounded-xl border border-line bg-surface p-2 shadow-xl"
        >
          {notifications.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted">No notifications yet — @mentions land here.</div>
          )}
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              role="menuitem"
              onClick={() => {
                if (n.readAt === null) onMarkRead(n.id);
                onSelectSession?.(n.sessionId);
                setOpen(false);
              }}
              className={`mb-1 block w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-raised ${
                n.readAt === null ? "bg-accent/5" : "opacity-70"
              }`}
            >
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted">
                <span>{KIND_LABEL[n.kind] ?? n.kind}</span>
                <span className="font-mono normal-case tracking-normal">{n.sessionId.slice(0, 8)}…</span>
                {n.createdAt && <span className="ml-auto normal-case tracking-normal">{new Date(n.createdAt).toLocaleTimeString()}</span>}
              </div>
              <div className="mt-0.5 break-words text-sm text-foreground">{n.excerpt}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
