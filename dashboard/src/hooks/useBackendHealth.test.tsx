import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBackendHealth } from "./useBackendHealth";

describe("useBackendHealth", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(performance, "now").mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetchOnce(response: Partial<Response> & { ok: boolean; status: number }) {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response as Response);
  }

  it("starts unknown and becomes healthy on fast 200", async () => {
    mockFetchOnce({ ok: true, status: 200 } as Response);
    const { result } = renderHook(() => useBackendHealth());
    expect(result.current.health).toBe("unknown");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(result.current.health).toBe("healthy"));
    expect(result.current.attempt).toBe(0);
  });

  it("shows waking on 502 then down after 3 consecutive 502s", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue({ ok: false, status: 502 } as Response);
    const { result } = renderHook(() => useBackendHealth());

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => expect(result.current.health).toBe("waking"));
    expect(result.current.attempt).toBe(1);

    // second poll (1500ms interval) -> still waking
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(result.current.attempt).toBe(2));
    expect(result.current.health).toBe("waking");

    // third poll -> down
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(result.current.health).toBe("down"));
    expect(result.current.attempt).toBe(3);
  });

  it("treats slow 200 as waking when not yet healthy", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(3000); // elapsed > 2500
    mockFetchOnce({ ok: true, status: 200 } as Response);
    const { result } = renderHook(() => useBackendHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => expect(result.current.health).toBe("waking"));
  });

  it("treats slow 200 as healthy when already healthy", async () => {
    // first fast healthy
    mockFetchOnce({ ok: true, status: 200 } as Response);
    const { result } = renderHook(() => useBackendHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => expect(result.current.health).toBe("healthy"));

    // second slow but healthy -> stays healthy
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(3000);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    await waitFor(() => expect(result.current.health).toBe("healthy"));
  });

  it("resets attempt on healthy after waking", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 502 } as Response);
    const { result } = renderHook(() => useBackendHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => expect(result.current.health).toBe("waking"));

    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    // performance now fast
    vi.spyOn(performance, "now").mockReturnValue(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(result.current.health).toBe("healthy"));
    expect(result.current.attempt).toBe(0);
  });

  it("retry forces immediate check", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 502 } as Response);
    const { result } = renderHook(() => useBackendHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => expect(result.current.health).toBe("waking"));
    const before = result.current.attempt;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(result.current.health).toBe("healthy"));
    expect(result.current.attempt).toBe(0);
    expect(before).toBe(1);
  });

  it("handles TimeoutError as waking", async () => {
    const err = new DOMException("timeout", "TimeoutError");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(err);
    const { result } = renderHook(() => useBackendHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => expect(result.current.health).toBe("waking"));
  });

  it("handles AbortError as waking", async () => {
    const err = new DOMException("aborted", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(err);
    const { result } = renderHook(() => useBackendHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => expect(result.current.health).toBe("waking"));
  });
});
