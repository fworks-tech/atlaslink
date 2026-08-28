import { describe, it, expect } from "vitest";
import { buildSocietyGraph } from "@/lib/graph";
import type { Session, BridgeEvent } from "@/lib/types";

function session(id: string, correlation: string, status: Session["status"] = "running"): Session {
  return {
    sessionId: id,
    correlationId: correlation,
    status,
    version: 1,
    createdAt: `2026-08-28T12:0${id === "ses-1" ? 0 : 5}:00.000Z`,
    task: { member: "the-mediator", prompt: `prompt for ${id}` },
  };
}

describe("buildSocietyGraph", () => {
  it("returns just the Atlas node (with no edges) when there are no sessions", () => {
    const graph = buildSocietyGraph([], []);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ id: "atlas", type: "atlas" });
    expect(graph.edges).toEqual([]);
  });

  it("places one session node per session with an Atlas edge and live status", () => {
    const graph = buildSocietyGraph([session("ses-1", "cor-1")], []);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([{ id: "atlas-ses-1", source: "atlas", target: "ses-1" }]);
    const sessionNode = graph.nodes.find((n) => n.id === "ses-1");
    expect((sessionNode?.data as { session: Session }).session.status).toBe("running");
  });

  it("extracts the member chain in first-seen, deduplicated order", () => {
    const events: BridgeEvent[] = [
      { eventId: 1, type: "run.started", correlationId: "cor-1", member: "the-mediator" },
      { eventId: 2, type: "reasoning", correlationId: "cor-1", member: "the-debugger" },
      { eventId: 3, type: "run.started", correlationId: "cor-1", member: "the-debugger" },
      { eventId: 4, type: "tool.called", correlationId: "cor-1", member: "the-builder" },
    ] as BridgeEvent[];
    const graph = buildSocietyGraph([session("ses-1", "cor-1")], events);
    const sessionNode = graph.nodes.find((n) => n.id === "ses-1");
    expect((sessionNode?.data as { members: string[] }).members).toEqual([
      "the-mediator",
      "the-debugger",
      "the-builder",
    ]);
  });

  it("ignores events from other correlations", () => {
    const events = [
      { eventId: 1, type: "run.started", correlationId: "cor-other", member: "the-librarian" },
    ] as BridgeEvent[];
    const graph = buildSocietyGraph([session("ses-1", "cor-1")], events);
    const sessionNode = graph.nodes.find((n) => n.id === "ses-1");
    expect((sessionNode?.data as { members: string[] }).members).toEqual([]);
  });

  it("assigns finite positions and lays the tree top-down (Atlas above sessions)", () => {
    const graph = buildSocietyGraph(
      [session("ses-1", "cor-1"), session("ses-2", "cor-2")],
      [],
    );
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      expect(node.position.x >= 0).toBe(true);
      expect(node.position.y >= 0).toBe(true);
    }
    const atlasY = graph.nodes.find((n) => n.id === "atlas")!.position.y;
    for (const node of graph.nodes) {
      if (node.id === "atlas") continue;
      expect(node.position.y).toBeGreaterThan(atlasY);
    }
  });
});