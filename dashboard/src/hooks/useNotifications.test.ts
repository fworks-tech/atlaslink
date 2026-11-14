import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNotifications } from "./useNotifications";

const NOTIFS = [
  { id: "n-1", userId: "u-1", sessionId: "ses-a", kind: "mention", excerpt: "hey", readAt: null, createdAt: "2026-11-14T10:00:00Z" },
];

const apiMock = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getNotifications: apiMock.getNotifications,
  markNotificationRead: apiMock.markNotificationRead,
}));

const authMock = vi.hoisted(() => ({
  session: null as null | { jwt: string; email: string; userId: string },
}));

vi.mock("@/lib/auth", () => ({
  loadAuth: () => authMock.session,
}));

type Listener = (msg: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  listeners = new Map<string, Listener[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }
  close(): void {
    this.closed = true;
  }
}

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.session = { jwt: "test-jwt", email: "t@e.com", userId: "u-1" };
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    apiMock.getNotifications.mockResolvedValue({
      ok: true,
      notifications: NOTIFS,
      total: 1,
      unreadCount: 1,
      unreadBySession: { "ses-a": 1 },
      limit: 50,
      offset: 0,
    });
    apiMock.markNotificationRead.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the snapshot and exposes counts", async () => {
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unreadBySession).toEqual({ "ses-a": 1 });
    // no API host configured → BFF fallback stream
    expect(FakeEventSource.instances[0]?.url).toBe("/api/notifications/stream");
  });

  it("prepends live bells and marks them read", async () => {
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    const es = FakeEventSource.instances[0];
    act(() => {
      es.emit("notification.created", {
        notification: { id: "n-2", userId: "u-1", sessionId: "ses-b", kind: "reply", excerpt: "ack", readAt: null, createdAt: "2026-11-14T10:01:00Z" },
      });
    });
    expect(result.current.unreadCount).toBe(2);
    expect(result.current.unreadBySession).toEqual({ "ses-a": 1, "ses-b": 1 });

    await act(async () => {
      await result.current.markRead("n-2");
    });
    expect(apiMock.markNotificationRead).toHaveBeenCalledWith("n-2");
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.unreadBySession).toEqual({ "ses-a": 1 });
  });
});

describe("useNotifications stream robustness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    authMock.session = { jwt: "test-jwt", email: "t@e.com", userId: "u-1" };
    apiMock.getNotifications.mockResolvedValue({
      ok: true,
      notifications: NOTIFS,
      total: 1,
      unreadCount: 1,
      unreadBySession: { "ses-a": 1 },
      limit: 50,
      offset: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores redelivered frames instead of double-counting", async () => {
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    const es = FakeEventSource.instances[0];
    const bell = {
      notification: { id: "n-2", userId: "u-1", sessionId: "ses-b", kind: "reply", excerpt: "ack", readAt: null, createdAt: "2026-11-14T10:01:00Z" },
    };
    act(() => {
      es.emit("notification.created", bell);
    });
    expect(result.current.unreadCount).toBe(2);
    act(() => {
      es.emit("notification.created", bell);
    });
    // same id twice: list and counts stay put until the poller heals
    expect(result.current.unreadCount).toBe(2);
    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadBySession).toEqual({ "ses-a": 1, "ses-b": 1 });
  });

  it("opens no stream when anonymous or polling is off", async () => {
    authMock.session = null;
    const { unmount } = renderHook(() => useNotifications());
    await act(async () => {});
    expect(FakeEventSource.instances).toHaveLength(0);
    unmount();
    authMock.session = { jwt: "test-jwt", email: "t@e.com", userId: "u-1" };
    const off = renderHook(() => useNotifications({ poll: false }));
    await act(async () => {});
    expect(FakeEventSource.instances).toHaveLength(0);
    off.unmount();
  });

  it("tears down the stream on sign-out and reconnects on sign-in", async () => {
    const { rerender, unmount } = renderHook(() => useNotifications());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const first = FakeEventSource.instances[0];
    authMock.session = null;
    rerender();
    expect(first.closed).toBe(true);
    authMock.session = { jwt: "other-jwt", email: "o@e.com", userId: "u-2" };
    rerender();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1].closed).toBe(false);
    unmount();
  });
});
