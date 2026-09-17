"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

/** Demo-mode notice for anonymous visitors on /atlas (spec: auth-app-flow §2). */
export default function DemoBanner() {
  const { session } = useAuth();
  if (session) return null;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-8">
      <div role="status" className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-xs text-muted sm:justify-between">
        <span>
          You're browsing the <strong className="text-foreground">demo</strong> — sessions live in the shared tenant.
        </span>
        <Link href="/login" className="text-accent underline">
          Sign in to keep your sessions
        </Link>
      </div>
    </div>
  );
}
