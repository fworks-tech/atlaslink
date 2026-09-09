# src/session — the Session layer (M3)

The event-sourced session aggregate behind a backend port (ADR-004, direction
ADR-006). A `Session` is rebuilt deterministically from its `session.*` event
stream; `version` is the optimistic CAS token — a stale write rejects instead of
silently clobbering.

## Modules

| File | Responsibility |
|------|----------------|
| `sessionBackend.ts` | The `SessionBackend` port: `append`, `get`, `readModifyWrite`, `list`, project CRUD, `deleteSession`, and a required `withTenant`. Implementations must keep version-check + commit atomic. |
| `sessionStore.ts` | In-memory `SessionStore` plus the shared `rehydrate(events)` reducer and the `StreamIntegrityError`/`VersionConflictError` types. |
| `deepFreeze.ts` | `deepFreeze(value)` — recursively freezes an object graph. Used by every backend to prevent snapshot mutation. |
| `eventLogBackend.ts` | `EventLogBackend`: the same contract over the NDJSON `EventLogStore`, with a per-session `SessionSnapshot` cache and `#versions` map for zero-I/O hits; invalidated on `append` to that session. |
| `postgresBackend.ts` | `PostgresBackend` over Postgres event tables. CAS is enforced inside a `FOR UPDATE` transaction. Per-session `SessionSnapshot` cache with `#versions` in-memory counter for zero-I/O hits; the cache is single-process state — cross-process writes fall through to Postgres and re-sync. |
| `db.ts` | Minimal `Db` seam (`query`/`exec`/`transaction`) with `pglite` (hermetic CI) and `pg` (managed) adapters. |
| `migrations.ts` | Hand-rolled runner: applied-versions table, standard-SQL migrations in one transaction guarded by an advisory xact lock, so the identical statements run on both drivers. |
| `backendFactory.ts` | `createSessionBackend()`: three tiers — `ATLASLINK_DATABASE_URL` selects managed Postgres, SQLite at `ATLASLINK_SQLITE_DIR` is the durable default, `ATLASLINK_DURABILITY=inmemory` selects the in-process store. Migrations applied first. |
| `types.ts` | `Session`, `SessionEvent`, `SessionDelta`, `SessionSnapshot`, and the error classes. |
| `backendContract.ts` | The one shared test harness — every backend must bind to it and pass. There is no second suite (see ADR-010). |

## Porting a custom backend (migration guide, #189)

A `SessionBackend` implements nine methods. The hard requirements a new
implementation must honor — each is pinned by a `backendContract` case:

1. **Atomic CAS.** `readModifyWrite` checks `expectedVersion` and commits with
   no `await` in between, or two writers can both pass the guard (#32).
2. **`deleteSession` is tenant-scoped and idempotent.** It resolves for unknown
   ids, never touches another tenant's stream, and the next append to a deleted
   id starts a fresh version-1 stream. EventLogBackend implements it as a
   `session.deleted` tombstone envelope; Postgres/SessionStore purge outright.
3. **`withTenant` is required, not optional.** It returns a backend view scoped
   to the tenant; a session id can never be shared across tenants (append
   rejects with `VersionConflictError` on affinity mismatch).
4. **Frozen snapshots.** `get` returns a `deepFreeze`d aggregate, cached by
   version and invalidated by `append` to that session.
5. **Bind the contract.** `backendContract('MyBackend', async () => new MyBackend(...))`
   in a `*.test.ts` is the conformance gate. If a case cannot pass without
   weakening semantics, the backend is non-conforming — that is the point.

Method names follow our event-sourced semantics (`append` *is* the checkpoint
`put`); ADR-010 records why we did not adopt LangGraph's checkpointer names.

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