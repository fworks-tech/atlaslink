# Atlaslink Architecture

**Reading order:** the 5-minute version below for the whole system in one pass;
then the per-layer notes in `src/bridge/`, `src/session/`, `src/daemon/`,
`src/tasks/`; then the ADRs in [`docs/adr/`](../adr/) for each decision's
rationale. Start with ADR-001 (NDJSON event log), ADR-004 (session aggregate
durability), ADR-006 (Fastify + Postgres), ADR-008 (auth and tenancy),
ADR-011 (federation decomposition), ADR-013 (AWS deployment target).

## The 5-minute version

**What it is:** a product-oriented multi-agent orchestrator built on Agenthood
(the agent-team runtime). You compose agents like a flowchart, they run, and
every decision they make is an event you can watch live or replay later.

**One session, end to end:**

```
POST /tasks ──► SessionQueue (serial FIFO) ──► agent run (Agenthood runtime)
     │                  │  session.* lifecycle events
     │                  ▼
     │         EventLogStore + SessionBackend
     │           ├─ Postgres session_events  (source of truth, per tenant)
     │           ├─ sessions directory        (project-scoped projection)
     │           └─ NDJSON log               (run provenance, ADR-001)
     ▼
GET /events (SSE) ──► dashboard: live DAG + WebSocket room (HITL ask_human)
```

