import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, fetchJSON, getTasks, replyToSession } from "./api";

function jsonResponse(body: unknown, status = 200, statusText?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    ...(statusText ? { statusText } : {}),
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchJSON error qualification", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("prefixes a daemon 404 body with the status", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: false, error: "not found" }, 404)) as unknown as typeof fetch;
    const err = await fetchJSON("/tasks/ses-9/message", { method: "POST", body: "{}" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as Error).message).toBe("404 not found");
  });

  it("falls back to status text for non-JSON bodies", async () => {
    globalThis.fetch = vi.fn(async () => new Response("<html>oops</html>", { status: 502 })) as unknown as typeof fetch;
    const err = await fetchJSON("/tasks").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as Error).message.startsWith("502")).toBe(true);
  });

  it("falls back to status text when the JSON body has no error key", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: false }, 404, "Not Found")) as unknown as typeof fetch;
    const err = await fetchJSON("/tasks").catch((e) => e);
    expect((err as Error).message).toBe("404 Not Found");
  });

  it("leaves already-qualified messages untouched", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: false, error: "500 boom" }, 500)) as unknown as typeof fetch;
    const err = await fetchJSON("/tasks").catch((e) => e);
    expect((err as Error).message).toBe("500 boom");
  });

  it("returns the parsed body on success", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true, sessions: [], total: 0 })) as unknown as typeof fetch;
    await expect(fetchJSON("/tasks")).resolves.toEqual({ ok: true, sessions: [], total: 0 });
  });

  it("rejects a non-JSON success body as an api error", async () => {
    globalThis.fetch = vi.fn(async () => new Response("<html>ok</html>", { status: 200 })) as unknown as typeof fetch;
    const err = await fetchJSON("/tasks").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as Error).message).toBe("200 invalid JSON response");
  });

  it("maps only timeouts to the server-starting status", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    const err = await fetchJSON("/tasks", { timeoutMs: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(504);
  });

  it("rethrows caller aborts and network failures unchanged", async () => {
    const abort = new DOMException("aborted", "AbortError");
    globalThis.fetch = vi.fn(async () => {
      throw abort;
    }) as unknown as typeof fetch;
    await expect(fetchJSON("/tasks", { timeoutMs: 10 })).rejects.toBe(abort);

    const network = new TypeError("fetch failed");
    globalThis.fetch = vi.fn(async () => {
      throw network;
    }) as unknown as typeof fetch;
    await expect(fetchJSON("/tasks")).rejects.toBe(network);
  });
});

describe("request builder contract", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("getTasks encodes limit, offset, and projectId", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return jsonResponse({ ok: true, sessions: [], total: 0 });
    }) as unknown as typeof fetch;
    await getTasks(50, 0, "p-1");
    expect(seen[0].url).toBe("/api/tasks?limit=50&offset=0&projectId=p-1");
    expect("method" in (seen[0].init as object)).toBe(false);
    expect((seen[0].init?.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("replyToSession encodes hostile ids and sends JSON", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    await replyToSession("a/b c", "hi");
    expect(seen[0].url).toBe("/api/tasks/a%2Fb%20c/reply");
    expect((seen[0].init?.headers as Headers).get("Content-Type")).toBe("application/json");
    expect(seen[0].init?.body).toBe(JSON.stringify({ content: "hi" }));
  });
});
