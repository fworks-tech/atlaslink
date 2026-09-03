export type SessionStatus = "queued" | "running" | "awaiting_input" | "succeeded" | "failed" | "cancelled";

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
  interaction?: { role: "user" | "atlas" | "member"; member?: string; at: string; content: string }[];
  nextStep?: { awaiting_input: boolean; prompt?: string; member?: string } | null;
  // unified ask_human payload behind nextStep.prompt; drives the inbox question + context + composer
  question?: { question: string; context?: string };
  // parked session this follow-up continues (linked-session resume)
  resumeOf?: string;
  diagram?: { nodes: { id: string; type: string; position: { x: number; y: number } }[]; edges: { id: string; source: string; target: string }[]; mode: string } | null;
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