"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { buildSocietyGraph } from "@/lib/graph";
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

export function SocietyDiagram({
  selectedSessionId,
  mode = "full",
  onNodeClick,
  selectedNodeId,
}: {
  selectedSessionId: string;
  mode?: GraphMode;
  onNodeClick?: (nodeId: string, type: string, data: unknown) => void;
  selectedNodeId?: string;
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

  // The projection wins for data (a session's status/members move on) and for
  // membership (nodes the projection no longer yields are pruned — a wrapped
  // event buffer drops an early chain); the user wins for position, size, and
  // selection (so resize handles don't vanish on live updates).
  // Edges are derived, so fully replaced.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      for (const next of nextNodes) {
        const existing = byId.get(next.id);
        byId.set(
          next.id,
          existing
            ? {
                ...next,
                position: existing.position,
                selected: existing.selected ?? next.selected,
                style: existing.style ?? next.style,
                measured: existing.measured ?? next.measured,
              }
            : next,
        );
      }
      const nextIds = new Set(nextNodes.map((n) => n.id));
      for (const id of byId.keys()) {
        if (!nextIds.has(id)) byId.delete(id);
      }
      return [...byId.values()];
    });
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

  return (
    <div className="h-[480px] overflow-hidden rounded-xl border border-white/5 bg-surface">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onNodeClick?.(node.id, node.type ?? "unknown", node.data)}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        colorMode="dark"
      >
        <Background gap={16} size={1} color="#ffffff14" />
        <Controls />
        <MiniMap
          pannable
          zoomable
          className="!bg-raised"
          maskColor="rgba(10, 14, 26, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}