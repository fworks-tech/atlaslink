import type { NextConfig } from "next";

// The /api/* surface is handled by src/app/api/[...path]/route.ts — a proxy to
// the Fastify daemon that injects the gate token server-side. (next.config
// rewrites cannot set request headers, so the BFF route handler owns auth in
// both dev and production.)
const nextConfig: NextConfig = {
  // Turbopack's workspace-root auto-detection picks the repo root (it wins the
  // multi-lockfile heuristic), which breaks module resolution for this app's
  // routes. Pin the dashboard as the project root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;