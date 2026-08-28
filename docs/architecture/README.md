# Atlaslink Architecture

**Reading order:** start here for the whole system; then the per-layer notes in
`src/bridge/`, `src/session/`, `src/daemon/`, `src/tasks/`; then the ADRs in
[`docs/adr/`](../adr/) for each decision's rationale. Decisions that shaped this
system: ADR-001 (NDJSON event log), ADR-002 (read-only projection contract),
ADR-003 (Atlas holds the sky of sessions), ADR-004 (session aggregate durability),
ADR-005 (structured logging), ADR-006 (Fastify + Postgres direction).

## What this is

Atlaslink is a product-oriented multi-agent orchestrator built on Agenthood (the
agent-team runtime). It runs a daemon that executes agent runs, bridges the
resulting events to browsers over SSE, and — on the M3 roadmap — exposes a
programmatic Task API over the same event-sourced sessions.

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

   M3 session layer (ADR-004/006) — not yet wired into the HTTP server:
            ┌───────────────────────────────────────────────┐
            │  session/  SessionBackend port                │
            │   ├─ SessionStore (in-memory, shipped)        │
            │   ├─ EventLogBackend (NDJSON, shipped)        │
            │   └─ PostgresBackend (Postgres event tables,  │
            │      pending feat/6-postgres-backend)         │
            │  Db seam (pglite in CI / pg in prod)          │
            └───────────────────────────────────────────────┘
```

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
in-memory `SessionStore`, the NDJSON `EventLogBackend`, and — pending
`feat/6-postgres-backend` — the `PostgresBackend` over event tables. All backends
bind to the same behavioral contract (`backendContract`), so a swap cannot silently
change observable semantics.

**M3 direction (ADR-006):** the HTTP layer moves to Fastify and Postgres becomes the
primary store. The NDJSON log is demoted to agent-run provenance; sessions persist
to Postgres event tables keyed by `tenant_id` + `session_id` (tenancy is additive —
`schema_migrations` and a `Db` seam run identical SQL on `pglite` in CI and managed
Postgres in production). The task-rest branch then lands `POST/GET /tasks`,
`GET /tasks/{id}`, cancel, and per-session SSE on top.

## Logging (ADR-005)

One JSON object per line, level via `ATLASLINK_LOG_LEVEL`, `correlationId` threaded
explicitly (no implicit context). The `src/log.ts` facade is the ship contract;
Fastify runs `logger: false` and an `onResponse` hook emits the `request` envelope
through that facade so the logged shape stays fixed. SSE streams never emit a
`request` line.

## Conventions that constrain every layer

- **Hermetic tests:** `npm test` runs the full suite offline (no LLM, no key, no
  network). `pglite` keeps the Postgres backend in-process. CI builds the sibling
  `agenthood` package (file dependency) and runs `typecheck` + tests.
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
| `feat/3-task-rest` | Task API + per-session SSE on Fastify, wired through the store | in progress |
| auth ADR + `feat/3-task-rest` auth | accounts/tenancy, token gate | pending |
| infra ADR | serverless API / container daemon split, Terraform | pending |
| M4 | live dashboard UI rendering society provenance | pending |

See [`docs/spec/m3-task-api.md`](../spec/m3-task-api.md) for the M3 plan and
[`PROGRESS.md`](../../PROGRESS.md) for shipped state.