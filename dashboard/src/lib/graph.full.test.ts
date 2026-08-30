import { describe, it, expect } from "vitest";
import { buildSocietyGraph } from "@/lib/graph";
import type { Session, BridgeEvent } from "@/lib/types";

function sess(id: string, cor: string, status: Session["status"] = "running"): Session {
  return { sessionId: id, correlationId: cor, status, version: 1, createdAt: "2026-08-28T12:00:00.000Z", task: { member: "the-mediator", prompt: `prompt ${id}` } };
}
function ev(over: Partial<BridgeEvent> = {}): BridgeEvent {
  return { eventId: 1, type: "run.started", correlationId: "cor-1", member: "the-mediator", at: "2026-08-28T12:00:00.000Z", ...over } as BridgeEvent;
}

describe("buildSocietyGraph full mode", () => {
  it("adds reasoning hex + tool + decision + awaiting for awaiting_input session", () => {
    const events: BridgeEvent[] = [
      ev({ eventId: 1, type: "reasoning", step: 1, member: "the-debugger" }),
      ev({ eventId: 2, type: "reasoning", step: 1, member: "the-debugger" }),
      ev({ eventId: 3, type: "tool.called", name: "grep", step: 1, member: "the-debugger" }),
      ev({ eventId: 4, type: "tool.result", name: "grep", step: 1, member: "the-debugger" }),
      ev({ eventId: 5, type: "decision.recorded", decisionId: "dec-1" }),
    ];
    const graph = buildSocietyGraph([sess("ses-1", "cor-1", "awaiting_input")], events, { mode: "full" });
    expect(graph.nodes.some((n) => n.type === "reasoning")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "tool")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "decision")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "awaiting")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "terminal")).toBe(false);
  });
  it("adds terminal not awaiting for succeeded", () => {
    const graph = buildSocietyGraph([sess("ses-1", "cor-1", "succeeded")], [], { mode: "full" });
    expect(graph.nodes.some((n) => n.type === "terminal")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "awaiting")).toBe(false);
  });
  it("deduplicates parallel same-step tools via pairId suffix", () => {
    const events: BridgeEvent[] = [
      ev({ eventId: 1, type: "tool.called", name: "grep", step: 1, member: "the-debugger", pairId: "a" } as unknown as BridgeEvent),
      ev({ eventId: 2, type: "tool.called", name: "grep", step: 1, member: "the-debugger", pairId: "b" } as unknown as BridgeEvent),
    ];
    const graph = buildSocietyGraph([sess("ses-1", "cor-1", "running")], events, { mode: "full" });
    const tools = graph.nodes.filter((n) => n.type === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0].id).not.toBe(tools[1].id);
  });
  it("fanout mode fans session->members", () => {
    const events = [ev({ member: "the-mediator" }), ev({ eventId: 2, member: "the-debugger" })];
    const graph = buildSocietyGraph([sess("ses-1", "cor-1")], events, { mode: "fanout" });
    expect(graph.edges.filter((e) => e.source === "ses-1")).toHaveLength(2);
  });
});
