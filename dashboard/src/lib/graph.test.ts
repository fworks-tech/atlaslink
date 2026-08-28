import { describe, it, expect } from "vitest";
import { MarkerType } from "@xyflow/react";
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

function event(over: Partial<BridgeEvent> = {}): BridgeEvent {
  return {
    eventId: 1,
    type: "run.started",
    correlationId: "cor-1",
    member: "the-mediator",
    at: "2026-08-28T12:00:00.000Z",
    ...over,
  } as BridgeEvent;
}

function memberNodesOf(graph: ReturnType<typeof buildSocietyGraph>): { id: string; active: boolean; member: string }[] {
  return graph.nodes
    .filter((n) => n.type === "member")
    .map((n) => ({
      id: n.id,
      active: (n.data as { active: boolean }).active,
      member: (n.data as { member: string }).member,
    }));
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

  it("extracts the delegation chain in first-seen, deduplicated order", () => {
    const events: BridgeEvent[] = [
      event({ eventId: 1, member: "the-mediator" }),
      event({ eventId: 2, type: "reasoning", member: "the-debugger" }),
      event({ eventId: 3, type: "run.started", member: "the-debugger" }),
      event({ eventId: 4, type: "tool.called", member: "the-builder" }),
    ];
    const graph = buildSocietyGraph([session("ses-1", "cor-1")], events);
    const sessionNode = graph.nodes.find((n) => n.id === "ses-1");
    expect((sessionNode?.data as { members: string[] }).members).toEqual([
      "the-mediator",
      "the-debugger",
      "the-builder",
    ]);
  });

  it("renders one member node per chain member with hand-off edges", () => {
    const events = [
      event({ eventId: 1, member: "the-mediator" }),
      event({ eventId: 2, member: "the-debugger" }),
    ];
    const graph = buildSocietyGraph([session("ses-1", "cor-1")], events);
    const members = memberNodesOf(graph);
    expect(members.map((m) => m.member)).toEqual(["the-mediator", "the-debugger"]);
    expect(graph.edges).toEqual([
      { id: "atlas-ses-1", source: "atlas", target: "ses-1" },
      {
        id: "handoff-ses-1-0",
        source: "ses-1",
        target: "ses-1::the-mediator",
        markerEnd: { type: MarkerType.ArrowClosed },
      },
      {
        id: "handoff-ses-1-1",
        source: "ses-1::the-mediator",
        target: "ses-1::the-debugger",
        markerEnd: { type: MarkerType.ArrowClosed },
      },
    ]);
  });

  it("marks only the last member active while the session runs", () => {
    const events = [
      event({ eventId: 1, member: "the-mediator" }),
      event({ eventId: 2, member: "the-debugger" }),
    ];
    const graph = buildSocietyGraph([session("ses-1", "cor-1")], events);
    const members = memberNodesOf(graph);
    expect(members.map((m) => m.active)).toEqual([false, true]);
  });

  it("marks the sole member of a single-member running session as active", () => {
    const graph = buildSocietyGraph([session("ses-1", "cor-1")], [
      event({ eventId: 1, member: "the-mediator" }),
    ]);
    const members = memberNodesOf(graph);
    expect(members).toHaveLength(1);
    expect(members[0].active).toBe(true);
  });

  it("marks no member active on a finished session", () => {
    const events = [
      event({ eventId: 1, member: "the-mediator" }),
      event({ eventId: 2, member: "the-debugger" }),
    ];
    const graph = buildSocietyGraph([session("ses-1", "cor-1", "succeeded")], events);
    const members = memberNodesOf(graph);
    expect(members.every((m) => m.active === false)).toBe(true);
  });

  it("ignores events from other correlations", () => {
    const events = [
      event({ eventId: 1, correlationId: "cor-other", member: "the-librarian" }),
    ];
    const graph = buildSocietyGraph([session("ses-1", "cor-1")], events);
    const sessionNode = graph.nodes.find((n) => n.id === "ses-1");
    expect((sessionNode?.data as { members: string[] }).members).toEqual([]);
    expect(memberNodesOf(graph)).toHaveLength(0);
  });

  it("assigns finite positions and lays the tree top-down (Atlas above all)", () => {
    const graph = buildSocietyGraph(
      [session("ses-1", "cor-1", "succeeded"), session("ses-2", "cor-2", "succeeded")],
      [event({ eventId: 1, member: "the-mediator" })],
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