- **Writes are event-sourced.** `session.*` events are the commit; `version` is
  the optimistic CAS token; rehydration is deterministic (ADR-004). The HTTP
  layer never executes agents inline — everything routes through
  `SessionQueue` (ADR-002's projection contract).
- **Reads are projections.** The `sessions` directory table keeps project
  listings O(1); the SSE stream replays envelopes verbatim with
  `Last-Event-ID` resume and gap detection — a stale resume surfaces
  `bridge.gap`, never silence.
- **Humans are in the loop.** Agents pause on `ask_human`, park the session,
  and resume from your reply; the per-session WebSocket room lets several
  people watch and steer together (ADR-007).
- **The GraphQL surface federates over the same daemon.** Four subgraphs
  (`files`, `sessions`, `tasks`, `insights`) compose via `wgc` into one
  Cosmo router endpoint; subgraphs are bearer-gated (ADR-008) and the router
  propagates `Authorization` through to them.
- **Data model in one breath:** `session_events` (append-only, per-tenant),
  `sessions` (directory projection), `projects`, `users`, `api_keys`
  (SHA-256 hashes), `daily_cost_buckets`, `run_checkpoints` — same SQL runs
  on `pglite` in CI and managed Postgres in production.
- **Deployment:** one runtime image; Render serves production today, AWS EC2 +
  RDS serves staging via the compose overlay (ADR-013), and both are driven by
  the same post-CI deploy workflows. Tests are hermetic — 445 offline,
  no LLM, no network.

## What this is

Atlaslink is a product-oriented multi-agent orchestrator built on Agenthood (the
agent-team runtime). It runs a daemon that executes agent runs, bridges the
resulting events to browsers over SSE, and exposes a programmatic Task API over
the same event-sourced sessions.

## Layers

```
                    ┌────────────────────────────────────────────┐
                    │              server.ts (HTTP)              │  M3: Fastify (ADR-006)
                    │  routes: /health /runs /tasks /events(SSE) │
                    └───────┬───────────────┬────────────────────┘
                            │               │
                 POST /runs │               │ GET /events (Last-Event-ID resume)
                            ▼               ▼
              ┌───────────────────┐  ┌──────────────────────────────┐
              │     bridge/       │  │  bridge/sseEndpoint +      │
              │  SessionQueue ──► │  │  EventBroadcaster (fan-out │
              │  registry/driver  │  │  over the NDJSON log)      │
              └───────┬───────────┘  └──────────────┬─────────────┘
                      │ emits session.*            │ replays verbatim
                      ▼                            ▼
            ┌───────────────────────────────────────────────┐
            │        EventLogStore  (NDJSON, ADR-001)       │
            │  agent-run provenance feed; SSE replay source  │
            └───────────────────────────────────────────────┘

   M3 session layer (ADR-004/006) — wired into the HTTP server:
            ┌───────────────────────────────────────────────┐
            │  session/  SessionBackend port                │
            │   ├─ SessionStore (in-memory, shipped)        │
            │   ├─ EventLogBackend (NDJSON, shipped)        │
            │   └─ PostgresBackend (Postgres event tables,  │
            │      shipped)                                 │
            │  Db seam (pglite in CI / pg in prod)          │
            └───────────────────────────────────────────────┘
```

The federation and deployment sections below extend this picture with two more
planes: the GraphQL router plane and the deploy plane.

## The shipped runtime (M1/M2)

Two cooperating surfaces:

1. **One-shot CLI** — `atlaslink --run <member> "<task>"` creates a session in the
   in-memory `TaskRegistry`, builds a per-run `ApplicationContext` (lazily, at run
   time — never at boot), subscribes to its `RunEventBus`, executes, then finalizes
   the session from the real outcome.
2. **Daemon HTTP server** — `tsx src/server.ts` boots with config validated
   up front. Routes:
   - `GET /health` — liveness JSON with version + uptime.
   - `POST /runs` (M3 preview) — validates `{member, prompt}` by JSON schema,
     creates a session, delegates it to the serial `SessionQueue`.
   - `GET /events` — SSE stream with the reconnection contract below.
   - 404/400 envelopes are `{ ok, error }` JSON; 5xx are fail-closed.

## The Event Bridge (M2)

Everything crossing to a client is a **bridge envelope**: `{ eventId, type, ... }`.
The chain is `RunEventBus → session worker → EventBroadcaster → EventLogStore → SSE`:

- `EventBroadcaster` assigns a monotonic `eventId`, persists the envelope to the
  NDJSON log, and fans it out **verbatim** to subscribers (ADR-002 — the emitter
  owns `type`; the bridge never rewrites it).
- `EventLogStore` is the append-only, 10 MB × 3 rotating NDJSON log. The cursor is
  restored from a sidecar plus a boot-time tail scan; a failed append/rotate is
  swallowed so the live stream never blocks on disk (ADR-001, ADR-005).
- `SessionQueue` is the serial FIFO worker: sessions run one at a time, and each
  lifecycle transition is mirrored as a `session.*` event (the `RunEventBus` has no
  "queued" state, so queued sessions are only representable this way).
- `sseEndpoint` serves `GET /events` with the **reconnection contract**:
  `Last-Event-ID` resumes past the id, a stale resume surfaces `bridge.gap` (never
  silence), a 15 s `: ping` keeps idle streams alive, and graceful shutdown sends
  `bridge.shutdown` (declared in `PING_INTERVAL_MS`/`SseHandler`).

## The session layer (M3)

A `Session` is an event-sourced aggregate (ADR-004): `session.*` events are the
commit, `version` is the optimistic CAS token, and rehydration is deterministic.
The `SessionBackend` port (`src/session/sessionBackend.ts`) is implemented by the
in-memory `SessionStore`, the NDJSON `EventLogBackend`, and the `PostgresBackend`
over event tables. All backends
bind to the same behavioral contract (`backendContract`), so a swap cannot silently
change observable semantics.

**M3 shipped (ADR-006):** the HTTP layer runs on Fastify and Postgres is the primary
store. The NDJSON log is demoted to agent-run provenance; sessions persist to
Postgres event tables keyed by `tenant_id` + `session_id` (tenancy is additive —
`schema_migrations` and a `Db` seam run identical SQL on `pglite` in CI and managed
Postgres in production). The task-rest surface — `POST/GET /tasks`,
`GET /tasks/{id}`, cancel, and per-session SSE — sits behind a pre-auth bearer
gate with rate limiting, auth-rejection logging, and fail-closed boot on
non-loopback binds (PRs #44, #46).

## The projects layer (M4)

Projects are workspace containers for sessions. The projects layer adds:

- **`projects` table** — stores project metadata (`id`, `name`, `created_at`) per
  tenant. CRUD via `POST/GET /projects`, `GET /projects/:projectId` (token-gated).
- **`sessions` directory table** — a maintained projection upserted transactionally
  on each `session.created` event with `projectId`. Provides fast project-scoped
  listing without scanning the `session_events` table.
- **`projectId` on `SessionEvent`** — optional field that rides on the event. When
  present, the `PostgresBackend` maintains the directory projection on append.
- **`SessionFilter.projectId`** — when provided, the backend uses the `sessions`
  directory for O(1) project lookups instead of rehydrating all events.
- **`GET /projects/:projectId/events`** — project-scoped SSE: replays and tails
  events for all sessions belonging to a project, filtered by correlation ID set.
- **`POST /tasks` accepts `projectId`** — sessions can be created within a project.
- **`GET /tasks?projectId=...`** — project-scoped session listing with existing
  status/since/limit/offset filters.

The `SessionBackend` port is extended with `listProjects()`, `getProject()`, and
`createProject()`. All three backends implement these methods (in-memory for
`SessionStore` and `EventLogBackend`; Postgres-backed for `PostgresBackend`).

## The auth layer (P0, ADR-008)

Per-user authentication and tenant isolation (PR #185):

- **JWT sessions** — HS256 tokens via `ATLASLINK_JWT_SECRET`, 7-day expiry. Used
  by dashboard users.
- **API keys** — `ak_`-prefixed, stored as SHA-256 hashes. Used by programmatic
  consumers. `last_used_at` updated on each successful auth.
- **Legacy bearer** — `ATLASLINK_API_TOKEN` still works as a shared token fallback.
- **Tenant binding** — tenant is derived from `request.auth.tenantId`, not from
  the `x-tenant-id` header (which is rejected when auth is present).
- **Auth gate** — `registerAuthGate()` replaces `registerTokenGate()` for
  deployments that have migrated to per-user auth. Supports all three auth methods.
- **Security headers** — CSP, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy on every response.
- **Request signing** — HMAC-SHA256 for webhook payloads via
  `ATLASLINK_SIGNING_SECRET`.

Ungated routes: `/auth/register`, `/auth/login`.
Gated routes: `/auth/keys` (CRUD), `/auth/me`.

## GraphQL federation (ADR-011)

The GraphQL surface is a composed graph served by a single Cosmo router process:

```
client ──► Caddy (TLS, routes) ──► cosmo router ──┬──► /v1/graphql/files
                                                  ├──► /v1/graphql/sessions
                                                  ├──► /v1/graphql/tasks
                                                  └──► /v1/graphql/insights
                                                       (all on the daemon :3000)
```

- **Composition** — `npm run compose` runs `wgc router compose` over
  `src/subgraphs/compose.yaml` and emits the router's execution config; CI and
  the router image stage build it hermetically (pinned `wgc@0.132.2`).
- **Subgraphs** — `files`, `sessions`, `tasks`, `insights` are routes on the
  same daemon; ADR-011 records the decomposition direction (independent
  deployables tracked in #321) while keeping the REST surface as a compat
  window (ADR-011, #297).
- **Auth** — every subgraph is bearer-gated (ADR-008): an unauthenticated
  GraphQL request gets `401` rendered as a GraphQL error envelope, never
  partial data. The router forwards `Authorization` to subgraphs explicitly
  (`headers.all.request: propagate` in the router overrides — it does not
  forward it by default).
- **Workspaces** — session files live in git-backed workspace repositories
  (ADR-012), served through the `files` subgraph and the workspace HTTP
  endpoints (session-scoped paths, secret-shaped content refused).

## Deployment (ADR-013)

One image, two planes, both gated on green CI:

- **Image** — multi-stage Dockerfile: a `router` stage bakes the pinned Cosmo
  router binary, its config, and the composed execution config (hermetic — no
  network at boot); the `runtime` stage ships the daemon (Node 22, `git` for
  the files subgraph, non-root user) and is always the last stage so
  `render.yaml` builds the right target. `docker-compose.yml` pins
  `target: runtime` explicitly.
- **Render (production today)** — `render.yaml` + `deploy-render.yml`: after CI
  passes on `main`, the workflow builds and rolls the service.
- **AWS (staging, ADR-013)** — `docker-compose.aws.yml` overlays the router +
  AWS Caddyfile (`staging.atlas.flabs.tech`) on the base compose file;
  `deploy-aws.yml` runs after green CI, SSHes to the EC2 host and runs
  `docker compose up -d --build`, then polls `/health` for the provider-count
  marker. Secrets: `AWS_DEPLOY_HOST`, `AWS_DEPLOY_KEY`. Provisioning, DNS,
  RDS, SSM parameters, and the cutover checklist live in
  [`docs/runbooks/aws-deploy.md`](../runbooks/aws-deploy.md); the decision in
  [`docs/adr/ADR-013-aws-deployment-target.md`](../adr/ADR-013-aws-deployment-target.md);
  the spec in [`docs/spec/aws-deployment.md`](../spec/aws-deployment.md).
  Retiring Render/Oracle after the soak is tracked in #329.

## Logging (ADR-005)

One JSON object per line, level via `ATLASLINK_LOG_LEVEL`, `correlationId` threaded
explicitly (no implicit context). The `src/log.ts` facade is the ship contract;
Fastify runs `logger: false` and an `onResponse` hook emits the `request` envelope
through that facade so the logged shape stays fixed. SSE streams never emit a
`request` line.

## Conventions that constrain every layer

- **Hermetic tests:** `npm test` runs the full suite offline (no LLM, no key, no
  network). `pglite` keeps the Postgres backend in-process; fixture-backed
  resolvers keep GraphQL tests offline. CI builds the sibling `agenthood`
  package (file dependency) and runs `typecheck` + tests; deploy workflows run
  only after that CI is green.
- **Read-only projection contract (ADR-002):** execution is never driven inline in
  the HTTP layer; all runs route through `SessionQueue`.
- **Fail-closed surfaces:** 5xx never leak internals; agent-facing errors never
  enumerate internals.
- **Decision records:** every significant decision has an ADR in
  [`docs/adr/`](../adr/); the branch roadmap lives in
  [`docs/tasks/m3-task-api.md`](../tasks/m3-task-api.md).

## Roadmap

| Branch/PR | What | Status |
|-----------|------|--------|
| `feat/6-fastify-rebuild` | HTTP layer on Fastify (SSE contract preserved) | merged (#41) |
| `feat/6-postgres-backend` | `PostgresBackend`, `Db` seam, migrations | merged (#42) |
| `feat/3-task-rest` | Task API + per-session SSE on Fastify, wired through the store | merged (#44) |
| `feat/45-security-audit` | bearer gate over /runs + /events, rate limiting, auth-rejection logging, `execRawDdl` | merged (#46) |
| auth ADR | accounts/tenancy at the data-access boundary | shipped (#185, ADR-008) |
| `feat/projects-backend` | projects table, sessions directory, project CRUD, project-scoped SSE | merged (#58) `661c992` |
| `feat/full-dag-builder` | FULL DAG: `POST /tasks/:id/reply`, `graph full`, Inspector/Thread, deep-links | merged (#63) |
| ADR-011/012 | federation decomposition + git-backed workspace | recorded; split deployables #321, REST BFF #297 |
| ADR-013 | AWS deployment target (EC2 + RDS + compose stack) | recorded, shipping (#330); decommission #329 |

See [`docs/spec/m3-task-api.md`](../spec/m3-task-api.md) for the M3 plan,
[`docs/spec/m5-federation-workspace.md`](../spec/m5-federation-workspace.md) for
federation + workspace, and [`PROGRESS.md`](../../PROGRESS.md) for shipped state.
