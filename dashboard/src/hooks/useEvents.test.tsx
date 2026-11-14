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

  it("subscribes to the room event types that keep the thread live", () => {
    renderHook(() => useEvents());
    const types = MockEventSource.instances[0].listeners;
    for (const type of ["session.message", "session.steer", "session.awaiting_input", "session.user_reply", "session.parked"]) {
      expect(types.has(type), `subscribed to ${type}`).toBe(true);
    }
  });

  it("connects direct with a BFF ticket when a public API URL is configured", async () => {
    process.env.NEXT_PUBLIC_ATLASLINK_API_URL = "https://api.atlas.flabs.tech";
    const fetchMock = vi.fn(async () => Response.json({ ok: true, ticket: "tkt.jwt.sig", expiresAt: new Date().toISOString() }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderHook(() => useEvents());
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/stream-ticket", { method: "POST" });
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url.startsWith("https://api.atlas.flabs.tech/v1/events?ticket=tkt.jwt.sig")).toBe(true);
    } finally {
      delete process.env.NEXT_PUBLIC_ATLASLINK_API_URL;
    }
  });

  it("forwards the browser bearer when fetching the stream ticket", async () => {
    process.env.NEXT_PUBLIC_ATLASLINK_API_URL = "https://api.atlas.flabs.tech";
    window.localStorage.setItem(
      "atlaslink:auth:jwt",
      JSON.stringify({ jwt: "user.jwt.sig", email: "u@x.com", userId: "u-1" })
    );
    const fetchMock = vi.fn(async () => Response.json({ ok: true, ticket: "tkt.jwt.sig", expiresAt: new Date().toISOString() }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderHook(() => useEvents());
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/stream-ticket", {
        method: "POST",
        headers: { Authorization: "Bearer user.jwt.sig" },
      });
    } finally {
      window.localStorage.removeItem("atlaslink:auth:jwt");
      delete process.env.NEXT_PUBLIC_ATLASLINK_API_URL;
    }
  });
});
