import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCost } from "./useCost";

describe("useCost", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("loads the rollup on mount", async () => {
    const payload = {
      ok: true,
      breakdown: [{ agent: "the-builder", promptTokens: 10, completionTokens: 4, stepCost: 0.002, models: ["m1"] }],
      total: { promptTokens: 10, completionTokens: 4, stepCost: 0.002 },
    };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const { result } = renderHook(() => useCost());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.total.stepCost).toBe(0.002);
    expect(result.current.breakdown).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });
});
