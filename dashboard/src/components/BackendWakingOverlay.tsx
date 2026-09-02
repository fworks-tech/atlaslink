"use client";

import { useBackendHealth } from "@/hooks/useBackendHealth";

export function BackendWakingOverlay() {
  const { health, attempt, retry } = useBackendHealth();

  if (health === "healthy") return null;

  const isDown = health === "down";
  const title = "Server is starting — please wait";
  const subtitle = isDown
    ? "Retrying connection to Render…"
    : health === "unknown"
      ? "Waking server (cold start ~15–30s)"
      : "Waking Render server (cold start ~15–30s)";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl border border-white/10 bg-surface px-6 py-5 text-center shadow-xl">
        <div
          className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-accent"
          aria-hidden
        />
        <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted">
          {subtitle} {attempt > 0 ? `· attempt ${attempt}` : null}
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 text-xs font-medium text-accent underline underline-offset-4 hover:text-accent/80"
        >
          retry now
        </button>
      </div>
    </div>
  );
}
