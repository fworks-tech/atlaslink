import type { NextConfig } from "next";

const API_PROXY_TARGET = process.env.ATLASLINK_API_URL ?? "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  // The Fastify daemon owns /tasks, /events, /runs, /health on its own port.
  // The browser only ever talks same-origin to Next.js, so there is no CORS
  // surface and the backend stays loopback-bound (ADR-006, auth gate fail-closed).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_PROXY_TARGET}/:path*` }];
  },
};

export default nextConfig;