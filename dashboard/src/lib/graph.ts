import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { BridgeEvent, Session } from "@/lib/types";
import { withLiveUpdates } from "@/lib/sessionProjection";

export interface SessionNodeData {
  session: Session;
  /** Members that ran for this session, in first-seen order (the delegation chain). */
  members: string[];
  [key: string]: unknown;
}

export interface MemberNodeData {
  member: string;
  sessionId: string;
  correlationId: string;
  /**
   * Heuristic: the last distinct member to enter a running session's chain is
   * assumed to hold the podium (ADR-003) until the bridge emits a holder event.
   */
  active: boolean;
  [key: string]: unknown;
}

export type AtlasGraphNode = Node<Record<string, never>, "atlas">;
export type SessionGraphNode = Node<SessionNodeData, "session">;
export type MemberGraphNode = Node<MemberNodeData, "member">;

const ATLAS_WIDTH = 176;
const ATLAS_HEIGHT = 72;
const SESSION_WIDTH = 240;
const SESSION_HEIGHT = 118;
const MEMBER_WIDTH = 128;
const MEMBER_HEIGHT = 36;

export interface SocietyGraph {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Project the live sessions onto the society diagram (ADR-002/ADR-003):
 * Atlas as the root node, one session node per delegation map, and the members
 * that ran for each session as a chain beneath it, laid out as a top-down tree
 * via dagre. The active member pulses while its session runs. Pure — the canvas
 * component just renders it.
 */
export function buildSocietyGraph(sessions: Session[], events: BridgeEvent[]): SocietyGraph {
  const live = withLiveUpdates(sessions, events);

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 72 });

  graph.setNode("atlas", { width: ATLAS_WIDTH, height: ATLAS_HEIGHT });
  const chains = new Map<string, string[]>();
  for (const session of live) {
    const chain = membersFor(session.correlationId, events);
    chains.set(session.sessionId, chain);
    graph.setNode(session.sessionId, { width: SESSION_WIDTH, height: SESSION_HEIGHT });
    graph.setEdge("atlas", session.sessionId);
    for (let i = 0; i < chain.length; i++) {
      graph.setNode(memberId(session.sessionId, chain[i]), {
        width: MEMBER_WIDTH,
        height: MEMBER_HEIGHT,
      });
      // The delegation chain hand-off: session -> first member -> next member…
      graph.setEdge(
        i === 0 ? session.sessionId : memberId(session.sessionId, chain[i - 1]),
        memberId(session.sessionId, chain[i]),
      );
    }
  }
  dagre.layout(graph);

  const atlas = graph.node("atlas");
  const nodes: Node[] = [
    {
      id: "atlas",
      type: "atlas",
      position: { x: atlas.x - ATLAS_WIDTH / 2, y: atlas.y - ATLAS_HEIGHT / 2 },
      data: {},
    },
  ];

  const edges: Edge[] = [];
  for (const session of live) {
    const placed = graph.node(session.sessionId);
    nodes.push({
      id: session.sessionId,
      type: "session",
      position: { x: placed.x - SESSION_WIDTH / 2, y: placed.y - SESSION_HEIGHT / 2 },
      data: { session, members: chains.get(session.sessionId)! },
    });
    edges.push({ id: `atlas-${session.sessionId}`, source: "atlas", target: session.sessionId });

    const chain = chains.get(session.sessionId)!;
    for (let i = 0; i < chain.length; i++) {
      const memberPlacement = graph.node(memberId(session.sessionId, chain[i]));
      nodes.push({
        id: memberId(session.sessionId, chain[i]),
        type: "member",
        position: {
          x: memberPlacement.x - MEMBER_WIDTH / 2,
          y: memberPlacement.y - MEMBER_HEIGHT / 2,
        },
        data: {
          member: chain[i],
          sessionId: session.sessionId,
          correlationId: session.correlationId,
          active: session.status === "running" && i === chain.length - 1,
        },
      });
      edges.push({
        id: `handoff-${session.sessionId}-${i}`,
        source: i === 0 ? session.sessionId : memberId(session.sessionId, chain[i - 1]),
        target: memberId(session.sessionId, chain[i]),
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    }
  }

  return { nodes, edges };
}

function memberId(sessionId: string, member: string): string {
  return `${sessionId}::${member}`;
}

/** Distinct members that ran for a correlation, in first-seen order. */
function membersFor(correlationId: string, events: BridgeEvent[]): string[] {
  const seen: string[] = [];
  for (const event of events) {
    if (event.correlationId !== correlationId) continue;
    const member = event.member;
    if (typeof member !== "string" || member.length === 0 || seen.includes(member)) continue;
    seen.push(member);
  }
  return seen;
}