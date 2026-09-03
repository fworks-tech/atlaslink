import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSessions } from "./useSessions";

describe("useSessions", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("loads sessions on mount", async () => {
    const sessions = [
      {
        sessionId: "ses-1",
        correlationId: "cor-1",
        status: "queued",
        version: 1,
        task: { member: "the-mediator", prompt: "hello" },
      },
    ];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, sessions, total: 1, limit: 50, offset: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual(sessions);
    expect(result.current.error).toBeNull();
    expect(result.current.total).toBe(1);
  });

  it("surfaces fetch errors", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as unknown as typeof fetch;
    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/boom|failed/);
  });

  it("refresh re-fetches", async () => {
    const first = [{ sessionId: "ses-1", correlationId: "cor-1", status: "queued", version: 1, task: { member: "m", prompt: "p" } }];
    const second = [...first, { sessionId: "ses-2", correlationId: "cor-2", status: "queued", version: 1, task: { member: "m", prompt: "q" } }];
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, sessions: first, total: 1, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, sessions: second, total: 2, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toHaveLength(1);
    await waitFor(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
  });

  it("hydrateSession merges a deep-linked row into the list", async () => {
    const single = { sessionId: "ses-9", correlationId: "cor-9", status: "running", version: 1, task: { member: "m", prompt: "p" } };
    const updated = { ...single, status: "succeeded" };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, sessions: [], total: 0, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, session: single }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, session: updated }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toHaveLength(0);
    await waitFor(async () => {
      await result.current.hydrateSession("ses-9");
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await waitFor(async () => {
      await result.current.hydrateSession("ses-9");
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.sessions[0].status).toBe("succeeded");
  });

  it("hydrateSession records the error and rethrows when the row 404s", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, sessions: [], total: 0, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "unknown session" }), { status: 404, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.hydrateSession("ses-9")).rejects.toThrow("404 unknown session");
    await waitFor(() => expect(result.current.error).toMatch(/404/));
    expect(result.current.sessions).toHaveLength(0);
  });

  it("hydrateSession bumps the total when appending a new row", async () => {
    const single = { sessionId: "ses-9", correlationId: "cor-9", status: "running", version: 1, task: { member: "m", prompt: "p" } };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, sessions: [], total: 0, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, session: single }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(async () => {
      await result.current.hydrateSession("ses-9");
    });
    await waitFor(() => expect(result.current.total).toBe(1));
  });
});
