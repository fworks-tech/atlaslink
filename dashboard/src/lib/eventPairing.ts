import type { BridgeEvent } from "./types";

export interface ToolPair {
  called: BridgeEvent;
  result: BridgeEvent | null;
  latencyMs?: number;
}

function pairKey(e: BridgeEvent): string {
  const pairId = typeof e.pairId === "string" ? (e.pairId as string) : undefined;
  if (pairId) return pairId;
  const step = typeof e.step === "number" ? String(e.step) : "0";
  const name = typeof e.name === "string" ? (e.name as string) : "unknown";
  const member = typeof e.member === "string" ? (e.member as string) : "unknown";
  const correlationId = typeof e.correlationId === "string" ? (e.correlationId as string) : "none";
  return `${correlationId}::${member}::${step}::${name}`;
}

export function pairTools(events: BridgeEvent[]): ToolPair[] {
  const calledByKey = new Map<string, BridgeEvent>();
  const resultByKey = new Map<string, BridgeEvent>();
  for (const e of events) {
    if (e.type === "tool.called") calledByKey.set(pairKey(e), e);
    else if (e.type === "tool.result") resultByKey.set(pairKey(e), e);
  }
  const pairs: ToolPair[] = [];
  for (const [key, called] of calledByKey.entries()) {
    const result = resultByKey.get(key) ?? null;
    let latencyMs: number | undefined;
    if (result && typeof called.at === "string" && typeof result.at === "string") {
      const a = Date.parse(called.at as string);
      const b = Date.parse(result.at as string);
      if (!Number.isNaN(a) && !Number.isNaN(b)) latencyMs = b - a;
    }
    pairs.push({ called, result, latencyMs });
  }
  // orphan results without a call
  for (const [key, result] of resultByKey.entries()) {
    if (!calledByKey.has(key)) pairs.push({ called: result, result: null });
  }
  return pairs.sort((a, b) => {
    const aa = typeof a.called.at === "string" ? a.called.at : "";
    const bb = typeof b.called.at === "string" ? b.called.at : "";
    return String(aa).localeCompare(String(bb));
  });
}
