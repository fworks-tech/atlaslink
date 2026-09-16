import { describe, it, expect, beforeEach } from "vitest";
import { loadLastSession, saveLastSession, clearLastSession, loadDiagramMode, saveDiagramMode, loadTheme, saveTheme } from "./uiPrefs";

beforeEach(() => {
  window.localStorage.clear();
});

describe("uiPrefs last session", () => {
  it("returns null when nothing was stored", () => {
    expect(loadLastSession()).toBeNull();
  });

  it("round-trips the session with its project", () => {
    saveLastSession("ses-1", "p-1");
    expect(loadLastSession()).toEqual({ session: "ses-1", project: "p-1" });
  });

  it("round-trips a session without a project", () => {
    saveLastSession("ses-1");
    expect(loadLastSession()).toEqual({ session: "ses-1" });
  });

  it("clears the stored session", () => {
    saveLastSession("ses-1", "p-1");
    clearLastSession();
    expect(loadLastSession()).toBeNull();
  });

  it("rejects corrupt or shapeless stored values", () => {
    window.localStorage.setItem("atlaslink:ui:last-session", "not-json{{{");
    expect(loadLastSession()).toBeNull();
    window.localStorage.setItem("atlaslink:ui:last-session", JSON.stringify({ nope: 1 }));
    expect(loadLastSession()).toBeNull();
    window.localStorage.setItem("atlaslink:ui:last-session", JSON.stringify({ session: "" }));
    expect(loadLastSession()).toBeNull();
  });
});

describe("uiPrefs diagram mode", () => {
  it("round-trips the mode", () => {
    saveDiagramMode("chain");
    expect(loadDiagramMode("full")).toBe("chain");
  });

  it("falls back when nothing is stored", () => {
    expect(loadDiagramMode("full")).toBe("full");
  });

  it("falls back on corrupt or unknown stored modes", () => {
    window.localStorage.setItem("atlaslink:ui:diagram-mode", "not-json{{{");
    expect(loadDiagramMode("full")).toBe("full");
    window.localStorage.setItem("atlaslink:ui:diagram-mode", JSON.stringify("grid"));
    expect(loadDiagramMode("full")).toBe("full");
  });
});

describe("uiPrefs theme", () => {
  it("round-trips the theme", () => {
    saveTheme("light");
    expect(loadTheme()).toBe("light");
    saveTheme("dark");
    expect(loadTheme()).toBe("dark");
  });

  it("returns null when nothing is stored", () => {
    expect(loadTheme()).toBeNull();
  });

  it("returns null for corrupt or unknown stored values", () => {
    window.localStorage.setItem("atlaslink:ui:theme", "not-json{{{");
    expect(loadTheme()).toBeNull();
    window.localStorage.setItem("atlaslink:ui:theme", JSON.stringify("sepia"));
    expect(loadTheme()).toBeNull();
  });
});
