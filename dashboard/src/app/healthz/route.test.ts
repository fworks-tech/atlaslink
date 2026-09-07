import { describe, it, expect, vi, afterEach } from "vitest";

import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

async function body() {
  return (await GET()).json() as Promise<Record<string, never>>;
}

describe("dashboard /healthz", () => {
  it("answers 200 with the dashboard's own health and daemon status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    const res = await GET();

    expect(res.status).toBe(200);
    const json = await body();
    expect(json).toMatchObject({
      ok: true,
      service: "atlaslink-dashboard",
      dependencies: { daemon: { status: "up", httpStatus: 200 } },
    });
  });

  it("marks the daemon down when it answers with an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));

    expect((await body()).dependencies).toEqual({
      daemon: { status: "down", httpStatus: 503 },
    });
  });

  it("marks the daemon unreachable when it cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    expect((await body()).dependencies).toEqual({ daemon: { status: "unreachable" } });
  });
});
