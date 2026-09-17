"use client";

// Browser-side JWT session for the dashboard (spec: docs/spec/auth-app-flow.md).
// The token is stored unverified client-side — the daemon is the verifier; the
// BFF forwards whatever bearer the browser sends, so a stored JWT upgrades the
// visitor from the shared legacy token into their own tenant with zero daemon
// changes.

export interface AuthSession {
  jwt: string;
  email: string;
  userId: string;
}

const AUTH_KEY = "atlaslink:auth:jwt";

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== "object" || value === null) return false;
  const s = value as { jwt?: unknown; email?: unknown; userId?: unknown };
  return typeof s.jwt === "string" && s.jwt.length > 0 && typeof s.email === "string" && s.email.length > 0 && typeof s.userId === "string" && s.userId.length > 0;
}

function isStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function loadAuth(): AuthSession | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAuthSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAuth(jwt: string, email: string, userId: string): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ jwt, email, userId }));
    notify();
  } catch {
    // a blocked store must not break the login flow — the session just won't persist
  }
}

export function clearAuth(): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.removeItem(AUTH_KEY);
    notify();
  } catch {
    // same contract as saveAuth: never throw on storage access
  }
}

const CHANGE_EVENT = "atlaslink:auth-changed";

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeAuth(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
