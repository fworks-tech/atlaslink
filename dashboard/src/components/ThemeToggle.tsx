"use client";

import { useState } from "react";
import { loadTheme, saveTheme, type Theme } from "@/lib/uiPrefs";

// Applies the resolved theme to <html> and keeps Mantine's color-scheme
// attribute in lockstep so Drawer/Burger follow the same palette.
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.setAttribute("data-mantine-color-scheme", theme);
}

export function resolveInitialTheme(): Theme {
  const stored = loadTheme();
  if (stored) return stored;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function ThemeToggle({ className }: { className?: string }) {
  // resolved during the first client render; the label/pressed state is
  // client-only truth, so hydration text drift is suppressed below —
  // the pre-paint script in layout.tsx already set the right palette on <html>
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme());

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      aria-pressed={theme === "light"}
      title={`theme: ${theme}`}
      suppressHydrationWarning
      className={`min-h-[44px] min-w-[44px] rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent/30 hover:text-foreground ${className ?? ""}`}
    >
      {theme === "light" ? "dark" : "light"}
    </button>
  );
}
