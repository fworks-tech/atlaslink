import { describe, expect, it } from "vitest";
import { usageFor } from "./runProjection";
import type { BridgeEvent } from "./types";

const reasoning = (extra: Record<string, unknown> = {}): BridgeEvent =>
  ({ type: "reasoning", correlationId: "cor-1", model: "m1", promptTokens: 10, completionTokens: 4, stepCost: 0.001, ...extra }) as unknown as BridgeEvent;
const tool = (type: "tool.called" | "tool.result", extra: Record<string, unknown> = {}): BridgeEvent =>
  ({ type, correlationId: "cor-1", ...extra }) as unknown as BridgeEvent;

describe("usageFor", () => {
  it("totals tokens, cost, models and tool time", () => {
    const usage = usageFor([reasoning(), reasoning({ step: 1, model: "m2" }), reasoning({ promptTokens: undefined, completionTokens: undefined, stepCost: undefined })], [tool("tool.called"), tool("tool.result", { durationMs: 1500 }), tool("tool.called", { step: 1 })]);
    expect(usage.promptTokens).toBe(20);
    expect(usage.completionTokens).toBe(8);
    expect(usage.stepCost).toBeCloseTo(0.002);
    expect(usage.steps).toBe(2);
    expect(usage.models).toEqual(["m1", "m2"]);
    expect(usage.toolCalls).toBe(2);
    expect(usage.toolMs).toBe(1500);
  });

  it("is zero for empty inputs", () => {
    expect(usageFor([], [])).toEqual({ promptTokens: 0, completionTokens: 0, stepCost: 0, steps: 0, models: [], toolCalls: 0, toolMs: 0 });
  });
});
