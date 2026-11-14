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

vi.mock("@/lib/auth", () => ({
  loadAuth: () => null,
}));

type Listener = (msg: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
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
  close(): void {}
}

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
