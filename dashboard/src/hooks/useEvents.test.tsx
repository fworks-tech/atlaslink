import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEvents } from "./useEvents";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }
  close() { this.closed = true; }
  emit(type: string, data: string) {
    for (const cb of this.listeners.get(type) ?? []) cb({ data } as MessageEvent);
  }
  emitOpen() { this.onopen?.(); }
  emitError() { this.onerror?.(); }
}

describe("useEvents", () => {
  const origES = (globalThis as unknown as { EventSource: unknown }).EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource as unknown as typeof EventSource;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = origES;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("connects to /api/events and tracks connection state", async () => {
    const { result } = renderHook(() => useEvents());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/events");
    expect(result.current.connection).toBe("connecting");
    act(() => MockEventSource.instances[0].emitOpen());
    expect(result.current.connection).toBe("connected");
  });

  it("buffers events up to MAX_BUFFERED_EVENTS and parses JSON", async () => {
    const { result } = renderHook(() => useEvents());
    act(() => MockEventSource.instances[0].emitOpen());
    act(() => {
      MockEventSource.instances[0].emit("session.created", JSON.stringify({ eventId: 1, type: "session.created", sessionId: "ses-1" }));
      MockEventSource.instances[0].emit("message", JSON.stringify({ eventId: 2, type: "session.running", sessionId: "ses-1" }));
    });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].type).toBe("session.created");
  });

  it("reconnects with exponential backoff on error and does not reconnect when unmounted", async () => {
    const { unmount, result } = renderHook(() => useEvents());
    const first = MockEventSource.instances[0];
    act(() => first.emitOpen());
    act(() => first.emitError());
    expect(result.current.connection).toBe("disconnected");
    expect(MockEventSource.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(MockEventSource.instances).toHaveLength(2);
    unmount();
    // further errors after unmount should not schedule reconnect
    act(() => MockEventSource.instances[1].emitError());
    act(() => vi.advanceTimersByTime(30000));
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("does not connect when enabled=false", () => {
    renderHook(() => useEvents({ enabled: false }));
    expect(MockEventSource.instances).toHaveLength(0);
  });
});
