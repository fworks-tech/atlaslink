import { describe, it, expect, beforeEach } from "vitest";
import { sidebarStorageKey, hasStoredSidebarOpen, loadSidebarOpen, saveSidebarOpen } from "./sidebarState";

beforeEach(() => {
  window.localStorage.clear();
});

describe("sidebarState", () => {
  it("uses a stable namespaced storage key", () => {
    expect(sidebarStorageKey()).toBe("atlaslink:sidebar:open");
  });

  it("round-trips the open flag through localStorage", () => {
    saveSidebarOpen(false);
    expect(loadSidebarOpen(true)).toBe(false);
    saveSidebarOpen(true);
    expect(loadSidebarOpen(false)).toBe(true);
  });

  it("falls back to the default when nothing is stored", () => {
    expect(loadSidebarOpen(true)).toBe(true);
    expect(loadSidebarOpen(false)).toBe(false);
  });

  it("falls back to the default on corrupt stored values", () => {
    window.localStorage.setItem(sidebarStorageKey(), "not-json{{{");
    expect(loadSidebarOpen(true)).toBe(true);
    window.localStorage.setItem(sidebarStorageKey(), JSON.stringify("yes"));
    expect(loadSidebarOpen(false)).toBe(false);
  });

  it("reports whether a choice was stored", () => {
    expect(hasStoredSidebarOpen()).toBe(false);
    saveSidebarOpen(true);
    expect(hasStoredSidebarOpen()).toBe(true);
  });

  it("never throws when the store is unavailable", () => {
    const getItem = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(loadSidebarOpen(true)).toBe(true);
      expect(() => saveSidebarOpen(false)).not.toThrow();
    } finally {
      window.localStorage.getItem = getItem;
    }
  });
});
