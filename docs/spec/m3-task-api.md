# M3 Task API — Plan (agenthood-ratified, draft)

**Date:** 2026-08-23 (amended 2026-08-27 per ADR-006)
**Status:** Proposed — draft for review
**Issue:** #M3 (Task API)

Prepared from the M2 contract and the Agenthood Society planning sessions. The
Session model reflects ADR-003 (Atlas holds the sky of sessions) and ADR-004 (the
Session is an event-sourced aggregate); ADR-006 set the storage direction — Postgres as
the primary store with sessions persisted to Postgres event tables (`pg`/`pglite`), not
NDJSON rebuild-on-read.

---

## 1. Problem statement (the-strategist)

M1 hosts the daemon and one-shot runs; M2 bridges the resulting events to the browser
over SSE with durable NDJSON retention. Missing is a **programmatic surface to drive,
hold, and reopen orchestrations**. Without it, Atlaslink can only stream what someone
else triggered; it cannot *be* the bearer of sessions.

M3 closes that gap with a durable Task API: `POST/GET /tasks`, `GET /tasks/{id}`,
`cancel`, and a per-session event stream. It turns "Atlas holds the sky of sessions"
(ADR-003) from a documented identity into shipped structure.

### Success criteria (testable)

1. **Durable sessions** — a Session survives a daemon restart and is rebuilt to its
   current aggregate state from the event log (ADR-004).
2. **Sessions as live documents** — `GET /tasks/{id}` returns the *current* aggregate
   (identity, interaction turns, tweaks, lifecycle, reserved diagram), not a terminal row.
3. **The job triangle** — `POST /tasks` → `201 {sessionId, correlationId, status}`;
   `GET /tasks/{id}` for status; `POST /tasks/{id}/cancel` (queued-only guaranteed, 202).
4. **Per-session events** — `GET /events/{sessionId}` replays then live-tails that
   session's events (filtered by `correlationId`), distinct from the global `/events`.
5. **Tweaks envelope** — `POST /tasks` carries `{provider?, member?, team?}` overrides;
   the full envelope is stored and round-trippable on the aggregate. `provider` executes;
   `member`/`team` validate-and-passthrough until agenthood exposes node seams.
6. **Read-only contract upheld** — `runTask.ts`/`taskRegistry.ts` untouched; execution
   never driven inline; all runs route through the `SessionQueue` (ADR-002).
7. **Hermetic suite** — the store backend is local/offline (`pglite`, in-process, no
   network); managed Postgres and any cloud backend never run in CI.
8. **Optimistic versioning** — concurrent aggregate mutations cannot silently clobber
   each other.

### Ranked priorities

durability + correctness (aggregate rebuild, versioning) > read-only contract >
job-triangle semantics > per-session scoping > tweaks honesty > ops hygiene.

## 2. The Session model (the-architect)

A Session is a **live, authoritative work-document**, event-sourced per ADR-004:

| Field | Kind | Notes |
|-------|------|-------|
| `sessionId` | identity | `ses-…`, durable, never renames |
| `correlationId` | identity | joins events, traces, decisions, provenance |
| `tenantId` | identity | **first-class target** (ADR-006 Decision 7) — every account-scoped table carries `tenant_id`; the tenant schema itself lands with the auth ADR, and the shipped `Session` type has no `tenantId` yet. The earlier "`\"default\"`, multi-tenancy = filter later" seam is retired. |
| `interaction[]` | live | ordered Atlas↔user chat turns (prompts, replies) |
| `diagram` | reserved | node/edge/gate snapshot — **schema reserved (null) until M4** |
| `tweaks` | live | full per-run override envelope, round-trippable |
| `nextStep`/pending | live | what the orchestrator reads to continue |
| `lifecycle` | state | queued / running / succeeded / failed + timestamps |
| `version` | concurrency | optimistic revision; increments on each aggregate mutation |

