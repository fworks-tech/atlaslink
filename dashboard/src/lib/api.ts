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
export async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
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