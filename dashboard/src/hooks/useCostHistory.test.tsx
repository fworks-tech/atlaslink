import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { useCostHistory } from "./useCostHistory";

describe("useCostHistory", () => {
  const originalFetch = globalThis.fetch;
  const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  afterEach(() => {
    vi.useRealTimers();
    void cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  });

  const historyPayload = {
    ok: true,
    since: "2026-09-01",
    until: "2026-09-10",
    buckets: [
      {
        day: "2026-09-10",
        promptTokens: 10,
        completionTokens: 4,
        stepCost: 0.002,
        agents: [{ agent: "the-builder", promptTokens: 10, completionTokens: 4, stepCost: 0.002, models: ["m1"] }],
      },
    ],
  };

  const okResponse = () =>
    new Response(JSON.stringify(historyPayload), { status: 200, headers: { "Content-Type": "application/json" } });

  it("loads buckets on mount", async () => {
    globalThis.fetch = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.buckets).toHaveLength(1);
    expect(result.current.since).toBe("2026-09-01");
    expect(result.current.error).toBeNull();
  });

  it("retries wake-class failures on initial load", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response("not found", { status: 404 })).mockResolvedValueOnce(okResponse()) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await act(async () => { await vi.advanceTimersByTime(0); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTime(4000); await Promise.resolve(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.buckets).toHaveLength(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("does not retry domain errors on initial load", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "bad window" }), { status: 400, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain("400");
    expect(result.current.buckets).toHaveLength(0);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("polls every 5s and refreshes buckets", async () => {
    const refreshed = {
      ...historyPayload,
      buckets: [
        {
          ...historyPayload.buckets[0],
          stepCost: 0.004,
          agents: [{ agent: "the-builder", promptTokens: 20, completionTokens: 8, stepCost: 0.004, models: ["m1"] }],
        },
      ],
    };
    const refreshedJson = () => new Response(JSON.stringify(refreshed), { status: 200, headers: { "Content-Type": "application/json" } });
    const spy = vi.fn(okResponse);
    spy.mockResolvedValueOnce(okResponse());
    spy.mockResolvedValue(refreshedJson());
    globalThis.fetch = spy as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(false);
    const callsBefore = spy.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(spy.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(result.current.buckets[0].stepCost).toBe(0.004);
  });

  it("skips the poll while the tab is hidden", async () => {
    globalThis.fetch = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await act(async () => { await Promise.resolve(); });
    const callsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await act(async () => { vi.advanceTimersByTime(10000); await Promise.resolve(); });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    expect(result.current.error).toBeNull();
  });

  it("keeps the last good buckets when a poll fails", async () => {
    globalThis.fetch = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await act(async () => { await Promise.resolve(); });
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(result.current.buckets).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("refresh keeps the last good buckets on failure", async () => {
    globalThis.fetch = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await act(async () => { await Promise.resolve(); });
    globalThis.fetch = vi.fn(async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    await result.current.refresh();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toContain("500");
    expect(result.current.buckets).toHaveLength(1);
  });
});