> **Shipped shape (Branch 2).** The implemented `Session` (`src/session/types.ts`) is
> normalized from the `session.*` event stream and is leaner than the table above:
> `sessionId`, `correlationId`, `status` (`queued|running|succeeded|failed|cancelled`),
> `version`, `task { member, prompt }`, `tweaks?`, timestamps (`createdAt`/`startedAt`/
> `finishedAt`), and `output?`/`error?`/`durationMs?`. The richer `interaction[]`,
> `diagram`, and `nextStep` fields are deferred design (M4) and are not yet in the type.

**Not a log, not a terminal row.** The immutable event record (postgres `session_events`
rows; NDJSON for agent-run provenance, ADR-001) is the source of truth; the Session is
the aggregate **rehydrated** from it on each read. Postgres is the materialization,
behind the same `SessionBackend` port (ADR-004 model, ADR-006 storage direction).

## 3. API surface

### `POST /tasks` — create + enqueue a session

```
POST /tasks
Content-Type: application/json

{ "member": "the-architect", "prompt": "plan x", "tweaks": { "provider": "groq" } }

→ 201
{ "ok": true, "session": { "sessionId": "ses-…", "correlationId": "cor-…", "status": "queued", "tweaks": {…} } }
```

- Validation errors → `400` (`member` and `prompt` required strings; `tweaks` validated shape).
- The session is written to the store (event append = commit), **then** `queue.declareSession(session)`
  (never a direct `runSession`).
- `tweaks.provider` overrides the run's provider; `tweaks.member`/`tweaks.team` are
  validated and passed through on the aggregate (execution ceiling in §5).

### `GET /tasks/{sessionId}` — current aggregate

```
GET /tasks/ses-… → 200 { "session": { sessionId, correlationId, status, task, tweaks, createdAt,
                        startedAt?, finishedAt?, output?, error?, durationMs?, version } }

GET /tasks/ses-unknown → 404 { "ok": false, "error": "unknown session" }
```

Returns the **current** materialized aggregate (may be in-flight), not a completed row.

### `POST /tasks/{sessionId}/cancel` — cancel a queued session

```
POST /tasks/ses-…/cancel → 202 { "ok": true, "status": "cancelled" }
```

- Guaranteed only **from queued**. A `running` session is left to the runtime
  (read-only contract, ADR-002); best-effort running-cancel is noted for M4 (requires
  agenthood-side change).
- **M3 response contract for a `running` session:** `202` is returned immediately to
  acknowledge the request, but cancellation is **best-effort** — the runtime attempts
  to stop the run and the session transitions to `cancelled` only once the runtime
  confirms. The body makes the non-guarantee explicit:
  ```
  POST /tasks/ses-running/cancel → 202
  { "ok": true, "status": "running", "cancel": "best-effort" }
  ```
  Clients MUST NOT assume the run has stopped until a subsequent `GET /tasks/{id}`
  shows `lifecycle` = `cancelled`. Full guaranteed running-cancel (agenthood-side
  change) is deferred to M4; the *response shape* above is fixed in M3 so the
  contract is unambiguous.
- Cancelling from a terminal state → `409` conflict.

### `GET /tasks` — list sessions

```
GET /tasks?status=failed&since=2026-01-01T00:00:00Z&limit=50&offset=0
  → 200 { "sessions": [ … ], "total": n, "limit": 50, "offset": 0 }
```

- **Scope & ordering:** returns sessions matching the optional `status` and `since`
  filters, ordered by `createdAt` **descending** (newest first). With no filters,
  returns the first page (default `limit`) of all sessions in the store.
- **Pagination (bounded):** `limit` (default **50**, max **500**) and `offset`
  (default **0**) are optional query parameters; when omitted they take their
  defaults. Responses echo `limit`/`offset` back. `total` is the count of sessions
  matching the filter *before* pagination — not the page size — so clients can
  compute page count. Out-of-range `offset`/`limit` (e.g. `limit > 500`, negative
  values) → `400`.
