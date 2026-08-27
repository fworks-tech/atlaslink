# M3 Task API — Task Breakdown

**Source of truth:** [`docs/spec/m3-task-api.md`](../spec/m3-task-api.md)
**Issue:** #M3 (Task API)
**Status:** In progress — Branch 1 (docs) and Branch 2 (session store) shipped and
merged to main (Branch 1 as PR #23; Branch 2 as PRs #27/#37/#38); Branch 3
(`feat/3-task-rest`) remains, and is being re-planned around ADR-006 (Fastify HTTP
layer + Postgres primary store).

The M3 implementation is split into stacked, revert-safe branches. Each branch lands
independently and keeps the full hermetic suite green (no LLM, no provider key, no
network). The per-branch file list and test counts below are the contract this
breakdown tracks.

```
main → docs/3-m3-task-api → feat/3-session-store → (ADR-006) → feat/3-task-rest
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
  and session persistence moves to Postgres (`PostgresBackend` below).
- Deferred (now ADR-006): `src/session/postgresBackend.ts` + `.test.ts` — the
  `PostgresBackend` over `pg`/`pglite` (`pglite` in-process for hermetic CI; managed
  Postgres in production). Event-sourced sessions persist to `session_events` rows keyed
  by `tenant_id` + `session_id` (ADR-006 Decisions 4–5). The former
  `DuckDbBackend`/`MotherDuckBackend` plans are revoked.
- Session aggregate model (shipped): identity (`sessionId`, `correlationId`), `status`,
  `version`, `task {member, prompt}`, `tweaks?`, timestamps (`createdAt`/`startedAt`/
  `finishedAt`), `output?`/`error?`/`durationMs?` — the leaner document built from
  `session.*` events, not the speculative `interaction[]`/`diagram` shape.
- `src/tasks/taskRegistry.ts`, `src/daemon/runTask.ts` remain untouched.
- Shipped: 19 session tests (sessionStore 8 + eventLogBackend 11); the 74 pre-session
  tests stay green; suite now 93.

## Branch 3 — `feat/3-task-rest` (re-planned per ADR-006)

The REST surface and per-session SSE over the store and the existing queue, on Fastify.

- New: `src/api/tasks.ts` + `.test.ts` — Fastify plugins/routes for `POST/GET /tasks`,
  `GET /tasks/{sessionId}`, `POST /tasks/{id}/cancel`, `GET /tasks` (list + SQL filter);
  `tweaks` envelope validation + passthrough.
- New/Modify: `src/server.ts` — rebuilt on Fastify (ADR-006 Decision 1); routes wired
  through `SessionQueue` (`declareSession`), never a direct `runSession`.
- Modify: `src/api/events.ts` (or `src/bridge/sseEndpoint.ts`) + `.test.ts` —
  `GET /events/{sessionId}` per-session replay-then-live filtered by `correlationId`;
  the global `GET /events` reconnection contract survives the Fastify rewrite.
- New (following the auth ADR): account/tenant layer — auth flows and tenant scoping
  land before account-facing routes expose user data (m3 spec §7, ADR-006 Decision 7).
- Modify: `src/server.test.ts` — E2E through the fake runner (existing pattern).
- README / PROGRESS documentation update.
- Expected: ~10 new tests + 1 E2E (+ auth coverage with the auth ADR).

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
- **Tenancy:** every account-scoped query carries `tenant_id` at the data-access
  boundary (ADR-006 Decision 7).
- Target total: ~74 pre-session + 19 session tests → 93 now; landing Branch 3 brings
  the suite to ~103 hermetic tests.