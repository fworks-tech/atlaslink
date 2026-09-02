import { NextRequest, NextResponse } from "next/server";

// Daemon origin, read at runtime (server-side). Dev defaults to the loopback
// daemon; Vercel sets it to the Fly.io backend URL.
const API_URL = process.env.ATLASLINK_API_URL ?? "http://127.0.0.1:3000";
// Gate token, server-side only — the browser bundle never sees it.
const API_TOKEN = process.env.ATLASLINK_API_TOKEN;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORWARDABLE = ["get", "post", "put", "patch", "delete"] as const;

// hop-by-hop headers that must not be handed back to the browser (the stream
// recomputes length; Connection/Upgrade belong to the transport, not the body;
// Content-Encoding is dropped because undici already decompressed the upstream
// body — forwarding `br` would make the browser gunzip a plain JSON payload;
// set-cookie is stripped so daemon cookies do not leak to the browser)
const STRIP_RESPONSE_HEADERS = ["connection", "keep-alive", "transfer-encoding", "upgrade", "content-length", "content-encoding", "set-cookie"];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const method = req.method.toLowerCase();
  if (!(FORWARDABLE as readonly string[]).includes(method)) {
    return NextResponse.json({ ok: false, error: "method not supported" }, { status: 405 });
  }

  const { path } = await ctx.params;
  // path may be an empty array for a bare /api request
  const target = `${API_URL}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const [key, value] of req.headers) {
    const lower = key.toLowerCase();
    if (["host", "connection", "content-length", "cookie", "x-forwarded-for", "x-real-ip"].includes(lower)) continue;
    headers.set(key, value);
  }
  // auth is injected here, so the daemon gate stays armed without ever leaking
  // the token into the client (rewrites cannot set request headers — this BFF
  // route handler is the single place /api/* auth is attached)
  if (API_TOKEN) headers.set("authorization", `Bearer ${API_TOKEN}`);

  const body = method === "get" ? undefined : await req.text();
  if (body !== undefined) headers.set("content-type", req.headers.get("content-type") ?? "application/json");

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
    // route handlers must not let the data cache treat daemon responses as static
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers) {
    if (STRIP_RESPONSE_HEADERS.includes(key.toLowerCase())) continue;
    responseHeaders.set(key, value);
  }
  // upstream.body streams — SSE frames pass through verbatim instead of buffering
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;