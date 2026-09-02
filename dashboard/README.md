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

Open http://localhost:3001. The browser stays same-origin: every `/api/*`
request is handled by `src/app/api/[...path]/route.ts`, a small BFF proxy that
forwards to the daemon and injects the gate token **server-side** (so no secret
ever ships in the client bundle; `next.config.ts` rewrites cannot set request
headers, hence the route handler). SSE streams back through it verbatim.

`ATLASLINK_API_URL` and `ATLASLINK_API_TOKEN` configure the proxy (see
`.env.example`). The loopback default is unauthenticated per the auth gate
contract (`src/api/auth.ts`). In production on Vercel (`atlas.flabs.tech`)
`ATLASLINK_API_URL` points at the Render backend; the BFF proxy forwards
`ATLASLINK_API_TOKEN` server-side.

Render free tier sleeps after ~15m idle (cold start 15–30s). The dashboard
polls `GET /api/health` (`hooks/useBackendHealth.ts`, 7s timeout, 1.5s while
waking / 15s while healthy) and shows a blocking overlay
(`components/BackendWakingOverlay.tsx`) until the backend is healthy. The BFF
`src/app/api/[...path]/route.ts` upstream `fetch` has a 30s timeout and maps
timeouts to `504` so the overlay can distinguish waking from down.

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