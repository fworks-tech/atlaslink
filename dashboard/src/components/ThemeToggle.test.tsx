import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ThemeToggle, { applyTheme, resolveInitialTheme } from "./ThemeToggle";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe("ThemeToggle", () => {
  it("starts from system preference when nothing is stored", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Toggle theme" }).textContent).toBe("dark");
  });

  it("starts from the stored theme and toggles + persists", () => {
    window.localStorage.setItem("atlaslink:ui:theme", JSON.stringify("dark"));
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Toggle theme" });
    expect(button.textContent).toBe("light");
    fireEvent.click(button);
    expect(button.textContent).toBe("dark");
    expect(JSON.parse(window.localStorage.getItem("atlaslink:ui:theme")!)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(button);
    expect(JSON.parse(window.localStorage.getItem("atlaslink:ui:theme")!)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps Mantine's color-scheme attribute in lockstep", () => {
    window.localStorage.setItem("atlaslink:ui:theme", JSON.stringify("dark"));
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe("light");
  });

  it("is keyboard accessible with an aria-pressed state", () => {
    window.localStorage.setItem("atlaslink:ui:theme", JSON.stringify("dark"));
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Toggle theme" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("applyTheme", () => {
  it("sets both the tailwind palette and the Mantine scheme", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe("dark");
  });
});

describe("resolveInitialTheme", () => {
  it("prefers the stored theme over the system preference", () => {
    window.localStorage.setItem("atlaslink:ui:theme", JSON.stringify("light"));
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    expect(resolveInitialTheme()).toBe("light");
  });

  it("falls back to system preference, defaulting to dark", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    expect(resolveInitialTheme()).toBe("light");
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    expect(resolveInitialTheme()).toBe("dark");
  });
});
