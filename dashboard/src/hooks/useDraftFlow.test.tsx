import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDraftFlow } from "./useDraftFlow";
import { loadDraftFlow } from "@/lib/draftFlow";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useDraftFlow", () => {
  it("adds a draft node and persists it per session", () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useDraftFlow(id), {
      initialProps: { id: "ses-1" },
    });
    expect(result.current.draftNodes).toEqual([]);
    act(() => {
      result.current.addDraftNode("member", { x: 10, y: 20 });
    });
    expect(result.current.draftNodes).toHaveLength(1);
    expect(loadDraftFlow("ses-1").nodes).toHaveLength(1);

    rerender({ id: "ses-2" });
    expect(result.current.draftNodes).toEqual([]);
    act(() => {
      result.current.connectDraft("draft-1", "ses-2");
    });
    expect(result.current.draftEdges).toHaveLength(1);
    expect(loadDraftFlow("ses-2").edges).toHaveLength(1);
  });
});
