import { describe, it, expect, beforeEach } from "vitest";
import type { Node } from "@xyflow/react";
import {
  AGENT_PALETTE,
  DRAFT_ID_PREFIX,
  createDraftEdge,
  createDraftNode,
  draftStorageKey,
  isDraftId,
  loadDraftFlow,
  saveDraftFlow,
  withDrafts,
} from "./draftFlow";

function projected(id: string): Node {
  return { id, type: "session", position: { x: 0, y: 0 }, data: {} };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("draftFlow", () => {
  it("prefixes draft ids so the projection merge never confuses them with live nodes", () => {
    const node = createDraftNode("member", { x: 10, y: 20 });
    expect(node.id.startsWith(DRAFT_ID_PREFIX)).toBe(true);
    expect(isDraftId(node.id)).toBe(true);
    expect(isDraftId("ses-1")).toBe(false);
  });

  it("creates draft nodes with type, position, and label", () => {
    const node = createDraftNode("tool", { x: 30, y: 40 });
    expect(node.type).toBe("tool");
    expect(node.position).toEqual({ x: 30, y: 40 });
    expect((node.data as { label: string }).label).toContain("Tool");
  });

  it("creates draft edges between draft and live nodes", () => {
    const edge = createDraftEdge("draft-1", "ses-1");
    expect(edge.id.startsWith(DRAFT_ID_PREFIX)).toBe(true);
    expect(edge.source).toBe("draft-1");
    expect(edge.target).toBe("ses-1");
  });

  it("unions drafts after the projection without touching live nodes", () => {
    const live = [projected("ses-1")];
    const draft = createDraftNode("member", { x: 0, y: 0 });
    const merged = withDrafts(live, [draft]);
    expect(merged.map((n) => n.id)).toEqual(["ses-1", draft.id]);
    expect(merged[0]).toBe(live[0]);
  });

  it("round-trips draft state through localStorage per session", () => {
    const draft = createDraftNode("member", { x: 5, y: 6 });
    saveDraftFlow("ses-1", { nodes: [draft], edges: [createDraftEdge(draft.id, "ses-1")] });
    expect(draftStorageKey("ses-1")).toContain("ses-1");
    const loaded = loadDraftFlow("ses-1");
    expect(loaded.nodes.map((n) => n.id)).toEqual([draft.id]);
    expect(loaded.edges.map((e) => e.source)).toEqual([draft.id]);
    expect(loadDraftFlow("ses-other")).toEqual({ nodes: [], edges: [] });
  });

  it("starts empty on corrupt storage instead of throwing", () => {
    window.localStorage.setItem(draftStorageKey("ses-1"), "not-json{{{");
    expect(loadDraftFlow("ses-1")).toEqual({ nodes: [], edges: [] });
  });

  it("exposes one palette entry per creatable agent type", () => {
    expect(AGENT_PALETTE.map((p) => p.type).sort()).toEqual(["decision", "member", "reasoning", "tool"]);
  });
});
