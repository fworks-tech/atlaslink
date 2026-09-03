import { describe, it, expect } from "vitest";
import { NODE_FOOTPRINTS, buildSocietyGraph, mergeNodesWithLayout } from "@/lib/graph";
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

  // True rendered minima, measured from the component classes (no DOM measuring):
  // ReasoningNode: min-w-[160px], p-2.5 + header + line-clamp-2 + optional summary ~= 90px.
  // ToolNode: min-w-[160px], p-2.5 + header + name + status ~= 72px.
  it("reserves true rendered sizes for reasoning and tool nodes", () => {
    expect(NODE_FOOTPRINTS.reasoning).toEqual({ width: 160, height: 92 });
    expect(NODE_FOOTPRINTS.tool).toEqual({ width: 160, height: 76 });
  });

  function fullChain(): ReturnType<typeof buildSocietyGraph> {
    const ses1: BridgeEvent[] = [
      ev({ eventId: 1, type: "reasoning", step: 1, member: "the-debugger", content: "why" }),
      ev({ eventId: 2, type: "reasoning", step: 2, member: "the-debugger", content: "why not" }),
      ev({ eventId: 3, type: "tool.called", name: "grep", step: 2, member: "the-debugger", pairId: "a" } as unknown as BridgeEvent),
      ev({ eventId: 4, type: "tool.result", name: "grep", step: 2, member: "the-debugger", pairId: "a" } as unknown as BridgeEvent),
      ev({ eventId: 5, type: "tool.called", name: "grep", step: 2, member: "the-debugger", pairId: "b" } as unknown as BridgeEvent),
      ev({ eventId: 6, type: "decision.recorded", decisionId: "dec-1" }),
    ];
    const ses2: BridgeEvent[] = [
      ev({ eventId: 7, type: "tool.called", name: "sed", step: 1, member: "the-builder", correlationId: "cor-2", pairId: "c" } as unknown as BridgeEvent),
    ];
    return buildSocietyGraph(
      [sess("ses-1", "cor-1", "running"), sess("ses-2", "cor-2", "running")],
      [...ses1, ...ses2],
      { mode: "full" },
    );
  }

  it("separates consecutive full-DAG nodes by reserved heights + ranksep", () => {
    const graph = fullChain();
    const center = (id: string): number => {
      const n = graph.nodes.find((m) => m.id === id)!;
      const kind = n.type as keyof typeof NODE_FOOTPRINTS;
      return n.position.y + NODE_FOOTPRINTS[kind].height / 2;
    };
    const gap = (upper: string, lower: string): number => center(lower) - center(upper);
    const size = (kind: keyof typeof NODE_FOOTPRINTS): number => NODE_FOOTPRINTS[kind].height;
    expect(gap("ses-1::reasoning::1", "ses-1::reasoning::2")).toBe((size("reasoning") + size("reasoning")) / 2 + 72);
    expect(gap("ses-1::reasoning::2", "ses-1::tool::pair::a")).toBe((size("reasoning") + size("tool")) / 2 + 72);
    expect(gap("ses-1::tool::pair::a", "ses-1::tool::pair::b")).toBe((size("tool") + size("tool")) / 2 + 72);
    expect(gap("ses-1::tool::pair::b", "ses-1::decision::dec-1")).toBe((size("tool") + size("decision")) / 2 + 72);
  });

  it("never overlaps full-DAG node footprints", () => {
    const graph = fullChain();
    const rects = graph.nodes.map((n) => {
      const kind = n.type as keyof typeof NODE_FOOTPRINTS;
      const size = NODE_FOOTPRINTS[kind];
      return { id: n.id, x: n.position.x, y: n.position.y, w: size.width, h: size.height };
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });
});

describe("mergeNodesWithLayout", () => {
  const node = (id: string, x: number, y: number) => ({ id, position: { x, y }, data: {} });
  it("heals stale positions for unpinned nodes and lands fresh ids on the layout", () => {
    const merged = mergeNodesWithLayout(
      [node("a", 0, 0)],
      [node("a", 0, 500), node("b", 0, 600)],
      new Set(),
    );
    expect(merged.find((n) => n.id === "a")!.position).toEqual({ x: 0, y: 500 });
    expect(merged.find((n) => n.id === "b")!.position).toEqual({ x: 0, y: 600 });
  });
  it("keeps user-dragged positions and prunes departed ids", () => {
    const merged = mergeNodesWithLayout(
      [
        { ...node("a", 10, 10), selected: true },
        node("gone", 0, 0),
      ],
      [{ ...node("a", 0, 500), selected: false }],
      new Set(["a"]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].position).toEqual({ x: 10, y: 10 });
    expect(merged[0].selected).toBe(true);
  });
});
