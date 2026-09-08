"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type OnNodesChange,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { buildSocietyGraph, mergeNodesWithLayout } from "@/lib/graph";
import { DRAG_MIME } from "@/components/NodePalette";
import { isDraftId, withDrafts } from "@/lib/draftFlow";
import { AtlasNode } from "@/components/AtlasNode";
import { SessionNode } from "@/components/SessionNode";
import { MemberNode } from "@/components/MemberNode";
import { ReasoningNode } from "@/components/ReasoningNode";
import { ToolNode } from "@/components/ToolNode";
import { DecisionNode } from "@/components/DecisionNode";
import { AwaitingNode } from "@/components/AwaitingNode";
import { TerminalNode } from "@/components/TerminalNode";
import type { GraphMode } from "@/lib/graph";

const nodeTypes = {
  atlas: AtlasNode,
  session: SessionNode,
  member: MemberNode,
  reasoning: ReasoningNode,
  tool: ToolNode,
  decision: DecisionNode,
  awaiting: AwaitingNode,
  terminal: TerminalNode,
} as unknown as NodeTypes;

const DEBOUNCE_MS = 100;

const NODE_COLORS: Record<string, string> = {
  atlas: "#818cf8",
  session: "#38bdf8",
  member: "#fbbf24",
  reasoning: "#a78bfa",
  tool: "#34d399",
  decision: "#f472b6",
  awaiting: "#fbbf24",
  terminal: "#64748b",
};

