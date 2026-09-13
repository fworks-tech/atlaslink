import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useCost } from "./useCost";

describe("useCost", () => {
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

  const rollup = {
    ok: true,
    breakdown: [{ agent: "the-builder", promptTokens: 10, completionTokens: 4, stepCost: 0.002, models: ["m1"] }],
    total: { promptTokens: 10, completionTokens: 4, stepCost: 0.002 },
  };

  it("loads the rollup on mount", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(rollup), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const { result } = renderHook(() => useCost());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.total.stepCost).toBe(0.002);
    expect(result.current.breakdown).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("polls every 5s while the tab is visible", async () => {
    const refreshed = { ...rollup, total: { promptTokens: 20, completionTokens: 8, stepCost: 0.004 } };
    const okJson = () => new Response(JSON.stringify(rollup), { status: 200, headers: { "Content-Type": "application/json" } });
    const refreshedJson = () => new Response(JSON.stringify(refreshed), { status: 200, headers: { "Content-Type": "application/json" } });
    const spy = vi.fn(okJson);
    spy.mockResolvedValueOnce(okJson());
    spy.mockResolvedValue(refreshedJson());
    globalThis.fetch = spy as unknown as typeof fetch;
    const { result } = renderHook(() => useCost());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(false);
    const callsBefore = spy.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(spy.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(result.current.total.stepCost).toBe(0.004);
  });

  it("skips the poll while the tab is hidden", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(rollup), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const { result } = renderHook(() => useCost());
    await act(async () => { await Promise.resolve(); });
    const callsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await act(async () => { vi.advanceTimersByTime(10000); await Promise.resolve(); });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    expect(result.current.error).toBeNull();
  });

  it("keeps the last good rollup when a poll fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(rollup), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const { result } = renderHook(() => useCost());
    await act(async () => { await Promise.resolve(); });
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(result.current.total.stepCost).toBe(0.002);
    expect(result.current.error).toBeNull();
  });

  it("loads once but never polls when poll is false", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(rollup), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const { result } = renderHook(() => useCost({ poll: false }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.total.stepCost).toBe(0.002);
    const callsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(15000); await Promise.resolve(); });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });
});
