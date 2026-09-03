import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRoomPresence } from "./useRoomPresence";

vi.mock("@/lib/api", () => ({
  getRoomMembers: vi.fn(),
}));

import { getRoomMembers } from "@/lib/api";

const mockedGet = getRoomMembers as unknown as ReturnType<typeof vi.fn>;

describe("useRoomPresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedGet.mockResolvedValue({ ok: true, members: [{ id: "cli-1", name: "Alice", joinedAt: "t" }] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads the roster on mount and repolls on the interval", async () => {
    const { result } = renderHook(() => useRoomPresence("ses-1"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedGet).toHaveBeenCalledWith("ses-1");
    expect(result.current.members.map((m) => m.name)).toEqual(["Alice"]);

    mockedGet.mockResolvedValue({ ok: true, members: [] });
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(result.current.members).toEqual([]);
  });

  it("clears the roster without fetching when no session is selected", async () => {
    const { result } = renderHook(() => useRoomPresence(undefined));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedGet).not.toHaveBeenCalled();
    expect(result.current.members).toEqual([]);
  });

  it("empties a populated roster when the read fails", async () => {
    const { result } = renderHook(() => useRoomPresence("ses-1"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.members.map((m) => m.name)).toEqual(["Alice"]);
    mockedGet.mockRejectedValueOnce(new Error("down"));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(result.current.members).toEqual([]);
  });

  it("clears the roster on deselect and refetches on switch", async () => {
    const { result, rerender } = renderHook(({ id }: { id?: string }) => useRoomPresence(id), { initialProps: { id: "ses-1" as string | undefined } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.members.map((m) => m.name)).toEqual(["Alice"]);
    rerender({ id: undefined });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.members).toEqual([]);
    rerender({ id: "ses-2" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedGet).toHaveBeenLastCalledWith("ses-2");
    expect(result.current.members.map((m) => m.name)).toEqual(["Alice"]);
  });

  it("stops polling after unmount", async () => {
    const { unmount } = renderHook(() => useRoomPresence("ses-1"));
    await act(async () => {
      await Promise.resolve();
    });
    const calls = mockedGet.mock.calls.length;
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });
    expect(mockedGet.mock.calls.length).toBe(calls);
  });

  it("skips the poll while the tab is hidden", async () => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      renderHook(() => useRoomPresence("ses-1"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockedGet).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
    }
  });
});
