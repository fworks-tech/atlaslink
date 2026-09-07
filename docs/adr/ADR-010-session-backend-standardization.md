# ADR-010: Standardize SessionBackend Without a Checkpointer Rename

**Date:** 2026-09-07
**Status:** Accepted
**Issue:** #189

---

## Context

ADR-009 proposed four LangGraph-inspired phases, including an "interface
standardization" to a checkpointer-shaped 5-method contract
(`put/putWrites/getTuple/list/deleteSession`). Issue #189 tracked it as a
release blocker on the premise that backend methods were inconsistent.

Auditing the code first showed the premise was stale: `SessionBackend` is a
single enforced interface implemented by all three backends
(`SessionStore`, `EventLogBackend`, `PostgresBackend`). The real drift was:

- `withTenant?` was **optional** on the port, so the factory carried a runtime
  `typeof` probe — an implicit contract enforced nowhere.
- `deleteSession` existed in the target pattern but not in the port at all.
- Two parallel conformance harnesses (`backendContract.ts`, `conformance.ts`)
  tested ~80% of the same semantics, and `EventLogBackend` — the default
  durable store — was bound to neither.

Renaming `append`→`put`, `get`→`getTuple` would have been a cosmetic break of
every call site with zero semantic gain: in an event-sourced store the event
append *is* the checkpoint write; the aggregate is derived, not passed in.

## Decision

Standardize by hardening the existing port instead of renaming it:

1. Add `deleteSession(sessionId): Promise<void>` — purge semantics
   (SessionStore/Postgres) with a `session.deleted` tombstone where the log is
   append-only (EventLogBackend). Re-append after delete yields version 1.
2. Make `withTenant` required; delete the factory's runtime probe.
3. Retire `conformance.ts`; fold its unique coverage (large streams,
   concurrent appends) into the single `backendContract`, bind
   `EventLogBackend` to it, and pin delete/tenant semantics with new cases.
4. Publish a porting guide in `src/session/README.md`.

When #190 (pending writes) lands, it arrives as a new port method on this
contract — the capability ADR-009 actually wanted from `putWrites` — not as a
rename exercise.

## Alternatives Considered

| Option | Why Considered | Why Rejected |
|--------|---------------|-------------|
| Literal 5-method checkpointer rename | Matches ADR-009's wording, aligns with LangGraph docs | Breaking change to every caller for names only; semantics already equivalent; loses the event-sourcing story the names tell |
| Keep everything as-is | It works | `withTenant` drift and the missing `deleteSession` stay implicit, and #190 would have no contract to extend |
| Harden the port (chosen) | Small diff, same destination | — |

## Consequences

- Every backend swap is behavior-pinned by one suite, including the NDJSON
  store that shipped untested against it before.
- `session.deleted` appears in the `SessionEvent` union as a tombstone marker;
  reducers never observe it because backends filter at replay.
- ADR-009's phase list is refined, not reversed: delta channels (#187) and
  pending writes (#190) still land, as additions to this contract.

## References

- ADR-004 (event-sourced session layer), ADR-009 (LangGraph-inspired evolution)
- Issue #189, PR #213-era BFF incident (conformance suites pay for themselves)