export function SocietyDiagram({
  selectedSessionId,
  mode = "full",
  onNodeClick,
  selectedNodeId,
  draftNodes = [],
  draftEdges = [],
  onDraftDrop,
  onDraftConnect,
  onDraftNodesChange,
}: {
  selectedSessionId: string;
  mode?: GraphMode;
  onNodeClick?: (nodeId: string, type: string, data: unknown) => void;
  selectedNodeId?: string;
  // Composer overlay (#106): caller-owned draft nodes unioned after the
  // projection merge, so live rebuilds can neither prune nor absorb them.
  draftNodes?: Node[];
  draftEdges?: Edge[];
  onDraftDrop?: (agentType: string, position: XYPosition) => void;
  onDraftConnect?: (source: string, target: string) => void;
  onDraftNodesChange?: OnNodesChange;
}) {
  const { sessions, loading } = useSessions();
  const { events } = useEvents();

  // Stable correlationId for the selected session — derive from the session row
  // when loaded, fall back to buffered events so the chain renders before the
  // session fetch resolves (avoids transient empty chain on hard-reload).
  const selectedCorrelationId = useMemo(
    () => sessions.find((s) => s.sessionId === selectedSessionId)?.correlationId,
    [sessions, selectedSessionId],
  );
  const cidFromEvents = useMemo(() => {
    if (selectedCorrelationId) return selectedCorrelationId;
    const seeded = events.find((e) => e.sessionId === selectedSessionId)?.correlationId;
    return typeof seeded === "string" && seeded.length > 0 ? seeded : undefined;
  }, [events, selectedSessionId, selectedCorrelationId]);

  const filteredSessions = useMemo(
    () => sessions.filter((s) => s.sessionId === selectedSessionId),
    [sessions, selectedSessionId],
  );
  // Contract: view pre-filters by correlationId for performance; buildSocietyGraph
  // is the source of truth for isolation (post-withLiveUpdates, no rehydration).
  const filteredEvents = useMemo(() => {
    if (!cidFromEvents) return events.filter((e) => e.sessionId === selectedSessionId);
    return events.filter((e) => e.correlationId === cidFromEvents || e.sessionId === selectedSessionId);
  }, [events, selectedSessionId, cidFromEvents]);
  const [debouncedSessions, setDebouncedSessions] = useState(filteredSessions);
  const [debouncedEvents, setDebouncedEvents] = useState(filteredEvents);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSessions(filteredSessions);
      setDebouncedEvents(filteredEvents);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filteredSessions, filteredEvents]);

  const { nodes: nextNodes, edges: nextEdges } = useMemo(
    () => buildSocietyGraph(debouncedSessions, debouncedEvents, { mode, selectedSessionId }),
    [debouncedSessions, debouncedEvents, mode, selectedSessionId],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(nextNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(nextEdges);

  // Ids the user positioned by hand — the only live nodes that keep canvas
  // positions across rebuilds. Draft nodes are caller-owned and skip this
  // tracker entirely, so they can't pin themselves into the projection.
  const draggedRef = useRef(new Set<string>());
  const handleNodesChange: OnNodesChange = (changes) => {
    const draftChanges = changes.filter((c) => "id" in c && isDraftId(c.id));
    const liveChanges = changes.filter((c) => !("id" in c) || !isDraftId(c.id));
    if (draftChanges.length > 0) onDraftNodesChange?.(draftChanges);
    if (liveChanges.length === 0) return;
    for (const c of liveChanges) {
      if (c.type === "position" && c.dragging && "id" in c) draggedRef.current.add(c.id);
      if (c.type === "remove" && "id" in c) draggedRef.current.delete(c.id);
    }
    onNodesChange(liveChanges);
  };

  const handleConnect = (connection: Connection) => {
    const { source, target } = connection;
    if (!source || !target || !onDraftConnect) return;
    if (isDraftId(source) || isDraftId(target)) onDraftConnect(source, target);
  };

  // The projection wins for data (a session's status/members move on) and for
  // membership (nodes the projection no longer yields are pruned — a wrapped
  // event buffer drops an early chain); the layout wins for position except
  // user-dragged nodes, so live rebuilds self-heal instead of stacking new
  // nodes onto stale coordinates. The user still wins for size and selection
  // (so resize handles don't vanish on live updates). Edges are derived.
  useEffect(() => {
    const nextIds = new Set(nextNodes.map((n) => n.id));
    for (const id of [...draggedRef.current]) {
      if (!nextIds.has(id)) draggedRef.current.delete(id);
    }
    setNodes((current) => mergeNodesWithLayout(current, nextNodes, draggedRef.current));
  }, [nextNodes, setNodes]);

  useEffect(() => {
    setEdges(nextEdges);
  }, [nextEdges, setEdges]);

  // Deep-link hydration: when ?node= names a node that exists in the built
  // graph, surface its payload via onNodeClick once per id so reload restores
  // the same inspector detail without requiring a second click. Depends on the
  // memoised projection (not live node state) so drags/selections don't retrigger.
  const hydratedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!selectedNodeId || !onNodeClick || hydratedRef.current.has(selectedNodeId)) return;
    const match = nextNodes.find((n) => n.id === selectedNodeId);
    if (match) {
      hydratedRef.current.add(selectedNodeId);
      onNodeClick(match.id, match.type ?? "unknown", match.data);
    }
  }, [selectedNodeId, nextNodes, onNodeClick]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted">Loading diagram…</p>;
  }

  // Drafts union after the projection at render time — the projection owns
  // `nodes`, the caller owns `draftNodes`, and the id prefix keeps them
  // distinct. Computing here (not in state) means a fresh draft array on
  // each parent render can't loop the merge effect.
  const visibleNodes = withDrafts(nodes, draftNodes);

  return (
    <ReactFlowProvider>
      <Dropzone onDraftDrop={onDraftDrop}>
        <ReactFlow
          // remount per session so fitView re-centers on the isolated chain
          key={selectedSessionId}
          nodes={visibleNodes}
          edges={[...edges, ...draftEdges]}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onNodeClick={(_, node) => onNodeClick?.(node.id, node.type ?? "unknown", node.data)}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          snapToGrid
          snapGrid={[8, 8]}
          deleteKeyCode={null}
          colorMode="dark"
        >
          <Background gap={16} size={1} color="#ffffff14" />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => NODE_COLORS[n.type ?? ""] ?? "#64748b"}
            className="!bg-raised"
            maskColor="rgba(10, 14, 26, 0.7)"
          />
        </ReactFlow>
      </Dropzone>
    </ReactFlowProvider>
  );
}

// Drop target inside the flow provider so palette drops convert to flow
// coordinates. Without an agent payload (or without a composer handler) the
// drop is ignored and the live canvas is untouched.
function Dropzone({
  onDraftDrop,
  children,
}: {
  onDraftDrop?: (agentType: string, position: XYPosition) => void;
  children: React.ReactNode;
}) {
  const { screenToFlowPosition } = useReactFlow();
  return (
    <div
      data-testid="flow-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        const agentType = e.dataTransfer?.getData(DRAG_MIME);
        if (!agentType || !onDraftDrop) return;
        e.preventDefault();
        onDraftDrop(agentType, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
      className="h-[480px] overflow-hidden rounded-xl border border-white/5 bg-surface"
    >
      {children}
    </div>
  );
}