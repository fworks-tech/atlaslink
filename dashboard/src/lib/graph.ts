import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { BridgeEvent, Session } from "@/lib/types";
import { withLiveUpdates } from "@/lib/sessionProjection";

export interface SessionNodeData {
  session: Session;
  /** Members that ran for this session, in first-seen order (the delegation chain). */
  members: string[];
  [key: string]: unknown;
}

export type AtlasGraphNode = Node<Record<string, never>, "atlas">;
export type SessionGraphNode = Node<SessionNodeData, "session">;

const ATLAS_WIDTH = 176;
const ATLAS_HEIGHT = 72;
const SESSION_WIDTH = 240;
const SESSION_HEIGHT = 118;

export interface SocietyGraph {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Project the live sessions onto the society diagram (ADR-002/ADR-003):
 * Atlas as the root node, one session node per delegation map, laid out as a
 * top-down tree via dagre. Pure — the canvas component just renders it.
 */
export function buildSocietyGraph(sessions: Session[], events: BridgeEvent[]): SocietyGraph {
  const live = withLiveUpdates(sessions, events);

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 72 });

  graph.setNode("atlas", { width: ATLAS_WIDTH, height: ATLAS_HEIGHT });
  for (const session of live) {
    graph.setNode(session.sessionId, { width: SESSION_WIDTH, height: SESSION_HEIGHT });
    graph.setEdge("atlas", session.sessionId);
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
    ...live.map((session): SessionGraphNode => {
      const placed = graph.node(session.sessionId);
      return {
        id: session.sessionId,
        type: "session",
        position: { x: placed.x - SESSION_WIDTH / 2, y: placed.y - SESSION_HEIGHT / 2 },
        data: { session, members: membersFor(session.correlationId, events) },
      };
    }),
  ];

  const edges: Edge[] = live.map((session) => ({
    id: `atlas-${session.sessionId}`,
    source: "atlas",
    target: session.sessionId,
  }));

  return { nodes, edges };
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