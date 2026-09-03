import type { Session, TaskListResponse, Project, ProjectListResponse } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The browser stays same-origin: /api/* is served by the BFF route handler
// (src/app/api/[...path]/route.ts) which forwards to the daemon.
const API_BASE = "/api";

/**
 * Minimal typed fetch wrapper for the daemon surface. The browser only ever
 * talks same-origin to /api/* — src/app/api/[...path]/route.ts forwards to the
 * daemon and injects the gate token server-side, so no secret touches the
 * client bundle. Errors are folded into ApiError so callers can branch on
 * status.
 */
export async function fetchJSON<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs, ...rest } = (init ?? {}) as RequestInit & { timeoutMs?: number };
  const headers = new Headers(rest.headers);
  // a caller-provided content type wins over the JSON default
  if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let signal = rest.signal ?? undefined;
  if (timeoutMs) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
    if (signal && anyFn) {
      signal = anyFn([signal, timeoutSignal]);
    } else {
      // without AbortSignal.any the two cannot be combined — keep the caller
      // signal and forgo the timeout rather than silently dropping the abort
      signal = signal ?? timeoutSignal;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...rest, headers, signal });
  } catch (err) {
    // only our own timeout means "backend unreachable or waking" — a caller
    // abort or a network failure propagates unchanged for the caller to handle
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(504, "Server is starting — please wait");
    }
    throw err;
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body (e.g. proxy 404) — keep the status text
    }
    // Qualify with the status so a daemon 404 ("not found") is never shown
    // bare — callers and users can tell it apart from domain errors like
    // "unknown session".
    const qualified = message.startsWith(String(res.status)) ? message : `${res.status} ${message}`;
    throw new ApiError(res.status, qualified.trim());
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, `${res.status} invalid JSON response`);
  }
}

export function getTasks(limit = 50, offset = 0, projectId?: string): Promise<TaskListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (projectId) params.set("projectId", projectId);
  return fetchJSON<TaskListResponse>(`/tasks?${params.toString()}`);
}

export interface CreateTaskInput {
  member: string;
  prompt: string;
  projectId?: string;
  tweaks?: Record<string, unknown>;
}

export interface CreateTaskResponse {
  ok: boolean;
  session: Session;
}

export function createTask(input: CreateTaskInput): Promise<CreateTaskResponse> {
  return fetchJSON<CreateTaskResponse>("/tasks", { method: "POST", body: JSON.stringify(input) });
}

export function listProjects(): Promise<ProjectListResponse> {
  return fetchJSON<ProjectListResponse>("/projects");
}

export interface CreateProjectInput {
  name: string;
}

export interface CreateProjectResponse {
  ok: boolean;
  project: Project;
}

export function createProject(input: CreateProjectInput): Promise<CreateProjectResponse> {
  return fetchJSON<CreateProjectResponse>("/projects", { method: "POST", body: JSON.stringify(input) });
}

export function deleteProject(projectId: string): Promise<{ ok: boolean }> {
  return fetchJSON<{ ok: boolean }>(`/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export interface ReplyToSessionResponse {
  ok: boolean;
  session: Session;
  resumedSession: Session;
}

export function replyToSession(sessionId: string, content: string): Promise<ReplyToSessionResponse> {
  return fetchJSON<ReplyToSessionResponse>(`/tasks/${encodeURIComponent(sessionId)}/reply`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function getSession(sessionId: string): Promise<{ ok: boolean; session: Session }> {
  return fetchJSON<{ ok: boolean; session: Session }>(`/tasks/${encodeURIComponent(sessionId)}`);
}

export interface ChatMessageResponse {
  ok: boolean;
  session: Session;
}

/** Anytime human↔human chat: appends to interaction[] without moving the lifecycle. */
export function sendChatMessage(sessionId: string, content: string): Promise<ChatMessageResponse> {
  return fetchJSON<ChatMessageResponse>(`/tasks/${encodeURIComponent(sessionId)}/message`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export interface SteerSessionResponse {
  ok: boolean;
  session: Session;
  interrupted?: true;
}

/** Human steer: rewrites a queued prompt, or aborts a running session first. */
export function steerSession(sessionId: string, content: string): Promise<SteerSessionResponse> {
  return fetchJSON<SteerSessionResponse>(`/tasks/${encodeURIComponent(sessionId)}/steer`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export interface CancelSessionResponse {
  ok: boolean;
  status: string;
  session: Session;
}

/** Interrupt: best-effort abort of a running session (async-ack, 202). */
export function cancelSession(sessionId: string): Promise<CancelSessionResponse> {
  return fetchJSON<CancelSessionResponse>(`/tasks/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
  });
}

export interface RoomMember {
  id: string;
  name: string;
  joinedAt: string;
}

/**
 * Live roster of the WS room. Poll this — the browser cannot hold a socket
 * (the BFF cannot proxy WS upgrades and the gate token stays server-side),
 * so presence reads through the same BFF forwarding as every other call.
 */
export function getRoomMembers(sessionId: string): Promise<{ ok: boolean; members: RoomMember[] }> {
  return fetchJSON<{ ok: boolean; members: RoomMember[] }>(`/sessions/${encodeURIComponent(sessionId)}/room/members`);
}