import type { Session, BridgeEvent } from "@/lib/types";

function toDate(at?: string): number {
  return at !== undefined ? Date.parse(at) : NaN;
}

/** What each terminal/in-flight lifecycle event means, as data — not an if-chain. */
export const LIFECYCLE_TRANSITIONS: Record<string, (patch: Partial<Session>, event: BridgeEvent, current: Session) => void> = {
  "session.running": (patch, event, current) => {
    patch.status = "running";
    patch.startedAt = typeof event.at === "string" ? event.at : current.startedAt;
    patch.nextStep = null;
  },
  "session.succeeded": (patch, event, current) => {
    patch.status = "succeeded";
    patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
    patch.durationMs = typeof event.durationMs === "number" ? event.durationMs : current.durationMs;
    patch.output = typeof event.output === "string" ? event.output : current.output;
    patch.nextStep = null;
  },
  "session.failed": (patch, event, current) => {
    patch.status = "failed";
    patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
    patch.durationMs = typeof event.durationMs === "number" ? event.durationMs : current.durationMs;
    patch.error = typeof event.error === "string" ? event.error : current.error;
    patch.nextStep = null;
  },
  "session.cancelled": (patch, event, current) => {
    patch.status = "cancelled";
    patch.finishedAt = typeof event.at === "string" ? event.at : current.finishedAt;
    patch.nextStep = null;
  },
  "session.awaiting_input": (patch, event) => {
    patch.status = "awaiting_input";
    patch.nextStep = {
      awaiting_input: true,
      prompt: firstQuestionLabel(event.question) ?? (typeof event.prompt === "string" ? (event.prompt as string) : undefined),
      member: typeof event.member === "string" ? (event.member as string) : undefined,
    };
  },
  // linked-session resume: the reply is recorded on the parked original, which
  // stays awaiting_input — the follow-up arrives as its own session.created,
  // so the reply event itself patches nothing (content comes via refetch)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  "session.user_reply": (_patch, _event, _current) => {},
};

/** First fx question label; tolerates the legacy plain-string shape. */
function firstQuestionLabel(question: unknown): string | undefined {
  if (typeof question === "string") return question;
  const questions = (question as { questions?: Array<{ label?: unknown }> } | null)?.questions;
  const label = questions?.[0]?.label;
  return typeof label === "string" ? label : undefined;
}

export function formatDuration(session: Session): string {
  if (session.durationMs !== undefined && session.status !== "running") {
    return `${(session.durationMs / 1000).toFixed(1)}s`;
  }
  if (session.status === "running") return "live…";
  if (session.status === "awaiting_input") return "awaiting input…";
  return "—";
}

export function isAwaitingInput(session: Session): boolean {
  return session.status === "awaiting_input" || Boolean(session.nextStep?.awaiting_input);
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
          interaction: [],
          nextStep: null,
          diagram: null,
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