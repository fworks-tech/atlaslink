# M3 Task API — Task Breakdown

**Source of truth:** [`docs/spec/m3-task-api.md`](../spec/m3-task-api.md)
**Issue:** #M3 (Task API)
**Status:** Complete — all five branches shipped and merged to main (Branch 1 as
PR #23; Branch 2 as PRs #27/#37/#38; Branch 3 as PR #41; Branch 4 as PR #42; Branch
5 as PR #44, with the OWASP security pass in PR #46).

The M3 implementation is split into stacked, revert-safe branches. Each branch lands
independently and keeps the full hermetic suite green (no LLM, no provider key, no
network). The per-branch file list and test counts below are the contract this
breakdown tracks.

```
main → docs/3-m3-task-api → feat/3-session-store → feat/6-fastify-rebuild
      └─ feat/6-postgres-backend (parallel with fastify-rebuild)
main + (both) → feat/3-task-rest
```

## Branch 1 — `docs/3-m3-task-api` (documentation)

- [x] `docs/adr/ADR-004-session-aggregate-durability.md` — event-sourced aggregate,
      rehydrated on read; the DuckDB/NDJSON backend track is now superseded by ADR-006.
- [x] `docs/adr/ADR-006-fastify-http-and-postgres.md` — Fastify HTTP layer, Postgres
      primary store, sessions in Postgres event tables, first-class tenancy — this
      breakdown re-plans Branch 3 against it.
- [x] `docs/spec/m3-task-api.md` — session model, API surface, storage architecture,
      tweaks, open questions.
- [x] `docs/tasks/m3-task-api.md` — this breakdown.
- Expected: review-only (no tests).

## Branch 2 — `feat/3-session-store`

The durable, event-sourced session store behind a backend port.

- New: `src/session/sessionStore.ts` + `.test.ts` (in-memory `SessionStore`)
  - `append(event)` as the commit; `rehydrate(sessionId)` → `Session` aggregate;
    `readModifyWrite` with optimistic `version` bumping (mutator returns `SessionDelta[]`
    — the store owns the `sessionId`).
- New: `src/session/sessionBackend.ts` — the port interface.
- New: `src/session/eventLogBackend.ts` + `.test.ts` — the NDJSON `EventLogStore`-backed
  `EventLogBackend` (ADR-004), with snapshot cache keyed by the log cursor. Remains a
  valid zero-dependency backend; per ADR-006 Decision 6 the log is agent-run provenance,
  and session persistence moves to Postgres (`PostgresBackend` in Branch 4).
- Session aggregate model (shipped): identity (`sessionId`, `correlationId`), `status`,
  `version`, `task {member, prompt}`, `tweaks?`, timestamps (`createdAt`/`startedAt`/
  `finishedAt`), `output?`/`error?`/`durationMs?` — the leaner document built from
  `session.*` events, not the speculative `interaction[]`/`diagram` shape.
- `src/tasks/taskRegistry.ts`, `src/daemon/runTask.ts` remain untouched.
- Shipped: 19 session tests (sessionStore 8 + eventLogBackend 11); the 74 pre-session
  tests stay green; suite now 93.

## Branch 3 — `feat/6-fastify-rebuild`

Transport swap only — the HTTP layer moves from the hand-rolled `node:http` server to
Fastify (ADR-006 Decision 1), preserving every route contract. Postgres and the task API
are NOT in scope here.

- Modify: `src/server.ts` — `createAppServer` builds a Fastify app over a
  `serverFactory`-owned `node:http` server; `/health`, `/runs`, `/events`, and the 404
  JSON surface are Fastify routes. `app.ready()` boots the lifecycle before returning so
  entrypoint and tests keep socket control.
- Modify: `src/server.test.ts` — `startServer` awaits `createAppServer`; route
  assertions unchanged. New smoke test pins the Fastify wiring.
- `GET /events` delegates to the existing `SseHandler` via `reply.hijack()` + raw
  `req`/`res` — the reconnection contract (Last-Event-ID resume, 15s ping,
  `bridge.gap`/`bridge.shutdown`, no request log line) survives unchanged (ADR-006
  Decision 2); `sseEndpoint.test.ts` untouched.
- `POST /runs` body validation is JSON-schema (was hand-parsed); 202/400 contract
  unchanged.
- Logging: the ADR-005 `request` envelope is emitted through the `src/log.ts` facade by
  an `onResponse` hook; Fastify runs `logger: false`. pino backing for the facade
  (ADR-006 Decision 3) is deferred to a later chore — the contract and swallow boundary
  stand, which is what Decision 3 requires.
- New dep: `fastify` ^5 (ADR-006 Decisions 1/9). Shipped: 93 → 95 tests (error-envelope + malformed-JSON coverage).

## Branch 4 — `feat/6-postgres-backend`

The `PostgresBackend` behind the `SessionBackend` port — framework-independent.

- New: `src/session/migrations.ts` — hand-rolled runner (applied-versions table, ordered
  standard-SQL migrations in a transaction); same SQL runs on `pglite` and managed
  Postgres.
- New: `src/session/db.ts` — minimal `Db` interface (`query`/`exec`/`transaction`) with
  `pglite` (in-process, hermetic CI) and `pg` (managed, never in CI) adapters.
- New: `src/session/postgresBackend.ts` + `.test.ts` — `append`/`get` (SQL-filtered
  rehydrate)/`readModifyWrite` with the `version` CAS atomic inside a transaction
  (ADR-004 model, ADR-006 Decisions 4–5). `session_events` keyed by
  `(tenant_id, session_id, seq)` with a `UNIQUE (tenant_id, session_id, version)` CAS
  column and `tenant_id` defaulting to `'default'` so the auth ADR is additive, not a
  rewrite.
- New: `src/session/backendFactory.ts` — `createSessionBackend()` returns the in-memory
  `SessionStore` by default; `ATLASLINK_DATABASE_URL` selects `PostgresBackend`.
- Tests: the shared `backendContract` parameterizes over both backends; migration
  idempotency covered. Expected: 94 → ~104 tests.
- New deps: `@electric-sql/pglite`, `pg` (ADR-006 Decisions 4–5/9); the former
  `DuckDbBackend`/`MotherDuckBackend` plans are revoked.

## Branch 5 — `feat/3-task-rest` (shipped)

The REST surface and per-session SSE over the store and the existing queue, on Fastify.

Shipped on this branch (see PR #44):
- `src/api/tasks.ts` + `.test.ts` (in `src/server.test.ts`): `POST/GET /tasks`,
  `GET /tasks/{sessionId}`, `POST /tasks/{id}/cancel`, `GET /tasks` (list with
  backend-applied `status`/`since` filters and bounded pagination); `tweaks`
  envelope validated + stored verbatim. `SessionBackend` gained `list()` for the
  query surface (bound SQL on Postgres, scoped scan in-memory).
- `src/api/auth.ts` — the spec §7 pre-auth bearer-token gate. PR #46 extended it
  over `/runs` and the global `/events` stream (the whole account-facing surface),
  added `@fastify/rate-limit`, auth-rejection logging, and fail-closed boot on
  non-loopback binds; `/health` stays open for probes.
- `GET /events/{sessionId}` per-session replay-then-live — `SseHandler` gained a
  correlationId projection (`handleForSession`), same wire contract.
- Execution-model reconciliation: `TaskRegistry.create` takes an additive
  `id`/`correlationId` override so the store aggregate and the queue-run registry
  session share identity; the queue runner mirrors lifecycle into the store so
  `/tasks` reads are live. `/runs`-created sessions stay registry-only.
- E2E: task-rest suite shipped with PR #44; the security pass (PR #46) extended the
  gate test to `/runs` + `/events` and added the rate-limit cap test → suite 121.

Remaining with the auth ADR:
- account/tenant layer — auth flows and tenant scoping land before account-facing
  routes expose user data (m3 spec §7, ADR-006 Decision 7). The pre-auth token gate
  shipped in PR #46; accounts/tenancy is the next step.
- New (following the auth ADR): `src/api/events.ts` (or extend `tasks.ts`)

## Cross-branch invariants

- **Untouched:** `src/tasks/taskRegistry.ts`, `src/daemon/runTask.ts`, `src/config.ts`,
  `tsconfig.json` (constructor unchanged).
- **Framework dep (accepted):** `fastify` (ADR-006 Decision 1) — replaces the native
  `node:http` server; the event bridge and run path stay lean.
- **Store deps (accepted):** `pg` + `pglite` (ADR-006 Decisions 4–5, 9) — the `duckdb`
  token is revoked.
- **Read-only contract:** `run.*` events pass verbatim; execution never driven inline;
  all runs route through `SessionQueue` (ADR-002).
- **Hermetic:** `pglite` is in-process and offline like the log backend; managed Postgres
  and any cloud backend never run in CI.
- **Tenancy:** `session_events` carries `tenant_id` at the data-access boundary
  (ADR-006 Decision 7); user/tenant schema lands with the auth ADR.
- Target total: 93 → 95 (Fastify) → 106 (Postgres) → ~114 with Branch 5; shipped at 121.