- Filtering/paging is applied by the `SessionBackend` over the Postgres store
  (**no hand-rolled client scan**). Filters become bound SQL parameters
  (`WHERE tenant_id = $1 AND status = $2 …`) — never string-concatenated. Injection-class
  bugs are prevented at the API boundary, not retrofitted.

### `GET /events/{sessionId}` — per-session SSE

```
GET /events/ses-…   Accept: text/event-stream
```

- Replays retained events for that `correlationId` (after optional `Last-Event-ID`),
  then live-tails new ones. Distinct resource from the global `GET /events`.
- Implemented as a filtered view over the existing `EventBroadcaster`/`SseHandler`
  surface — no new wire protocol.

## 4. Storage architecture (ADR-004 + ADR-006)

```
RunEventBus ─► EventLogStore (NDJSON — agent-run provenance, ADR-001/002)
session events ─► PostgreSQL (primary store, ADR-006)
                 session_events (tenant_id, session_id, version, event) ─▶ Session aggregate
                 users / tenants / product tables
                    │  append (the commit / the delta)
                    ▼
              REST surface (POST/GET/CANCEL + per-session SSE)
```

- **PostgreSQL is the primary operational store** (ADR-006 Decision 4): users, tenants,
  session events, and product tables. Development and hermetic tests run `pglite`
  (in-process, no network); production connects to managed Postgres.
- **Sessions are event-sourced against Postgres event tables** (ADR-006 Decision 5). The
  ADR-004 model holds — event append is the commit, `version` is the optimistic CAS
  token, rehydration is deterministic — but the stream lives in append-only rows keyed by
  `tenant_id` + `session_id`, and rehydration is a SQL-filtered read, not an NDJSON scan.
- Written behind a `SessionBackend` port. The M3 MVP ships `PostgresBackend` (§4) — the
  planned `DuckDbBackend`/MotherDuck track and the `duckdb` dep token are revoked
  (ADR-006 Decision 5).
- The NDJSON **`EventLogStore` is demoted to agent-run provenance** (ADR-006 Decision 6):
  an immutable audit record of `run.*` and bridge events, consumed by the M4 provenance
  dashboard — no longer the source of truth for session data.
- Mutations are **read-modify-write** with optimistic `version` bumping; the event
  append is the commit, so the store and the event stream cannot drift.

## 5. Tweaks — full Langflow envelope, honest execution ceiling

```json
"tweaks": {
  "provider": "groq",
  "member": { "customModel": "qwen" },
  "team":   { "maxStages": 3 }
}
```

| Key | M3 behavior |
|-----|-------------|
| `provider` | **Executes** — overrides the run provider via the config seam. |
| `member` / `team` | **Validated + passed through** on the aggregate. Execution requires agenthood to expose per-member/per-orchestration seams — the graph model (M4) and agenthood-side changes land later. M3 ships the envelope honestly. |

The full envelope is **stored and round-trippable** — never discarded, never mutated
into a saved template, never touches `runTask.ts`.

## 6. Open questions / risks

Resolved:
- Session as event-sourced aggregate — ADR-004 (ADR-004 accepted alongside this plan).
- Per-session SSE in M3 — INCLUDED (`GET /events/{sessionId}`).
- Tweaks — FULL envelope in M3 shape; provider executes, member/team passthrough (§5).
- Cancellation — queued-only (202) in M3.

Still open (tuning / dependency, no architectural impact):
1. **`pg`/`pglite` dependency token (accepted)** — ADR-006 Decision 9 records the
   reviewed-dependency posture; `pg`+`pglite` are accepted with ADR-006. The planned
   `duckdb` token is revoked.
