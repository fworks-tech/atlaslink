import type { Edge, Node, XYPosition } from "@xyflow/react";
import { DEFAULT_CONFIG } from "@/lib/config";

export const DRAFT_ID_PREFIX = "draft-";

export interface DraftFlowState {
  nodes: Node[];
  edges: Edge[];
}

const EMPTY: DraftFlowState = { nodes: [], edges: [] };

export const AGENT_PALETTE: Array<{ type: string; label: string }> = [
  { type: "member", label: "Member" },
  { type: "reasoning", label: "Reasoning" },
  { type: "tool", label: "Tool" },
  { type: "decision", label: "Decision" },
];

export function isDraftId(id: string): boolean {
  return id.startsWith(DRAFT_ID_PREFIX);
}

let draftCounter = 0;

export function createDraftNode(agentType: string, position: XYPosition): Node {
  draftCounter += 1;
  const label = AGENT_PALETTE.find((p) => p.type === agentType)?.label ?? agentType;
  return {
    id: `${DRAFT_ID_PREFIX}${Date.now().toString(36)}-${draftCounter}`,
    type: agentType,
    position: { x: position.x, y: position.y },
    data: { label: `New ${label}`, draft: true, config: { ...DEFAULT_CONFIG } },
  };
}

export function createDraftEdge(source: string, target: string): Edge {
  draftCounter += 1;
  return { id: `${DRAFT_ID_PREFIX}edge-${Date.now().toString(36)}-${draftCounter}`, source, target };
}

export function draftStorageKey(sessionId: string): string {
  return `atlaslink:draft-flow:${sessionId}`;
}

function isStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function loadDraftFlow(sessionId: string): DraftFlowState {
  if (!isStorageAvailable()) return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(draftStorageKey(sessionId));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<DraftFlowState>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return { ...EMPTY };
    return { nodes: parsed.nodes, edges: parsed.edges };
  } catch {
    return { ...EMPTY };
  }
}

export function saveDraftFlow(sessionId: string, state: DraftFlowState): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(draftStorageKey(sessionId), JSON.stringify(state));
  } catch {
    // ephemeral overlay state — a full or blocked store must not break the canvas
  }
}

// Drafts union after the projection merge: the projection owns live nodes,
// the caller owns drafts, and the id prefix keeps the two from colliding.
export function withDrafts(projected: Node[], drafts: Node[]): Node[] {
  if (drafts.length === 0) return projected;
  const liveIds = new Set(projected.map((n) => n.id));
  return [...projected, ...drafts.filter((d) => !liveIds.has(d.id))];
}
