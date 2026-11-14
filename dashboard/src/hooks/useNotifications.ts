"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getNotifications, markNotificationRead } from "@/lib/api";
import type { Notification } from "@/lib/types";
import { loadAuth } from "@/lib/auth";

const POLL_INTERVAL_MS = 15000;

/**
 * In-app bells (Phase B): REST snapshot + live `notification.created` frames.
 * The live stream mirrors useEvents — A3 ticket straight to the API host when
 * configured, BFF proxy fallback otherwise (EventSource cannot set the auth
 * header, hence the ticket query). Polling is the truth for counts: a missed
 * frame cannot strand a stale badge.
 */
export function useNotifications({ poll = true }: { poll?: boolean } = {}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadBySession, setUnreadBySession] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  // mirror for read-then-update without impure updaters (StrictMode-safe)
  const notificationsRef = useRef<Notification[]>([]);
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  const applySnapshot = useCallback((res: { notifications: Notification[]; unreadCount: number; unreadBySession: Record<string, number> }) => {
    notificationsRef.current = res.notifications;
    setNotifications(res.notifications);
    setUnreadCount(res.unreadCount);
    setUnreadBySession(res.unreadBySession);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applySnapshot(await getNotifications());
    } catch (err) {
      // keep the last good bells, never blank
      setError(err instanceof Error ? err.message : "failed to load notifications");
    }
  }, [applySnapshot]);

  useEffect(() => {
    if (!poll) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await getNotifications();
        if (!cancelled) applySnapshot(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed to load notifications");
      }
    })();
    const timer = setInterval(() => {
      if (!cancelled) void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [poll, refresh, applySnapshot]);

  // live bells: prepend + bump counts without a REST round-trip.
  // The stream follows the signed-in identity: sign-out closes it, sign-in
  // reconnects, and anonymous visitors never open a doomed 401 stream.
  const identity = loadAuth()?.jwt ?? null;
  useEffect(() => {
    if (!poll || !identity) return;
    let cancelled = false;
    const url = (ticket?: string): string => {
      const directBase = process.env.NEXT_PUBLIC_ATLASLINK_API_URL?.replace(/\/$/, "");
      if (directBase && ticket) return `${directBase}/v1/notifications/stream?ticket=${encodeURIComponent(ticket)}`;
      return "/api/notifications/stream";
    };
    const listen = (streamUrl: string): void => {
      if (cancelled) return;
      const es = new EventSource(streamUrl);
      esRef.current = es;
      es.addEventListener("notification.created", (msg) => {
        try {
          const body = JSON.parse(msg.data) as { notification?: Notification };
          if (body.notification && typeof body.notification.id === "string") {
            const n = body.notification;
            // redelivered frames must not double-count: bump only new ids
            if (notificationsRef.current.some((p) => p.id === n.id)) return;
            notificationsRef.current = [n, ...notificationsRef.current].slice(0, 50);
            setNotifications(notificationsRef.current);
            setUnreadCount((c) => c + 1);
            setUnreadBySession((prev) => ({ ...prev, [n.sessionId]: (prev[n.sessionId] ?? 0) + 1 }));
          }
        } catch {
          // malformed frame — the poller heals counts within 15s
        }
      });
      es.onerror = () => {
        es.close();
        esRef.current = null;
      };
    };
    const directBase = process.env.NEXT_PUBLIC_ATLASLINK_API_URL?.replace(/\/$/, "");
    if (!directBase) {
      listen(url());
      return () => {
        cancelled = true;
        esRef.current?.close();
        esRef.current = null;
      };
    }
    const session = loadAuth();
    const ticketInit: RequestInit = session?.jwt
      ? { method: "POST", headers: { Authorization: `Bearer ${session.jwt}` } }
      : { method: "POST" };
    void fetch("/api/auth/stream-ticket", ticketInit)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`ticket ${res.status}`))))
      .then((body: unknown) => {
        const ticket = (body as { ticket?: unknown }).ticket;
        if (typeof ticket !== "string" || ticket.length === 0) throw new Error("no ticket");
        listen(url(ticket));
      })
      .catch(() => listen(url()));
    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [poll, identity]);

  const markRead = useCallback(async (id: string) => {
    try {
      await markNotificationRead(id);
    } catch {
      return; // 404 (another user's bell) or offline — poller heals on next tick
    }
    const target = notificationsRef.current.find((n) => n.id === id);
    const alreadyRead = target?.readAt !== null;
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    if (target && !alreadyRead) {
      const sid = target.sessionId;
      setUnreadCount((c) => Math.max(0, c - 1));
      setUnreadBySession((prev) => {
        const next = { ...prev };
        if ((next[sid] ?? 0) <= 1) delete next[sid];
        else next[sid] -= 1;
        return next;
      });
    }
  }, []);

  return { notifications, unreadCount, unreadBySession, error, refresh, markRead };
}
