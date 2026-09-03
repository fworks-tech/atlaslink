import { describe, it, expect } from "vitest";
import { withLiveUpdates, formatDuration } from "@/lib/sessionProjection";
import type { Session, BridgeEvent } from "@/lib/types";

function session(over: Partial<Session> = {}): Session {
  return {
    sessionId: "ses-a",
    correlationId: "cor-a",
    status: "queued",
    version: 1,
    task: { member: "the-mediator", prompt: "fix x" },
    ...over,
  };
}

function ev(type: string, over: Record<string, unknown> = {}): BridgeEvent {
  return {
    eventId: 1,
    type,
    sessionId: "ses-a",
    correlationId: "cor-a",
    at: "2026-08-28T12:00:00.000Z",
    ...over,
  } as BridgeEvent;
}

describe("withLiveUpdates", () => {
  it("keeps the base list untouched when no events arrive", () => {
    const out = withLiveUpdates([session()], []);
    expect(out).toEqual([session()]);
  });

  it("patches status + event-only fields in arrival order (last wins)", () => {
    const events = [
      ev("session.running"),
      ev("session.failed", { error: "boom", durationMs: 500 }),
    ];
    const [out] = withLiveUpdates([session()], events);
    expect(out.status).toBe("failed");
    expect(out.error).toBe("boom");
    expect(out.durationMs).toBe(500);
  });

  it("adds a brand-new session from session.created", () => {
    const out = withLiveUpdates([] as Session[], [
      ev("session.created", { member: "the-builder", prompt: "new task" }),
    ] as BridgeEvent[]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sessionId: "ses-a",
      status: "queued",
      task: { member: "the-builder", prompt: "new task" },
    });
  });

  it("ignores unrelated event types without clobbering current state", () => {
    const out = withLiveUpdates([session({ status: "running" })], [ev("run.started")]);
    expect(out[0].status).toBe("running");
  });

  it("applies only the fields the event actually carries (sparse guard)", () => {
    const out = withLiveUpdates([session({ status: "queued" })], [ev("session.succeeded")]);
    expect(out[0].status).toBe("succeeded");
    expect(out[0].durationMs).toBeUndefined();
    expect(out[0].output).toBeUndefined();
  });

  it("never patches a session it has not seen", () => {
    const out = withLiveUpdates([session()], [ev("session.succeeded", { sessionId: "other" })]);
    expect(out).toEqual([session()]);
  });

  it("sorts newest first by createdAt, falling back to id order", () => {
    const older = session({ sessionId: "ses-a", createdAt: "2026-08-28T12:00:00.000Z" });
    const newer = session({ sessionId: "ses-b", createdAt: "2026-08-28T12:05:00.000Z" });
    expect(withLiveUpdates([older, newer], [])).toEqual([newer, older]);
  });
});

describe("formatDuration", () => {
  it("formats finished durations in seconds", () => {
    expect(formatDuration(session({ status: "succeeded", durationMs: 1500 }))).toBe("1.5s");
  });

  it("shows live for running sessions without a duration", () => {
    expect(formatDuration(session({ status: "running" }))).toBe("live…");
  });

  it("shows a dash for queued sessions", () => {
    expect(formatDuration(session({ status: "queued" }))).toBe("—");
  });

  it("shows awaiting input for awaiting_input", () => {
    expect(formatDuration(session({ status: "awaiting_input" }))).toBe("awaiting input…");
  });
});

describe("withLiveUpdates awaiting_input flow", () => {
  it("transitions to awaiting_input and keeps it on user_reply (linked resume)", () => {
    const afterAwait = withLiveUpdates([session()], [ev("session.awaiting_input", { question: { question: "continue?", context: "why" }, member: "atlas" }) as BridgeEvent]);
    expect(afterAwait[0].status).toBe("awaiting_input");
    expect((afterAwait[0] as unknown as { nextStep: unknown }).nextStep).toMatchObject({ awaiting_input: true, prompt: "continue?" });
    const afterReply = withLiveUpdates(afterAwait, [ev("session.user_reply", { reply: "yes" }) as BridgeEvent]);
    expect(afterReply[0].status).toBe("awaiting_input");
    expect((afterReply[0] as unknown as { nextStep: unknown }).nextStep).toMatchObject({ awaiting_input: true, prompt: "continue?" });
  });
});

describe("withLiveUpdates room chat flow", () => {
  it("appends session.message and session.steer as user turns without moving status", () => {
    const base = session({ status: "running", interaction: [] });
    const out = withLiveUpdates(
      [base],
      [ev("session.message", { message: "hello room" }), ev("session.steer", { message: "pivot" })]
    );
    expect(out[0].status).toBe("running");
    expect(out[0].interaction).toMatchObject([
      { role: "user", content: "hello room" },
      { role: "user", content: "pivot" },
    ]);
  });

  it("ignores chat events without text and caps the thread at the server bound", () => {
    const full = session({
      interaction: Array.from({ length: 500 }, (_, i) => ({ role: "user" as const, at: "t", content: `m${i}` })),
    });
    const out = withLiveUpdates(
      [full],
      [ev("session.message", {}), ev("session.message", { message: "one more" })]
    );
    expect(out[0].interaction).toHaveLength(500);
    expect(out[0].interaction?.[499]?.content).toBe("one more");
  });
});