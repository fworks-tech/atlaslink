"use client";

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSessions } from "@/hooks/useSessions";
import { useEvents } from "@/hooks/useEvents";
import { buildSocietyGraph } from "@/lib/graph";
import { AtlasNode } from "@/components/AtlasNode";
import { SessionNode } from "@/components/SessionNode";

const nodeTypes = { atlas: AtlasNode, session: SessionNode };

export function SocietyDiagram() {
  const { sessions, loading } = useSessions();
  const { events } = useEvents();
  const { nodes: nextNodes, edges: nextEdges } = useMemo(
    () => buildSocietyGraph(sessions, events),
    [sessions, events],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(nextNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(nextEdges);

  // The projection wins for data (a session's status/members move on); the
  // user wins for position — existing nodes keep where they were dragged.
  // Edges are derived, so fully replaced.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      for (const next of nextNodes) {
        const existing = byId.get(next.id);
        byId.set(next.id, existing ? { ...next, position: existing.position } : next);
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