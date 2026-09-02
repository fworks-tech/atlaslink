"use client";

import { useEffect, useState } from "react";
import { useBackendHealth } from "@/hooks/useBackendHealth";

export function BackendWakingOverlay() {
  const { health, attempt, retry } = useBackendHealth();
  const [showUnknown, setShowUnknown] = useState(false);

  // Avoid flash on every warm load: only show "unknown" after 800ms
  useEffect(() => {
    if (health !== "unknown") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deferred showUnknown gate for unknown flash
      setShowUnknown(false);
      return;
    }
    const t = setTimeout(() => setShowUnknown(true), 800);
    return () => clearTimeout(t);
  }, [health]);

  const shouldShow = health === "waking" || health === "down" || (health === "unknown" && showUnknown);
  if (!shouldShow) return null;

  const isDown = health === "down";
  const subtitle = isDown
    ? "Retrying connection to Render…"
    : "Waking Render server (cold start ~15–30s)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Server is starting"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl border border-white/10 bg-surface px-6 py-5 text-center shadow-xl">
        <div
          className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-accent"
          aria-hidden
        />
        <p className="mt-3 text-sm font-medium text-foreground">Server is starting — please wait</p>
        <p className="mt-1 text-xs text-muted" role="status" aria-live="polite">
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
