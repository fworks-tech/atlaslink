# ADR-004: The Session is an Event-Sourced Aggregate, Materialized in DuckDB

**Date:** 2026-08-23
**Status:** Accepted — resolves the M3 session-store durability decision deferred in ADR-001 (M3 MVP ships rebuild-on-read from NDJSON; the DuckDB backend is deferred to a later phase)
**Issue:** M3 Task API
**Amended by:** ADR-006 (Decisions 4–5) — the NDJSON/DuckDB session-backend track is
superseded; sessions persist to Postgres event tables behind the same `SessionBackend`
port. Decisions 1–2 and 4 of this ADR stand unchanged.

## Context

ADR-001 explicitly deferred the durable-store choice for Atlaslink's records to a
later milestone. M3 — the Task API — is that milestone. M3 turns "Atlas holds the
sky of sessions" (ADR-003) from a documented identity into shipped structure: a
durable, programmatic HTTP surface that drives, holds, and reopens sessions.

The critical clarification that shaped this ADR is **what a Session is**. A Session is
**not** a log and not a finished task row. It is a **live, authoritative work-document**
— the ongoing artifact of the interaction between Atlas and the user:

- It holds the **live diagram** (current nodes, edges, gate-statuses, what is running
  right now).
- It holds the **interaction** (the ordered chat turns between Atlas and the user:
  prompts, replies).
- It **determines what happens next** — the orchestrator reads the Session's current
  state to decide the next step. It is state the runtime *reads to continue*, not a
  residue it *writes after the fact*.

This demotes the two obvious storage candidates:

- A plain **NDJSON/event log** is an **audit trail** — immutable, append-only, good for
  provenance (ADR-002) but *wrong* as the live truth of an in-flight document.
- A **CRUD table of terminal session rows** is *wrong in the opposite direction*: it
  pitches a finished thing, not a living one being mutated right now.

The correct model is **event sourcing**: the immutable event stream is the source of
truth, and the Session is an aggregate **rehydrated** from those events.

## Decision

1. **The event stream is the source of truth.** The existing NDJSON `EventLogStore`
   (ADR-001/ADR-002) remains the immutable, causal, durable record of *what happened*.
   It is never rewritten.

2. **The Session is a rehydrated aggregate.** Atlaslink reads the persisted run/
   session events for a given `correlationId` and applies them to build the current
   `Session` document: identity, interaction turns, tweaks, lifecycle, and (schema
   reserved in M3) the live diagram graph state.

3. **The Session is a rehydrated aggregate, read from the NDJSON log (rebuild-on-read)
   in the M3 MVP.** The log is the source of truth; `SessionStore` rebuilds the current
   aggregate from it on each read. A **DuckDB-backed `SessionBackend`** is the intended
   later optimization that adds SQL queryability and a cached materialization; it is
   deferred until an analytics/query need justifies the new dependency. Until then the
   store stays zero-new-deps and hermetic. The two compose rather than duplicate: log =
   durability + provenance, DuckDB (later) = live readable state + SQL. `GET /tasks?
   status=failed` and dashboard queries become real SQL when DuckDB lands, not
   hand-rolled scans.

4. **Sessions are mutable, versioned aggregate documents.** A node gate flip or a new
   chat turn is a **read-modify-write** on the live aggregate, protected by optimistic
   **`version`/`revision` concurrency** so two writes cannot silently clobber the live
   state.

5. **A session backend port isolates cloud from local.** The store is defined behind a
   `SessionBackend` interface. M3 ships only the NDJSON-backed `EventLogBackend` (local,
   offline, hermetic in CI). A **DuckDbBackend**
   is the later materialization step of Decision 3; a **MotherDuck** remote backend is
   designed-as-a-port but built later — a Session is a document/chat/state problem more
   than a warehouse problem, so cloud earns its keep only when sessions must be shared
   collaboratively (the SaaS future). No config-gated SaaS/local fork in the product layer
   (a known Langflow scar).

6. **The zero-new-deps policy is preserved for the M3 MVP; the `duckdb` lift is
   deferred.** Durability and queryability were deferred *to* M3, and M3 achieves
   durability via the existing NDJSON log (rebuild-on-read) without a new dependency.
   The `duckdb` npm package is pulled in **only when the DuckDB `SessionBackend` is
   built** (a later phase), not for the M3 MVP. This ADR scopes the zero-new-deps
   lift **to that future backend only**, for the duration it is active.
   `runTask.ts`, `taskRegistry.ts`, and the event bridge remain dependency-lean.

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| In-memory `TaskRegistry` only (status quo) | Zero new deps; already shipped | Sessions lost on restart; Atlas as "book of maps" stays a metaphor; no queryability | Contradicts ADR-003's durable, reopenable sessions; ADR-001 deferred the store to this milestone |
| Extend NDJSON (sessions as a second log) | Consistent with existing event pattern; zero deps | No indexes, no ACID, no concurrency/update-in-place, no SQL; reimplements rotation/cursor/corrupt-tail for a *different* need | The Session is mutable and authoritative — an append-only log is an audit trail, not a live document |
| PostgreSQL / LanceDB now | Robust, queryable | Heavy ops; ADR-001 deferred; back -load now | DuckDB delivers SQL + a clean MotherDuck on-ramp without the ops burden |
| DuckDB as terminal-Row table only | Simplest DuckDB shape | Treats the Session as finished, not living; loses mutation/rehydration | Wrong mental model — Sessions are in-flight and determine next steps |

## Consequences

**Easier:**
- Durability without a hosted dependency: embedded DuckDB is local and offline, keeping
  the hermetic CI suite intact (MotherDuck backend never runs in CI).
- SQL queryability over sessions/chat turns/timelines — ready for the M4 dashboard and
  future analytics.
- A clean cloud on-ramp: pointing the backend at MotherDuck later is a port swap, not a
  rewrite.
- Event-sourcing preserves ADR-002's provenance story: the immutable log rebuilds any
  Session, so you can never lose or corrupt "what happened."

**Harder:**
- A new dependency (`duckdb`) in M3 — requires disciplined scoping to the session store.
- Concurrency is now real: optimistic versioning must be correct, and tested.
- Rehydration must be correct and deterministic: two consumers of the same log must
  rebuild identical Session documents.

**New risks:**
- The aggregate and the log drifting if a mutation is written to DuckDB without an
  event being appended (mitigated by treating the event append as the commit).
- DuckDB's embedded-file concurrency model must be respected in a single-daemon process
  (M3 is serial anyway — one session at a time per the SessionQueue).

## References

- ADR-001 — event log retention via NDJSON (Atlaslink, Accepted).
- ADR-002 — read-only PROJECTION CONTRACT / live diagram of society provenance.
- ADR-003 — Atlas holds the sky of sessions (Atlaslink, Accepted).
- Agenthood ADR-021 — read-only PROJECTION CONTRACT.
- [`docs/spec/m3-task-api.md`](../spec/m3-task-api.md) — the M3 Task API plan.