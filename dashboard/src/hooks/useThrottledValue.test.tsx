import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useThrottledValue } from "./useThrottledValue";

describe("useThrottledValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("yields the initial value immediately (leading edge)", () => {
    const { result } = renderHook(() => useThrottledValue(1, 100));
    expect(result.current).toBe(1);
  });

  it("throttles rapid updates and flushes the trailing value", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: 1 },
    });
    expect(result.current).toBe(1);
    rerender({ v: 2 });
    // still within the 100ms window → throttled value stays 1
    expect(result.current).toBe(1);
    rerender({ v: 3 });
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(3);
  });

  it("allows the next leading edge after the window", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: 1 },
    });
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: 2 });
    expect(result.current).toBe(2);
  });

  it("handles array values via trailing flush", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: [1] },
    });
    expect(result.current).toEqual([1]);
    rerender({ v: [1, 2] });
    rerender({ v: [1, 2, 3] });
    expect(result.current).toEqual([1]);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toEqual([1, 2, 3]);
  });
});