2. **`PostgresBackend` schema — resolved with the backend branch.** `session_events`
   is keyed by `(tenant_id, session_id, seq)` with a `UNIQUE (tenant_id, session_id,
   version)` CAS column, an index on `(tenant_id, correlation_id)`, and `tenant_id`
   defaulting to `'default'` so the auth ADR is additive, not a rewrite. A hand-rolled
   migration runner (applied-versions table, standard SQL, one transaction per
   migration) runs the identical statements on `pglite` (hermetic CI) and managed
   Postgres. The `sessions` snapshot view and tenants/users still land with the auth
   ADR; M3 ships rebuild-on-read.
3. **Aggregate rebuild cadence — resolved.** Rebuild-from-event-rows per read (shipped
   in the backend branch); the maintained `sessions` materialization is the later
   optimization for the auth ADR scale.
4. **`GET /events/{sessionId}` filter** — by `correlationId` (present on run + session
   events) is sufficient; confirm no separate session-scoped event type is required.
5. **Cancel of running** — deferred to M4 with agenthood-side change (§3), per ADR-002
   read-only contract.
6. **Auth ADR pending** — account model, credential handling, and tenant-scoping
   mechanics for §7 are scoped in ADR-006 Decision 7 and land in the auth ADR before
   account-facing routes ship.

## 7. Security & trust boundary (auditor review)

The M3 surface is write-capable and **cost-bearing**: `POST /tasks` enqueues runs
that invoke paid LLM providers, and `GET /tasks` enumerates every session in the
store. It therefore ships behind an explicit trust boundary — auth is a foundation,
not a later feature.

- **Network binding:** M3 binds the server to **loopback only** (`127.0.0.1`) by
  default. Cross-host exposure requires an explicit, documented opt-in; it is not
  the default posture.
- **Authentication:** with accounts first-class (ADR-006 Decision 7), account-facing
  routes ship with the auth ADR — login/session tokens, credential handling, and
  tenant scoping at the data-access boundary. Until that work lands, the pre-auth
  baseline holds: an **optional bearer token** on every mutating and listing route
  (`POST /tasks`, `GET /tasks`, `POST /tasks/{id}/cancel`, `GET /tasks/{id}`,
  `GET /events/{sessionId}`). When `ATLASLINK_API_TOKEN` is set, requests without a
  valid `Authorization: Bearer …` header are rejected with `401`. When unset, the
  server logs a single warning at startup that the API is unauthenticated and must
  not be network-exposed.
- **Authorization:** tenant-scoped by construction — every query carries `tenant_id`
  and is enforced at the data-access boundary (ADR-006 Decision 7), with Postgres
  row-level security applied where it pays. The pre-auth token above is an
  all-or-nothing gate, not a substitute for per-tenant ACLs.
- **Cost abuse:** because `POST /tasks` spends provider quota, the bearer token is
  the primary abuse control. Rate-limiting is out of scope for M3 but noted for M4.

This section resolves the A01/A04 gap raised during the pre-implementation audit:
no endpoint in `feat/3-task-rest` may be implemented without honoring the loopback
default and the token gate above.

## 8. Next actions

1. Land this spec (ADR-004 + `docs/spec/m3-task-api.md` + `docs/tasks/m3-task-api.md`).
2. Start branch `feat/3-session-store`: `SessionBackend` port + log-backed rehydration +
   aggregate rehydration + optimistic versioning.
3. Then `feat/3-task-rest`: REST handlers + per-session SSE + `tweaks` envelope + wiring.
4. Update README/PROGRESS.

## References

- ADR-001 — event log retention via NDJSON (Atlaslink).
- ADR-002 — read-only PROJECTION CONTRACT / live diagram of society provenance.
- ADR-003 — Atlas holds the sky of sessions (Atlaslink).
- ADR-004 — the Session is an event-sourced aggregate; backend track superseded by ADR-006.
- ADR-006 — Fastify HTTP layer + PostgreSQL primary store (this plan's direction).
- [`docs/tasks/m3-task-api.md`](../tasks/m3-task-api.md) — M3 task breakdown.
- Agenthood ADR-021 — read-only PROJECTION CONTRACT.