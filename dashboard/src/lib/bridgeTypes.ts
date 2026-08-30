import type { BridgeEvent } from "./types";

export type SessionLifecycle =
  | "session.created"
  | "session.queued"
  | "session.started"
  | "session.running"
  | "session.succeeded"
  | "session.failed"
  | "session.cancelled"
  | "session.awaiting_input"
  | "session.user_reply";

export type RunEventType =
  | "run.started"
  | "reasoning"
  | "tool.called"
  | "tool.result"
  | "decision.recorded"
  | "provenance.recorded"
  | "run.finished"
  | "run.failed";

export type BridgeMeta = "bridge.gap" | "bridge.shutdown";

export interface ReasoningPayload {
  step?: number;
  content: string;
  summary?: string;
  member: string;
  correlationId: string;
  at: string;
}

export interface ToolCalledPayload {
  step?: number;
  name: string;
  args?: unknown;
  member: string;
  correlationId: string;
  at: string;
}

export interface ToolResultPayload extends ToolCalledPayload {
  output?: string;
  result?: unknown;
  durationMs?: number;
}

export function isReasoning(e: BridgeEvent): boolean {
  return e.type === "reasoning";
}
export function isToolCalled(e: BridgeEvent): boolean {
  return e.type === "tool.called";
}
export function isToolResult(e: BridgeEvent): boolean {
  return e.type === "tool.result";
}
export function isDecision(e: BridgeEvent): boolean {
  return e.type === "decision.recorded";
}
export function isAwaitingInput(e: BridgeEvent): boolean {
  return e.type === "session.awaiting_input";
}
