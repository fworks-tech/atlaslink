# src/session — the Session layer (M3)

The event-sourced session aggregate behind a backend port (ADR-004, direction
ADR-006). A `Session` is rebuilt deterministically from its `session.*` event
stream; `version` is the optimistic CAS token — a stale write rejects instead of
silently clobbering.

## Modules

| File | Responsibility |
|------|----------------|
| `sessionBackend.ts` | The `SessionBackend` port: `append`, `get`, `readModifyWrite`. Implementations must keep version-check + commit atomic. |
| `sessionStore.ts` | In-memory `SessionStore` plus the shared `rehydrate(events)` reducer and the `StreamIntegrityError`/`VersionConflictError` types. |
| `deepFreeze.ts` | `deepFreeze(value)` — recursively freezes an object graph. Used by every backend to prevent snapshot mutation. |
| `eventLogBackend.ts` | `EventLogBackend`: the same contract over the NDJSON `EventLogStore`, with a per-session snapshot cache invalidated on append. |
| `postgresBackend.ts` | `PostgresBackend` over Postgres event tables — pending `feat/6-postgres-backend`. CAS is enforced inside a `FOR UPDATE` transaction. Per-session snapshot cache with in-memory version tracking to short-circuit DB reads on cache hits. |
| `db.ts` | Minimal `Db` seam (`query`/`exec`/`transaction`) with `pglite` (hermetic CI) and `pg` (managed) adapters. |
| `migrations.ts` | Hand-rolled runner: applied-versions table, standard-SQL migrations in one transaction guarded by an advisory xact lock, so the identical statements run on both drivers. |
| `backendFactory.ts` | `createSessionBackend()`: in-memory by default; `ATLASLINK_DATABASE_URL` selects Postgres (migrations applied first). |
| `types.ts` | `Session`, `SessionEvent`, `SessionDelta`, `SessionSnapshot`, and the error classes. |
| `backendContract.ts` | Shared test harness — every backend binds to the same behavioral suite. |

## Data model

`session_events` (Postgres) is keyed by `(tenant_id, session_id, seq)` with a
`UNIQUE (tenant_id, session_id, version)` CAS column and an index on
`(tenant_id, correlation_id)`. `tenant_id` defaults to `'default'` so the auth ADR
is additive, not a schema rewrite. M3 ships rebuild-on-read; a maintained
`sessions` materialization is the later optimization.

## Invariants

- **Append is the commit.** The store and the event stream cannot drift.
- **Rebuild-on-read is deterministic** and order-stable (failed/duplicate events
  are not invented).
- **A backend swap cannot change observable behavior** — `backendContract` pins it.
- **Hermetic:** `pglite` is in-process and offline; managed Postgres never runs in CI.
- **Snapshot cache consistency.** Every backend tracks a per-session snapshot
  (`SessionSnapshot` in `types.ts`). `append()` invalidates the affected
  session's cache; `get()` returns the frozen cached reference when the version
  matches. Callers receive a `deepFreeze`d snapshot — mutation is a contract
  violation caught by the shared backend contract test.

## Note on the two status models

`src/tasks/taskRegistry.ts` carries an M1-era in-memory status
(`queued|running|succeeded|failed`) with its own `Session` shape. The session layer
defines its own richer status (`+cancelled`) and aggregate. [`src/tasks/README.md`](../tasks/README.md)
documents this coexistence; the task-rest branch reconciles them.