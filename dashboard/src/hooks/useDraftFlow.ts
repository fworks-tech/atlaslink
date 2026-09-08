"use client";

import { useCallback, useEffect, useState } from "react";
import { applyNodeChanges, type Edge, type Node, type NodeChange, type XYPosition } from "@xyflow/react";
import { createDraftEdge, createDraftNode, loadDraftFlow, saveDraftFlow } from "@/lib/draftFlow";

export function useDraftFlow(sessionId: string) {
  const [state, setState] = useState(() => loadDraftFlow(sessionId));
  // Reset overlay state when the session changes — adjusting state during
  // render is the React-recommended pattern for "reset when a prop changes".
  const [loadedSession, setLoadedSession] = useState(sessionId);
  if (sessionId !== loadedSession) {
    setLoadedSession(sessionId);
    setState(loadDraftFlow(sessionId));
  }

  useEffect(() => {
    if (!sessionId) return;
    saveDraftFlow(sessionId, state);
  }, [sessionId, state]);

  const addDraftNode = useCallback((agentType: string, position: XYPosition) => {
    setState((s) => ({ ...s, nodes: [...s.nodes, createDraftNode(agentType, position)] }));
  }, []);

  const connectDraft = useCallback((source: string, target: string) => {
    setState((s) => ({ ...s, edges: [...s.edges, createDraftEdge(source, target)] }));
  }, []);

  const applyDraftChanges = useCallback((changes: NodeChange[]) => {
    setState((s) => ({ ...s, nodes: applyNodeChanges(changes, s.nodes) }));
  }, []);

  return {
    draftNodes: state.nodes as Node[],
    draftEdges: state.edges as Edge[],
    addDraftNode,
    connectDraft,
    applyDraftChanges,
  };
}
