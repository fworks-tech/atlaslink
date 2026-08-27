# M3 Task API — Task Breakdown

**Source of truth:** [`docs/spec/m3-task-api.md`](../spec/m3-task-api.md)
**Issue:** #M3 (Task API)
**Status:** In progress — Branch 1 (docs) and Branch 2 (session store) shipped and
merged to main (Branch 1 as PR #23; Branch 2 as PRs #27/#37/#38); Branch 3
(`feat/3-task-rest`) remains.

The M3 implementation is split into stacked, revert-safe branches. Each branch lands
independently and keeps the full hermetic suite green (no LLM, no provider key, no
network). The per-branch file list and test counts below are the contract this
breakdown tracks.

```
main → docs/3-m3-task-api → feat/3-session-store → feat/3-task-rest
```

## Branch 1 — `docs/3-m3-task-api` (documentation)

- [x] `docs/adr/ADR-004-session-aggregate-durability.md` — event-sourced aggregate,
      rehydrated from NDJSON (rebuild-on-read); DuckDB backend deferred (ADR-004 scopes the zero-new-deps lift to that later backend).
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
  `EventLogBackend` (ADR-004), with snapshot cache keyed by the log cursor.
- Deferred (later branch): `src/store/backends/DuckDbBackend.ts` + `.test.ts` — embedded
  `file:` DuckDB (hermetic: `:memory:` / temp-file per test).
- Reserve (not implemented): `src/store/backends/MotherDuckBackend.ts` — designed as a
  port, built later.
- Session aggregate model (shipped): identity (`sessionId`, `correlationId`), `status`,
  `version`, `task {member, prompt}`, `tweaks?`, timestamps (`createdAt`/`startedAt`/
  `finishedAt`), `output?`/`error?`/`durationMs?` — the leaner document built from
  `session.*` events, not the speculative `interaction[]`/`diagram` shape.
- `src/tasks/taskRegistry.ts`, `src/daemon/runTask.ts` remain untouched.
- Shipped: 19 session tests (sessionStore 8 + eventLogBackend 11); the 74 pre-session
  tests stay green; suite now 93.

## Branch 3 — `feat/3-task-rest`

The REST surface and per-session SSE over the store and the existing queue.

  - New: `src/api/tasks.ts` + `.test.ts` — `POST/GET /tasks`, `GET /tasks/{sessionId}`,
  `POST /tasks/{id}/cancel`, `GET /tasks` (list + SQL filter); `tweaks` envelope
  validation + passthrough.
- Modify: `src/api/events.ts` (or `src/bridge/sseEndpoint.ts`) + `.test.ts` —
  `GET /events/{sessionId}` per-session replay-then-live filtered by `correlationId`.
- Modify: `src/server.ts` — wire the store + routes; route via `SessionQueue`
  (`declareSession`), never a direct `runSession`.
- Modify: `src/server.test.ts` — E2E through the fake runner (existing pattern).
- README / PROGRESS documentation update.
- Expected: ~10 new tests + 1 E2E.

## Cross-branch invariants

- **Untouched:** `src/tasks/taskRegistry.ts`, `src/daemon/runTask.ts`, `src/config.ts`,
  `tsconfig.json` (constructor unchanged).
- **New dep (deferred):** `duckdb` — only when the DuckDB backend lands (later); the
  M3 MVP is zero-new-deps, the event bridge and run path stay lean (ADR-004).
- **Read-only contract:** `run.*` events pass verbatim; execution never driven inline;
  all runs route through `SessionQueue` (ADR-002).
- **Hermetic:** the M3 store backend is log-backed/local/offline; when DuckDB lands it
  is embedded/local and the MotherDuck backend never runs in CI.
- Target total: ~74 pre-session + 19 session tests → 93 now; landing Branch 3 brings
  the suite to ~103 hermetic tests.