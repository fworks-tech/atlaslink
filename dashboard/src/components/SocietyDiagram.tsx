"use client";

import { useEffect, useMemo, useState } from "react";
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

export function SocietyDiagram({
  selectedSessionId,
  mode = "full",
  onNodeClick,
}: {
  selectedSessionId?: string;
  mode?: GraphMode;
  onNodeClick?: (nodeId: string, type: string, data: unknown) => void;
}) {
  const { sessions, loading } = useSessions();
  const { events } = useEvents();
  const filteredSessions = useMemo(
    () => (selectedSessionId ? sessions.filter((s) => s.sessionId === selectedSessionId) : sessions),
    [sessions, selectedSessionId]
  );
  const [debouncedSessions, setDebouncedSessions] = useState(filteredSessions);
  const [debouncedEvents, setDebouncedEvents] = useState(events);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSessions(filteredSessions);
      setDebouncedEvents(events);
    }, 100);
    return () => clearTimeout(id);
  }, [filteredSessions, events]);

  const { nodes: nextNodes, edges: nextEdges } = useMemo(
    () => buildSocietyGraph(debouncedSessions, debouncedEvents, { mode }),
    [debouncedSessions, debouncedEvents, mode],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(nextNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(nextEdges);

  // The projection wins for data (a session's status/members move on) and for
  // membership (nodes the projection no longer yields are pruned — a wrapped
  // event buffer drops an early chain); the user wins for position. Edges are
  // derived, so fully replaced.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      for (const next of nextNodes) {
        const existing = byId.get(next.id);
        byId.set(next.id, existing ? { ...next, position: existing.position } : next);
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