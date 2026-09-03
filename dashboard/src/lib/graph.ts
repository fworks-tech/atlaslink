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

/**
 * dagre reserves per node kind. Reasoning/tool footprints match the rendered
 * minima (ReasoningNode/ToolNode: min-w-[160px], p-2.5 + header + up to three
 * text rows ~= 76-90px tall) — smaller reserves stacked the full-DAG chain.
 */
export const NODE_FOOTPRINTS = {
  atlas: { width: 176, height: 72 },
  session: { width: 240, height: 118 },
  member: { width: 128, height: 36 },
  reasoning: { width: 160, height: 92 },
  tool: { width: 160, height: 76 },
  decision: { width: 120, height: 120 },
  awaiting: { width: 260, height: 92 },
  terminal: { width: 128, height: 40 },
} as const;

const ATLAS_WIDTH = NODE_FOOTPRINTS.atlas.width;
const ATLAS_HEIGHT = NODE_FOOTPRINTS.atlas.height;
const SESSION_WIDTH = NODE_FOOTPRINTS.session.width;
const SESSION_HEIGHT = NODE_FOOTPRINTS.session.height;
const MEMBER_WIDTH = NODE_FOOTPRINTS.member.width;
const MEMBER_HEIGHT = NODE_FOOTPRINTS.member.height;
const TOOL_WIDTH = NODE_FOOTPRINTS.tool.width;
const TOOL_HEIGHT = NODE_FOOTPRINTS.tool.height;
const REASONING_WIDTH = NODE_FOOTPRINTS.reasoning.width;
const REASONING_HEIGHT = NODE_FOOTPRINTS.reasoning.height;
const DECISION_WIDTH = NODE_FOOTPRINTS.decision.width;
const DECISION_HEIGHT = NODE_FOOTPRINTS.decision.height;
const AWAITING_WIDTH = NODE_FOOTPRINTS.awaiting.width;
const AWAITING_HEIGHT = NODE_FOOTPRINTS.awaiting.height;
const TERMINAL_WIDTH = NODE_FOOTPRINTS.terminal.width;
const TERMINAL_HEIGHT = NODE_FOOTPRINTS.terminal.height;

export interface SocietyGraph {
  nodes: Node[];
  edges: Edge[];
}

export type GraphMode = "chain" | "fanout" | "full";

/**
 * Project the live sessions onto the society diagram (ADR-002/ADR-003):
 * Atlas as the root node, one session node per delegation map, and the members
 * that ran for each session as a chain beneath it, laid out as a top-down tree
 * via dagre. The active member pulses while its session runs. Pure — the canvas
 * component just renders it.
 */
