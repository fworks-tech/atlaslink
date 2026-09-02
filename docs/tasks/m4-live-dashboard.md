# M4 Live Dashboard — Task Breakdown

**Source of truth:** `docs/architecture/README.md` (roadmap), ADR-002 (live
projection of society provenance), ADR-003 (Atlas as root node).
**Issue:** #7 (feat(dashboard): add live member run-update UI)
**Status:** Shipped — Branches 0–7 merged to `main` (#58 `661c992` projects, #63 `76232ff` FULL DAG, #64 `7b02cd2` `force-dynamic`). Isolation polish in progress — `fix/issue-7-isolate-session-diagram` (#7: empty composer when unselected, isolate by `sessionId`).

M4 renders the live society diagram: **Atlas** (root node) holds a growing "sky
of sessions"; each session is a delegation graph whose nodes are Agenthood
members, edges are handoffs, and colors are gate status (ADR-002/ADR-003). The
dashboard is a **read-only projection** of the event bridge — it consumes the
same REST + SSE surface the backend already serves (`src/api/tasks.ts`,
`src/bridge/sseEndpoint.ts`).

## Sample flow

"Fix issue X" — the reference orchestration the diagram must render live:

```
Atlas → Session("Fix issue #42")
  → The Mediator (route the request)
  → The Debugger (root-cause the bug)
  → The Builder (patch the guard)
  → The Tester (regression coverage)
  → The Reviewer (approve the diff)
```

> FULL DAG: 7 prompt archetypes (understand, fix, feature, refactor, audit, onboarding, performance) with `mermaid flowchart TD` + geometric symbols (hex tool, diamond decision, dashed awaiting, terminal) → [docs/diagrams/full-dag-case-studies.md](../diagrams/full-dag-case-studies.md). Deep-link: `https://atlas.flabs.tech/project/<project>/session/<session>?mode=full` or `?q=<base64url>` via `dashboard/src/lib/shareLink.ts`.

## Branch plan (learning-oriented)

Each branch is small, self-contained, and teaches one core concept. Branches
stack on the Fastify backend on `main` (shipped M3). The dashboard lives in
`dashboard/` with its own `package.json`; backend `src/` stays untouched.

### Branch 0 — `feat/projects-backend` (backend)
- `projects` table + `sessions` directory table (maintained projection).
- `POST/GET /projects`, `GET /projects/:projectId` — project CRUD.
- `projectId` on `SessionEvent` + `SessionFilter` — project-scoped listing.
- `POST /tasks` accepts `projectId` — sessions belong to projects.
- `GET /projects/:projectId/events` — project-scoped SSE.
- `SessionBackend` port extended: `listProjects()`, `getProject()`, `createProject()`.
- All three backends implement project methods.
- Learning: maintained projections, transactional upserts, event-sourced workspace model.

### Branch 1 — `feat/7-nextjs-scaffold`
- Next.js 16 (App Router) + Tailwind v4 shell in `dashboard/`.
- `next.config.ts` rewrites: `/api/*` → `http://127.0.0.1:3000/*` so the browser
  stays same-origin (no CORS surface; backend stays loopback-bound).
- Dev server on port **3001** (daemon owns 3000).
- Root layout: dark sidebar ("Atlas holds the sky") + content area.
- Home page: static preview of the sample flow — establishes the visual language
  (node cards, status colors) before live data exists.
- Quality gates: `npm run lint`, `npm run typecheck`.
- Learning: Next.js file-system routing, layouts vs pages, rewrites as a dev
  proxy, Tailwind v4 `@theme` tokens.

### Branch 2 — `feat/7-api-client`
- `lib/types.ts`: `Session`, `SessionEvent`, `BridgeEnvelope` mirroring the
  backend wire contract.
- `lib/api.ts`: typed `fetchJSON` wrapper for `GET /tasks` (+ optional bearer).
- `hooks/useSessions.ts`: loads the session list.
- `hooks/useEvents.ts`: `EventSource` to `/api/events` with reconnect/backoff and
  a `connected` flag surfaced in the sidebar.
- Verify SSE actually streams through the Next.js rewrite proxy; if the dev proxy
  buffers, fall back to a Route Handler that pipes the daemon stream.
- Learning: fetch + abort handling, custom hooks, the EventSource API,
  reconnection state machines.

### Branch 3 — `feat/7-session-list`
- `components/SessionList.tsx`: live-updating list of sessions from
  `useSessions` + `useEvents`.
- `components/StatusBadge.tsx`: queued/running/succeeded/failed/cancelled colors.
- New-task form (`POST /tasks`) so the demo can spawn flows without curl.
- Learning: controlled state from two data sources, optimistic UI, form
  handling in React 19 + App Router.

### Branch 4 — `feat/7-society-diagram`
- Install `@xyflow/react` (React Flow 12) + `dagre` layout.
- Custom node types: `AtlasNode`, `SessionNode`, `MemberNode`.
- Transform sessions → nodes/edges: Atlas → sessions → members from `run.*`
  history.
- Learning: React Flow data model (`Node`/`Edge`), custom node components,
  tree layout algorithms, pan/zoom/minimap.

### Branch 5 — `feat/7-live-diagram`
- Wire `useEvents` into the diagram: `session.created` adds a session node,
  `run.started` adds a member node + edge, terminal events recolor gate status.
- CSS pulse on active nodes.
- Learning: event→state mapping, immutable graph updates, re-render scoping.

### Branch 6 — `feat/7-drill-down`
- Click a session node → `/project/:projectId/session/:sessionId` (redirect to `/?project=&session=`): metadata + per-session event timeline
  via `GET /api/events/:id` (replay-then-live); also `/s/:token` (`?q=<b64url({p,s,n,m})>`).
- Client routing with `next/link`/`useRouter`, dynamic segments, `params` as
  Promise (Next 16), `Suspense` around `useSearchParams`.
- Learning: dynamic routes, per-session SSE consumption, drill-down UX, share-link encoding.

### Branch 7 — `feat/full-dag-builder` (FULL DAG)
- `POST /tasks/:id/reply` + `session.awaiting_input`/`user_reply` + docked reply composer; diagram grows on Atlas question.
- Geometric nodes: `ToolNode` hex, `DecisionNode` diamond, `Reasoning` hex, `Awaiting` stadium dashed, `Terminal` octagon; `buildSocietyGraph({mode:"full"})` with fanout support `?mode=fanout`.
- Drawer inspector + thread view (bidirectional highlight), deep-link `/project/:p/session/:s` + `?q=<b64url>` share.
- Docs: `docs/diagrams/full-dag-case-studies.md` 7 mermaid FULL DAGs.

### Branch 8 — `feat/render-waking-overlay` (Render cold start)

- `hooks/useBackendHealth.ts`: poll `GET /api/health` with `AbortSignal.timeout(7000)`, treat `502/503/504` or `>2.5s` TTFB as waking, healthy on fast `200`, escalate to `down` after 3 consecutive failures. Interval `1.5s` while waking/`15s` while healthy, single loop with `inFlight` guard.
- `lib/api.ts`: `fetchJSON(path, {timeoutMs})` via `AbortSignal.any` fallback, maps `TimeoutError`/`AbortError` → `ApiError(504)`.
- `app/api/[...path]/route.ts`: upstream `fetch` with `AbortSignal.timeout(30000)` and `504` mapping (covers Render 15–30s wake without 500).
- `components/BackendWakingOverlay.tsx`: `fixed inset-0 z-[200]` blocking overlay (`role="dialog" aria-modal`, live `status` on subtitle only, 800ms grace for `unknown` to avoid flash), mounted once in `app/layout.tsx`.
- Tests: `hooks/useBackendHealth.test.tsx`, `components/BackendWakingOverlay.test.tsx`.
- Learning: cold-start detection, `AbortSignal` timeout composition, `jsdom` compat (`AbortSignal.any` fallback), accessible blocking overlays.

## Cross-branch invariants

- **Backend extended only for FULL DAG:** dashboard is read-only except `POST /tasks/:id/reply` + `session.awaiting_input`/`user_reply` + `diagram` stub + `DELETE /projects/:projectId` (+ `deleteProject` on port) — ADR-004 event-sourced.
- **Read-only projection (ADR-002):** the UI renders what the event bridge
  records; no bespoke telemetry.
- **Hermetic:** dashboard dev is offline-safe (system fonts, no Google font
  fetch); lint + typecheck are the quality gates per branch.
- **Auth posture:** loopback dev is unauthenticated by design; token handling is
  documented in `.env.example` and wired only when the daemon gate is armed.