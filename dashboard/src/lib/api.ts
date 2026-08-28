import type { TaskListResponse } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The Next.js rewrite proxies /api/* to the daemon; the browser stays same-origin. */
const API_BASE = "/api";

/**
 * Minimal typed fetch wrapper for the daemon surface. Attaches the bearer
 * token only when the gate is armed (dev convenience — never a production
 * secret), parses the { ok, error } envelope, and folds HTTP errors into
 * ApiError so callers can branch on status.
 */
export async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = process.env.NEXT_PUBLIC_ATLASLINK_API_TOKEN;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body (e.g. proxy 404) — keep the status text
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export function getTasks(limit = 50, offset = 0): Promise<TaskListResponse> {
  return fetchJSON<TaskListResponse>(`/tasks?limit=${limit}&offset=${offset}`);
}