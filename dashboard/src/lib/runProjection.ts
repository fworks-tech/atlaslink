import type { BridgeEvent } from "./types";

export interface StepGroup {
  step: number;
  reasoning: BridgeEvent[];
  tools: BridgeEvent[];
}

export interface RunArtifacts {
  reasoning: BridgeEvent[];
  tools: BridgeEvent[];
  decisions: BridgeEvent[];
  provenance: BridgeEvent[];
  byStep: Map<number, StepGroup>;
}

function stepOf(e: BridgeEvent): number {
  return typeof e.step === "number" ? (e.step as number) : 0;
}

/** Group live bridge events by correlationId for per-session drill-down. Coalesced by step for readable stream. */
export function groupByCorrelation(events: BridgeEvent[]): Map<string, RunArtifacts> {
  const byCorr = new Map<string, BridgeEvent[]>();
  for (const e of events) {
    const cid = typeof e.correlationId === "string" ? (e.correlationId as string) : "__none";
    const arr = byCorr.get(cid) ?? [];
    arr.push(e);
    byCorr.set(cid, arr);
  }
  const out = new Map<string, RunArtifacts>();
  for (const [cid, list] of byCorr.entries()) {
    const reasoning = list.filter((e) => e.type === "reasoning");
    const tools = list.filter((e) => e.type === "tool.called" || e.type === "tool.result");
    const decisions = list.filter((e) => e.type === "decision.recorded");
    const provenance = list.filter((e) => e.type === "provenance.recorded");
    const byStep = new Map<number, StepGroup>();
    for (const e of [...reasoning, ...tools]) {
      const s = stepOf(e);
      const g = byStep.get(s) ?? { step: s, reasoning: [], tools: [] };
      if (e.type === "reasoning") g.reasoning.push(e);
      else g.tools.push(e);
      byStep.set(s, g);
    }
    out.set(cid, { reasoning, tools, decisions, provenance, byStep });
  }
  return out;
}

export function artifactsFor(correlationId: string, events: BridgeEvent[]): RunArtifacts {
  return groupByCorrelation(events).get(correlationId) ?? {
    reasoning: [],
    tools: [],
    decisions: [],
    provenance: [],
    byStep: new Map(),
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  stepCost: number;
  steps: number;
  models: string[];
  toolCalls: number;
  toolMs: number;
}

/** Totals over persisted reasoning events. Cheap client-side scan — #168 keeps
 * cost derived, not stored, until the scan measurably matters at scale. */
export function usageFor(reasoning: BridgeEvent[], tools: BridgeEvent[]): TokenUsage {
  const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, stepCost: 0, steps: 0, models: [], toolCalls: 0, toolMs: 0 };
  for (const e of reasoning) {
    const r = e as Record<string, unknown>;
    const p = typeof r.promptTokens === "number" ? r.promptTokens : 0;
    const c = typeof r.completionTokens === "number" ? r.completionTokens : 0;
    const cost = typeof r.stepCost === "number" ? r.stepCost : 0;
    if (p || c || cost) usage.steps += 1;
    usage.promptTokens += p;
    usage.completionTokens += c;
    usage.stepCost += cost;
    const model = typeof r.model === "string" ? r.model : null;
    if (model && !usage.models.includes(model)) usage.models.push(model);
  }
  for (const e of tools) {
    if (e.type === "tool.called") usage.toolCalls += 1;
    const d = (e as Record<string, unknown>).durationMs;
    if (typeof d === "number") usage.toolMs += d;
  }
  return usage;
}
