"use client";

import { useEffect } from "react";
import { logError } from "@/lib/errorLogger";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, { component: "error.tsx", digest: error.digest });
  }, [error]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span className="text-[8rem] sm:text-[10rem] md:text-[12rem] font-black tracking-tighter text-foreground/[0.04] leading-none" aria-hidden>
          ATLAS
        </span>
      </div>

      <div className="relative z-10 text-center">
        <p className="font-mono text-sm tracking-widest text-danger">ERROR</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {error.digest ? `Error ID: ${error.digest}` : "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="mt-6 inline-flex rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
