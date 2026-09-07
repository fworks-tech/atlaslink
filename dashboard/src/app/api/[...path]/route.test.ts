import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

// The route captures env at import time, so set it before importing.
process.env.ATLASLINK_API_URL = "http://daemon.test:9999";
process.env.ATLASLINK_API_TOKEN = "secret-token";

const { GET, POST } = await import("./route");

type Ctx = { params: Promise<{ path: string[] }> };

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

function ctx(...path: string[]): Ctx {
  return { params: Promise.resolve({ path }) };
}

function stubDaemonFetch(response: () => Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard BFF proxy", () => {
  it("forwards /api/tasks to the daemon /v1 surface, preserving the query string", async () => {
    const fetchMock = stubDaemonFetch(() => Response.json({ ok: true }));

    const res = await GET(
      request("http://localhost:3000/api/tasks?status=active&limit=5"),
      ctx("tasks")
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://daemon.test:9999/v1/tasks?status=active&limit=5");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("forwards /api/health to the unversioned daemon root", async () => {
    const fetchMock = stubDaemonFetch(() => Response.json({ ok: true }));

    await GET(request("http://localhost:3000/api/health"), ctx("health"));

    expect(String(fetchMock.mock.calls[0][0])).toBe("http://daemon.test:9999/health");
  });

  it("forwards nested session paths under /v1", async () => {
    const fetchMock = stubDaemonFetch(() => Response.json([]));

    await GET(
      request("http://localhost:3000/api/sessions/s-42/room/members"),
      ctx("sessions", "s-42", "room", "members")
    );

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://daemon.test:9999/v1/sessions/s-42/room/members"
    );
  });

  it("injects the bearer token and strips hop-by-hop request headers", async () => {
    const fetchMock = stubDaemonFetch(() => Response.json({ ok: true }));

    const req = request("http://localhost:3000/api/tasks", {
      method: "GET",
      headers: { cookie: "session=leak", "x-client": "dash" },
    });
    await GET(req, ctx("tasks"));

    const headers: Headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.get("authorization")).toBe("Bearer secret-token");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-client")).toBe("dash");
    expect(headers.get("host")).toBeNull();
  });

  it("forwards POST bodies with their content type", async () => {
    const fetchMock = stubDaemonFetch(() => Response.json({ ok: true }, { status: 201 }));

    const req = request("http://localhost:3000/api/tasks/s-1/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    await POST(req, ctx("tasks", "s-1", "reply"));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://daemon.test:9999/v1/tasks/s-1/reply");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"text":"hi"}');
    expect(init.headers.get("content-type")).toBe("application/json");
  });

  it("passes upstream status and headers through without leaking set-cookie", async () => {
    stubDaemonFetch(() =>
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: {
          "content-type": "application/json",
          "x-daemon": "yes",
          "set-cookie": "daemon=secret; Path=/",
        },
      })
    );

    const res = await GET(request("http://localhost:3000/api/tasks/s-1"), ctx("tasks", "s-1"));

    expect(res.status).toBe(404);
    expect(res.headers.get("x-daemon")).toBe("yes");
    expect(res.headers.get("set-cookie")).toBeNull();
    await expect(res.json()).resolves.toEqual({ error: "not found" });
  });

  it("returns 504 when the daemon is unreachable within the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out", "TimeoutError");
      })
    );

    const res = await GET(request("http://localhost:3000/api/tasks"), ctx("tasks"));

    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects non-forwardable methods with 405", async () => {
    const fetchMock = stubDaemonFetch(() => Response.json({ ok: true }));

    const res = await GET(
      request("http://localhost:3000/api/tasks", { method: "HEAD" }),
      ctx("tasks")
    );

    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
