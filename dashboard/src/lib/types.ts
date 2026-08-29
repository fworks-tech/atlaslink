export type SessionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Session {
  sessionId: string;
  correlationId: string;
  status: SessionStatus;
  version: number;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  projectId?: string;
  task: { member: string; prompt: string };
  tweaks?: Record<string, unknown>;
  output?: string;
  error?: string;
  durationMs?: number;
}

export interface TaskListResponse {
  ok: boolean;
  sessions: Session[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Broadly-typed bridge envelope, mirroring the backend's EventLogStore type.
 * The SSE stream emits one envelope per frame; `type` is the discriminator and
 * remaining fields vary per event (session.*, run.*, reasoning, decision.*…).
 */
export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProjectListResponse {
  ok: boolean;
  projects: Project[];
}

export interface BridgeEvent {
  eventId: number;
  type: string;
  correlationId?: string;
  at?: string;
  [key: string]: unknown;
}