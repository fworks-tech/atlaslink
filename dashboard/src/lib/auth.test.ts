import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadAuth, saveAuth, clearAuth, subscribeAuth } from "./auth";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth session storage", () => {
  it("round-trips a session", () => {
    saveAuth("jwt-1", "a@b.c", "usr-1");
    expect(loadAuth()).toEqual({ jwt: "jwt-1", email: "a@b.c", userId: "usr-1" });
  });

  it("returns null when nothing is stored", () => {
    expect(loadAuth()).toBeNull();
  });

  it("rejects corrupt or shapeless stored values", () => {
    window.localStorage.setItem("atlaslink:auth:jwt", "not-json{{{");
    expect(loadAuth()).toBeNull();
    window.localStorage.setItem("atlaslink:auth:jwt", JSON.stringify({ jwt: "" }));
    expect(loadAuth()).toBeNull();
    window.localStorage.setItem("atlaslink:auth:jwt", JSON.stringify({ jwt: "x", email: "y" }));
    expect(loadAuth()).toBeNull();
  });

  it("clears the session", () => {
    saveAuth("jwt-1", "a@b.c", "usr-1");
    clearAuth();
    expect(loadAuth()).toBeNull();
  });

  it("survives a blocked store without throwing", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const removeItem = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveAuth("j", "a@b.c", "u")).not.toThrow();
    expect(() => clearAuth()).not.toThrow();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});

describe("auth change notifications", () => {
  it("notifies subscribers on save and clear", () => {
    const listener = vi.fn();
    const unsub = subscribeAuth(listener);
    saveAuth("j", "a@b.c", "u");
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    clearAuth();
    expect(listener).toHaveBeenCalled();
    unsub();
    listener.mockClear();
    saveAuth("j2", "a2@b.c", "u2");
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps loadAuth null without storage access", () => {
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadAuth()).toBeNull();
    getItem.mockRestore();
  });
});
