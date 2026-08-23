# M3 Task API — Task Breakdown

**Source of truth:** [`docs/spec/m3-task-api.md`](../spec/m3-task-api.md)
**Issue:** #M3 (Task API)
**Status:** Proposed — branch plan, not yet implemented

The M3 implementation is split into stacked, revert-safe branches. Each branch lands
independently and keeps the full hermetic suite green (no LLM, no provider key, no
network). The per-branch file list and test counts below are the contract this
breakdown tracks.

```
main → docs/3-m3-task-api → feat/3-session-store → feat/3-task-rest
```

## Branch 1 — `docs/3-m3-task-api` (documentation)

- [x] `docs/adr/ADR-004-session-aggregate-durability.md` — event-sourced aggregate,
      materialized in DuckDB; scopes the zero-new-deps lift to the session store.
- [x] `docs/spec/m3-task-api.md` — session model, API surface, storage architecture,
      tweaks, open questions.
- [x] `docs/tasks/m3-task-api.md` — this breakdown.
- Expected: review-only (no tests).

## Branch 2 — `feat/3-session-store`

The durable, event-sourced session store behind a backend port.

- New: `src/store/SessionStore.ts` + `.test.ts`
  - `appendDelta(event)` as the commit; `rehydrate(correlationId)` → `Session` aggregate;
    `readModifyWrite` with optimistic `version` bumping.
- New: `src/store/backends/SessionBackend.ts` — the port interface.
- New: `src/store/backends/DuckDbBackend.ts` + `.test.ts` — embedded `file:` DuckDB
  (hermetic: `:memory:` / temp-file per test).
- Reserve (not implemented): `src/store/backends/MotherDuckBackend.ts` — designed as a
  port, built later.
- Session aggregate model: identity (`sessionId`, `correlationId`, `tenantId`), `interaction[]`,
  `diagram` (reserved/null), `tweaks`, `nextStep`, `lifecycle`, `version`.
- `src/tasks/taskRegistry.ts`, `src/daemon/runTask.ts` remain untouched.
- Expected: ~12 new tests (append→rehydrate, crash-rehydrate, version conflicts,
  backend round-trip); existing 66 stay green.

## Branch 3 — `feat/3-task-rest`

The REST surface and per-session SSE over the store and the existing queue.

- New: `src/api/tasks.ts` + `.test.ts` — `POST/GET /tasks`, `GET /tasks/{id}`,
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
- **New dep (scoped):** `duckdb` — only in the session store; the event bridge and
  run path stay lean (ADR-004).
- **Read-only contract:** `run.*` events pass verbatim; execution never driven inline;
  all runs route through `SessionQueue` (ADR-002).
- **Hermetic:** embedded DuckDB backend is local/offline; MotherDuck backend never runs
  in CI.
- Target total: ~66 existing + ~23 new → ~89 hermetic tests.