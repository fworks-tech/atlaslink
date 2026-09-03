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

  it("empties the roster when the read fails", async () => {
    mockedGet.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useRoomPresence("ses-1"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.members).toEqual([]);
  });
});
