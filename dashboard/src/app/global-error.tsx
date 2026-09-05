"use client";

import { useEffect } from "react";
import { logError } from "@/lib/errorLogger";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, { component: "global-error.tsx", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <p className="font-mono text-sm tracking-widest text-danger">CRITICAL ERROR</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Application crashed</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {error.digest ? `Error ID: ${error.digest}` : "The application encountered a fatal error."}
          </p>
          <button
            onClick={reset}
            className="mt-6 inline-flex rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
          >
            Reload application
          </button>
        </div>
      </body>
    </html>
  );
}
