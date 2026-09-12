import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCostHistory } from "./useCostHistory";

describe("useCostHistory", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.buckets).toHaveLength(1);
    expect(result.current.since).toBe("2026-09-01");
    expect(result.current.error).toBeNull();
  });

  it("retries wake-class failures on initial load", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response("not found", { status: 404 })).mockResolvedValueOnce(okResponse()) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 });
    expect(result.current.error).toBeNull();
    expect(result.current.buckets).toHaveLength(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("does not retry domain errors on initial load", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "bad window" }), { status: 400, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("400");
    expect(result.current.buckets).toHaveLength(0);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("refresh keeps the last good buckets on failure", async () => {
    globalThis.fetch = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const { result } = renderHook(() => useCostHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    globalThis.fetch = vi.fn(async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    await result.current.refresh();
    await waitFor(() => expect(result.current.error).toContain("500"));
    expect(result.current.buckets).toHaveLength(1);
  });
});
