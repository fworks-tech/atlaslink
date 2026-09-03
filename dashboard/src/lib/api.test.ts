import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, fetchJSON } from "./api";

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
});
