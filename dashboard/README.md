# Atlaslink — Live Dashboard (M4)

Next.js 16 (App Router) frontend for the Atlaslink daemon. Renders the live
society diagram — Atlas as the root node, sessions as delegation graphs — from
the Fastify backend's REST + SSE surface.

## Run

Two terminals, from the repo root:

```bash
# 1. backend daemon (Fastify, port 3000)
npm start

# 2. dashboard (Next.js dev, port 3001)
cd dashboard && npm run dev
```

Open http://localhost:3001. The dashboard proxies `/api/*` → the daemon
(`next.config.ts` rewrites), so the browser stays same-origin and the backend
needs no CORS surface. `ATLASLINK_API_URL` overrides the daemon origin; the
loopback default is unauthenticated per the auth gate contract (`src/api/auth.ts`).

## Scripts

| Script        | What                                   |
| ------------- | -------------------------------------- |
| `npm run dev` | Next.js dev server on port 3001        |
| `npm run lint`| ESLint                                 |
| `npm run typecheck` | `tsc --noEmit`                   |
| `npm run build`     | Production build                |

## Milestone status

See [`docs/tasks/m4-live-dashboard.md`](../docs/tasks/m4-live-dashboard.md) for
the branch-by-branch breakdown and learning goals.