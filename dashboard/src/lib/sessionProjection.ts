import type { Session, BridgeEvent } from "@/lib/types";

function toDate(at?: string): number {
  return at !== undefined ? Date.parse(at) : NaN;
}

/** What each terminal/in-flight lifecycle event means, as data — not an if-chain. */
export const LIFECYCLE_TRANSITIONS: Record<string, (patch: Partial<Session>, event: BridgeEvent, current: Session) => void> = {
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

export function formatDuration(session: Session): string {
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