export function buildSocietyGraph(
  sessions: Session[],
  events: BridgeEvent[],
  opts?: { mode?: GraphMode; selectedSessionId?: string }
): SocietyGraph {
  const mode = opts?.mode ?? "chain";
  const selectedId = opts?.selectedSessionId;
  // Source of truth for isolation: isolate post-withLiveUpdates so a
  // session.created tail event for an unselected session never rehydrates.
  // View pre-filtering (SocietyDiagram) is a performance pre-filter only.
  const liveAll = withLiveUpdates(sessions, events);
  const isolatedLive = selectedId ? liveAll.filter((s) => s.sessionId === selectedId) : liveAll;
  const live = isolatedLive;

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
    if (mode === "fanout") {
      for (const member of chain) {
        graph.setNode(memberId(session.sessionId, member), {
          width: MEMBER_WIDTH,
          height: MEMBER_HEIGHT,
        });
        graph.setEdge(session.sessionId, memberId(session.sessionId, member));
      }
    } else {
      for (let i = 0; i < chain.length; i++) {
        graph.setNode(memberId(session.sessionId, chain[i]), {
          width: MEMBER_WIDTH,
          height: MEMBER_HEIGHT,
        });
        graph.setEdge(
          i === 0 ? session.sessionId : memberId(session.sessionId, chain[i - 1]),
          memberId(session.sessionId, chain[i]),
        );
      }
    }

    // Full DAG extras: tools, decisions, awaiting/terminal anchored after the chain
    if (mode === "full") {
      const artifacts = artifactsFor(session.correlationId, events);
      let last = chain.length > 0 ? memberId(session.sessionId, chain[chain.length - 1]) : session.sessionId;
      // reasoning hex nodes (coalesced by step, one per step group)
      const byStep = new Map<number, BridgeEvent[]>();
      for (const r of artifacts.reasoning) {
        const s = typeof r.step === "number" ? (r.step as number) : 0;
        const arr = byStep.get(s) ?? [];
        arr.push(r);
        byStep.set(s, arr);
      }
      for (const [step] of [...byStep.entries()].sort((a, b) => a[0] - b[0])) {
        const id = `${session.sessionId}::reasoning::${step}`;
        graph.setNode(id, { width: REASONING_WIDTH, height: REASONING_HEIGHT });
        graph.setEdge(last, id);
        last = id;
      }
      for (const pair of artifacts.toolPairs) {
        const pairId = typeof (pair.called as unknown as Record<string, unknown>).pairId === "string" ? String((pair.called as unknown as Record<string, unknown>).pairId) : "";
        const name = typeof pair.called.name === "string" ? (pair.called.name as string) : "tool";
        const step = typeof pair.called.step === "number" ? String(pair.called.step) : "0";
        const member = typeof pair.called.member === "string" ? String(pair.called.member) : "";
        const base = pairId ? `pair::${pairId}` : `${member}::${name}::${step}`;
        let id = `${session.sessionId}::tool::${base}`;
        // parallel same-step/name tools: avoid collision via suffix
        let suffix = 0;
        while (graph.hasNode(id)) {
          suffix += 1;
          id = `${session.sessionId}::tool::${base}::${suffix}`;
        }
        graph.setNode(id, { width: TOOL_WIDTH, height: TOOL_HEIGHT });
        graph.setEdge(last, id);
        last = id;
      }
      for (const d of artifacts.decisions) {
        const did = typeof d.decisionId === "string" ? (d.decisionId as string) : typeof d.eventId === "number" ? String(d.eventId) : "dec";
        const id = `${session.sessionId}::decision::${did}`;
        graph.setNode(id, { width: DECISION_WIDTH, height: DECISION_HEIGHT });
        graph.setEdge(last, id);
        last = id;
      }
      if (session.status === "awaiting_input") {
        const id = `${session.sessionId}::awaiting`;
        graph.setNode(id, { width: AWAITING_WIDTH, height: AWAITING_HEIGHT });
        graph.setEdge(last, id);
      } else if (["succeeded", "failed", "cancelled"].includes(session.status)) {
        const id = `${session.sessionId}::terminal`;
        graph.setNode(id, { width: TERMINAL_WIDTH, height: TERMINAL_HEIGHT });
        graph.setEdge(last, id);
      } else if (artifacts.reasoning.length === 0 && artifacts.toolPairs.length === 0 && artifacts.decisions.length === 0 && chain.length === 0) {
        // keep single session node clean when no extras
      }
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
    if (mode === "fanout") {
      for (const member of chain) {
        const mp = graph.node(memberId(session.sessionId, member));
        nodes.push({
          id: memberId(session.sessionId, member),
          type: "member",
          position: { x: mp.x - MEMBER_WIDTH / 2, y: mp.y - MEMBER_HEIGHT / 2 },
          data: { member, sessionId: session.sessionId, correlationId: session.correlationId, active: session.status === "running" && chain[chain.length - 1] === member },
        });
        edges.push({ id: `handoff-${session.sessionId}-${member}`, source: session.sessionId, target: memberId(session.sessionId, member), markerEnd: { type: MarkerType.ArrowClosed } });
      }
    } else {
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

    if (mode === "full") {
      const artifacts = artifactsFor(session.correlationId, events);
      // reasoning
      const byStep = new Map<number, BridgeEvent[]>();
      for (const r of artifacts.reasoning) {
        const s = typeof r.step === "number" ? (r.step as number) : 0;
        const arr = byStep.get(s) ?? [];
        arr.push(r);
        byStep.set(s, arr);
      }
      for (const [step] of [...byStep.entries()].sort((a, b) => a[0] - b[0])) {
        const id = `${session.sessionId}::reasoning::${step}`;
        if (!graph.hasNode(id)) continue;
        const p = graph.node(id);
        nodes.push({ id, type: "reasoning", position: { x: p.x - REASONING_WIDTH / 2, y: p.y - REASONING_HEIGHT / 2 }, data: { sessionId: session.sessionId, step, events: byStep.get(step)! } });
        edges.push({ id: `edge-${id}`, source: graph.predecessors(id)?.[0] ?? session.sessionId, target: id });
      }
      // render tool nodes in same stable order as layout phase
      let toolCursor = 0;
      const toolRenderOrder: string[] = [];
      {
        const seenLayout = new Set<string>();
        for (const pair of artifacts.toolPairs) {
          const pairId = typeof (pair.called as unknown as Record<string, unknown>).pairId === "string" ? String((pair.called as unknown as Record<string, unknown>).pairId) : "";
          const name = typeof pair.called.name === "string" ? (pair.called.name as string) : "tool";
          const step = typeof pair.called.step === "number" ? String(pair.called.step) : "0";
          const member = typeof pair.called.member === "string" ? String(pair.called.member) : "";
          const base = pairId ? `pair::${pairId}` : `${member}::${name}::${step}`;
          let id = `${session.sessionId}::tool::${base}`;
          let suffix = 0;
          while (seenLayout.has(id)) { suffix += 1; id = `${session.sessionId}::tool::${base}::${suffix}`; }
          seenLayout.add(id);
          if (graph.hasNode(id)) toolRenderOrder.push(id);
        }
      }
      for (const pair of artifacts.toolPairs) {
        const id = toolRenderOrder[toolCursor++];
        if (!id || !graph.hasNode(id)) continue;
        const p = graph.node(id);
        nodes.push({ id, type: "tool", position: { x: p.x - TOOL_WIDTH / 2, y: p.y - TOOL_HEIGHT / 2 }, data: { pair, sessionId: session.sessionId } });
        edges.push({ id: `edge-${id}`, source: graph.predecessors(id)?.[0] ?? session.sessionId, target: id });
      }
      for (const d of artifacts.decisions) {
        const did = typeof d.decisionId === "string" ? (d.decisionId as string) : typeof d.eventId === "number" ? String(d.eventId) : "dec";
        const id = `${session.sessionId}::decision::${did}`;
        if (!graph.hasNode(id)) continue;
        const p = graph.node(id);
        nodes.push({ id, type: "decision", position: { x: p.x - DECISION_WIDTH / 2, y: p.y - DECISION_HEIGHT / 2 }, data: { event: d, sessionId: session.sessionId } });
        edges.push({ id: `edge-${id}`, source: graph.predecessors(id)?.[0] ?? session.sessionId, target: id });
      }
      if (session.status === "awaiting_input") {
        const id = `${session.sessionId}::awaiting`;
        if (graph.hasNode(id)) {
          const p = graph.node(id);
          nodes.push({ id, type: "awaiting", position: { x: p.x - AWAITING_WIDTH / 2, y: p.y - AWAITING_HEIGHT / 2 }, data: { session } });
          edges.push({ id: `edge-${id}`, source: graph.predecessors(id)?.[0] ?? session.sessionId, target: id });
        }
      } else if (["succeeded", "failed", "cancelled"].includes(session.status)) {
        const id = `${session.sessionId}::terminal`;
        if (graph.hasNode(id)) {
          const p = graph.node(id);
          nodes.push({ id, type: "terminal", position: { x: p.x - TERMINAL_WIDTH / 2, y: p.y - TERMINAL_HEIGHT / 2 }, data: { session } });
          edges.push({ id: `edge-${id}`, source: graph.predecessors(id)?.[0] ?? session.sessionId, target: id });
        }
      }
      // dedupe edges already added via graph earlier — we rebuild from nodes; extra edges already covered, but add any remaining graph edges not yet in array
      for (const e of graph.edges()) {
        const exists = edges.some((ed) => ed.source === e.v && ed.target === e.w);
        if (!exists && e.v !== "atlas" && live.some((s) => s.sessionId === e.v || e.v.startsWith(s.sessionId + "::"))) {
          edges.push({ id: `${e.v}->${e.w}`, source: e.v, target: e.w });
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * Reconcile a fresh dagre layout with live canvas state. The projection wins
 * for data and membership (departed ids are pruned); the layout wins for
 * position except ids the user dragged, which keep their canvas position so
 * live rebuilds self-heal instead of stacking on stale coordinates.
 */
export function mergeNodesWithLayout(current: Node[], next: Node[], pinnedIds: ReadonlySet<string>): Node[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  const merged: Node[] = [];
  for (const n of next) {
    const existing = byId.get(n.id);
    if (!existing) {
      merged.push(n);
      continue;
    }
    merged.push({
      ...n,
      position: pinnedIds.has(n.id) ? existing.position : n.position,
      width: existing.width ?? n.width,
      height: existing.height ?? n.height,
      selected: existing.selected ?? n.selected,
      style: existing.style ?? n.style,
      measured: existing.measured ?? n.measured,
    });
  }
  return merged;
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

function artifactsFor(
  correlationId: string,
  events: BridgeEvent[]
): { reasoning: BridgeEvent[]; toolPairs: { called: BridgeEvent; result: BridgeEvent | null }[]; decisions: BridgeEvent[] } {
  const reasoning: BridgeEvent[] = [];
  const called: BridgeEvent[] = [];
  const results: BridgeEvent[] = [];
  const decisions: BridgeEvent[] = [];
  for (const e of events) {
    if (e.correlationId !== correlationId) continue;
    if (e.type === "reasoning") reasoning.push(e);
    else if (e.type === "tool.called") called.push(e);
    else if (e.type === "tool.result") results.push(e);
    else if (e.type === "decision.recorded") decisions.push(e);
  }
  const pairKey = (e: BridgeEvent): string => {
    const pid = typeof (e as Record<string, unknown>).pairId === "string" ? String((e as Record<string, unknown>).pairId) : "";
    if (pid) return pid;
    const step = typeof e.step === "number" ? String(e.step) : "0";
    const name = typeof e.name === "string" ? String(e.name) : "tool";
    return `${step}::${name}`;
  };
  const byKey = new Map<string, BridgeEvent>();
  for (const c of called) byKey.set(pairKey(c), c);
  const toolPairs: { called: BridgeEvent; result: BridgeEvent | null }[] = [];
  for (const c of called) toolPairs.push({ called: c, result: results.find((r) => pairKey(r) === pairKey(c)) ?? null });
  for (const r of results) if (!called.some((c) => pairKey(c) === pairKey(r))) toolPairs.push({ called: r, result: null });
  return { reasoning, toolPairs, decisions };
}