"use client";

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDeliveryReceipts, type ReceiptTurn } from "./useDeliveryReceipts";
import type { BridgeEvent } from "@/lib/types";

function echo(type: string, correlationId: string, content: string, at: string, reply = false): BridgeEvent {
  return {
    eventId: 1,
    type,
    correlationId,
    at,
    ...(reply ? { reply: content } : { message: content }),
  } as BridgeEvent;
}

function turn(content: string, at?: string): ReceiptTurn {
  return { content, at };
}

describe("useDeliveryReceipts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves sending to sent on settle and to delivered on the SSE echo", () => {
    const { result, rerender } = renderHook(({ events }) => useDeliveryReceipts(events), {
      initialProps: { events: [] as BridgeEvent[] },
    });
    let key = "";
    act(() => {
      key = result.current.trackSend("ses-1", "go ahead");
    });
    expect(result.current.assign("ses-1", "cor-1", [turn("go ahead", "2026-09-15T12:00:01.000Z")]).get(0)).toBe("sending");
    act(() => {
      result.current.settleSend(key, true);
    });
    expect(result.current.assign("ses-1", "cor-1", [turn("go ahead", "2026-09-15T12:00:01.000Z")]).get(0)).toBe("sent");
    rerender({ events: [echo("session.user_reply", "cor-1", "go ahead", "2026-09-15T12:00:02.000Z", true)] });
    expect(result.current.assign("ses-1", "cor-1", [turn("go ahead", "2026-09-15T12:00:01.000Z")]).get(0)).toBe("delivered");
  });

  it("marks failed sends and never upgrades them", () => {
    const { result, rerender } = renderHook(({ events }) => useDeliveryReceipts(events), {
      initialProps: { events: [] as BridgeEvent[] },
    });
    let key = "";
    act(() => {
      key = result.current.trackSend("ses-1", "go ahead");
    });
    act(() => {
      result.current.settleSend(key, false);
    });
    rerender({ events: [echo("session.user_reply", "cor-1", "go ahead", "2026-09-15T12:00:02.000Z", true)] });
    expect(result.current.assign("ses-1", "cor-1", [turn("go ahead", "2026-09-15T12:00:01.000Z")]).get(0)).toBe("failed");
  });

  it("leaves historical turns without a tick", () => {
    const { result } = renderHook(() => useDeliveryReceipts([]));
    expect(result.current.assign("ses-1", "cor-1", [turn("old words", "2026-09-01T00:00:00.000Z")]).has(0)).toBe(false);
  });

  it("assigns identical contents oldest-first and withholds delivery until each echo", () => {
    const { result, rerender } = renderHook(({ events }) => useDeliveryReceipts(events), {
      initialProps: { events: [] as BridgeEvent[] },
    });
    act(() => {
      result.current.trackSend("ses-1", "again");
      result.current.settleSend("r0", true);
    });
    vi.setSystemTime(new Date("2026-09-15T12:00:10.000Z"));
    act(() => {
      result.current.trackSend("ses-1", "again");
      result.current.settleSend("r1", true);
    });
    const turns = [turn("again", "2026-09-15T12:00:01.000Z"), turn("again", "2026-09-15T12:00:11.000Z")];
    rerender({ events: [echo("session.message", "cor-1", "again", "2026-09-15T12:00:02.000Z")] });
    const assigned = result.current.assign("ses-1", "cor-1", turns);
    expect(assigned.get(0)).toBe("delivered");
    // the resend's echo has not arrived yet — no inherited delivery
    expect(assigned.get(1)).toBe("sent");
  });

  it("settles an unobserved send at sent instead of faking delivered", () => {
    const { result } = renderHook(() => useDeliveryReceipts([]));
    act(() => {
      const key = result.current.trackSend("ses-1", "into the void");
      result.current.settleSend(key, true);
    });
    vi.setSystemTime(new Date("2026-09-15T12:01:00.000Z"));
    expect(result.current.assign("ses-1", "cor-1", [turn("into the void", "2026-09-15T12:00:01.000Z")]).get(0)).toBe("sent");
  });

  it("ignores echoes for other sessions", () => {
    const { result, rerender } = renderHook(({ events }) => useDeliveryReceipts(events), {
      initialProps: { events: [] as BridgeEvent[] },
    });
    act(() => {
      const key = result.current.trackSend("ses-1", "go ahead");
      result.current.settleSend(key, true);
    });
    rerender({ events: [echo("session.user_reply", "cor-2", "go ahead", "2026-09-15T12:00:02.000Z", true)] });
    expect(result.current.assign("ses-1", "cor-1", [turn("go ahead", "2026-09-15T12:00:01.000Z")]).get(0)).toBe("sent");
  });
});
