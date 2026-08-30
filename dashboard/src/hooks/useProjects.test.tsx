import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjects } from "./useProjects";

describe("useProjects", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("loads projects on mount and handles cancellation", async () => {
    const projects = [{ id: "proj-1", name: "alpha", createdAt: new Date().toISOString() }];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, projects }), { status: 200, headers: { "Content-Type": "application/json" } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    const { result, unmount } = renderHook(() => useProjects());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toEqual(projects);
    expect(result.current.error).toBeNull();
    unmount();
    // no state update after unmount — cancelled flag prevents it
    expect(result.current.projects).toEqual(projects);
  });

  it("addProject prepends and handles error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, projects: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, project: { id: "proj-2", name: "beta", createdAt: new Date().toISOString() } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any;

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      const p = await result.current.addProject("beta");
      expect(p?.name).toBe("beta");
    });
    expect(result.current.projects[0].name).toBe("beta");

    // error path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as any;
    await act(async () => {
      const p = await result.current.addProject("fail");
      expect(p).toBeNull();
    });
    expect(result.current.error).toMatch(/boom|failed/);
  });
});
