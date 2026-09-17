"use client";

import { useEffect, useState } from "react";
import { loadAuth, clearAuth, subscribeAuth, type AuthSession } from "@/lib/auth";

/** Auth state synced to the stored JWT — re-renders on save/clear/401-invalidate. */
export function useAuth(): { session: AuthSession | null; signOut: () => void } {
  const [session, setSession] = useState<AuthSession | null>(() => loadAuth());

  useEffect(() => {
    const sync = () => setSession(loadAuth());
    sync();
    return subscribeAuth(sync);
  }, []);

  return { session, signOut: clearAuth };
}
