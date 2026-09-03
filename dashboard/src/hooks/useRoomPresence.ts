"use client";

import { useEffect, useState } from "react";
import { getRoomMembers } from "@/lib/api";
import type { RoomMember } from "@/lib/api";

const POLL_MS = 5000;

/**
 * Live roster of a session's WS room. The browser cannot hold the socket
 * itself (no token client-side, BFF cannot proxy upgrades), so presence is
 * a short poll of the roster read — 5s keeps the "who's here" indicator
 * honest without hammering the daemon.
 */
export function useRoomPresence(sessionId?: string) {
  const [members, setMembers] = useState<RoomMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    let inflight = false;
    const load = async (): Promise<void> => {
      // no selection (or a failed read) means an empty roster — the
      // same-reference guard avoids a re-render every poll with no session
      if (!sessionId) {
        if (!cancelled) setMembers((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      // hidden tabs skip the poll and a slow read never overlaps the next
      // tick — presence resumes honest on the following interval
      if (typeof document !== "undefined" && document.hidden) return;
      if (inflight) return;
      inflight = true;
      try {
        const res = await getRoomMembers(sessionId);
        if (!cancelled) setMembers(res.members);
      } catch {
        if (!cancelled) setMembers((prev) => (prev.length === 0 ? prev : []));
      } finally {
        inflight = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  return { members };
}
