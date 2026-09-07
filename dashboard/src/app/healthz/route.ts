const API_URL = process.env.ATLASLINK_API_URL ?? "http://127.0.0.1:3000";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lives at /healthz, NOT /api/health: that path is the BFF's proxy to the
// daemon's own /health, which the status widget in the UI polls. A static
// route there would shadow the proxy. The dashboard has no database — its
// only external dependency is the daemon, so that is what gets checked.
export async function GET(): Promise<Response> {
  let daemon: Record<string, unknown>;
  try {
    const res = await fetch(`${API_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    daemon = { status: res.ok ? "up" : "down", httpStatus: res.status };
  } catch {
    daemon = { status: "unreachable" };
  }
  return Response.json({
    ok: true,
    service: "atlaslink-dashboard",
    uptimeSeconds: Math.round(process.uptime()),
    dependencies: { daemon },
  });
}
