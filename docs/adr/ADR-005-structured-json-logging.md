# ADR-005: Structured JSON Logging with Explicit `correlationId` Threading

**Date:** 2026-08-24
**Status:** Accepted
**Issue:** #24 (observability)

## Context

M1/M2 ship with ad-hoc `console.*` calls. M3 introduces concurrent sessions, an
auth-gated cost-bearing API, and the need to triage a failing session among many
running at once. Today:

- No log line carries `correlationId`, even though `Session.correlationId` already
  exists (`src/tasks/taskRegistry.ts`) and is already threaded into the agenthood
  run context at `src/daemon/runTask.ts`.
- There are no log levels and no timestamps.
- Three failure paths are fully swallowed: the queue-runner `catch` at
  `src/server.ts`, and the append/rotation failure paths in
  `src/bridge/EventLogStore.ts`.

A structured logger is needed. It must not introduce dependencies — ADR-004 lifted
the zero-new-deps invariant *only* for the session store, so the logger is built
on Node primitives alone.

## Decision

1. Add `src/log.ts`: a zero-dependency logger that emits **one JSON object per
   line** — `{ "ts": <ISO>, "level": <level>, "msg": <string>, "correlationId"?: <string>, ...fields }`
   — to **stderr only**. stdout stays reserved for the human-facing result text
   (`src/server.ts` `✔`/`✘` lines) so a piped `stdout` stays clean.
2. Level is controlled by `ATLASLINK_LOG_LEVEL`
   (`debug | info | warn | error`, default `info`), resolved **per emit** (not
   cached at import) so it is safely toggleable in tests.
3. `correlationId` is passed **explicitly as a log field** on session-scoped
   paths (queue runner, `runOnce`, `POST /runs`). No implicit global context.
4. **Swallow boundary (explicit):**
    - *Logged-but-not-thrown* (become visible): `EventLogStore` append failure,
      `EventLogStore` rotation failure, unexpected throw in the queue-runner `catch`
      at `src/server.ts`. Note: this `catch` only triggers on `registry.start` /
      subscribe-time setup failures — run-time task errors are swallowed *inside*
      `runSession` (`src/daemon/runTask.ts`) and returned as a failed session, not
      re-thrown here. The boundary is narrower than "any `runSession` throw".
   - *Still silent-by-design* (unchanged, corrupt-tail tolerance):
     `#readLines` unreadable-line skip, `#writeSeq` sidecar write failure.

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|--------------|
| pino / winston | Standard structured loggers | New dependency; ADR-004 only lifted deps for the session store | Violates the dependency policy outside its scoped exception |
| AsyncLocalStorage auto-context | Auto-attaches `correlationId` across async hops | Implicit global state; harder to test | Explicit field is simpler, more testable, matches the codebase's no-magic style |
| All logs to stdout (12-factor) | Conventional for app logs | Mixes JSON with the human result text on stdout | stderr keeps stdout pipe-clean for the `✔`/`✘` output |

## Consequences

**Easier:**
- Concurrent-session debugging — filter logs by `correlationId` with `jq`/`grep`.
- Swallowed failures become visible.
- Level-gated verbosity for CI (warn) vs local (debug).

**Harder:**
- None significant.

**New risks:**
- Log volume under high session churn — mitigated by `ATLASLINK_LOG_LEVEL` and the
  explicit swallow boundary above.

## References

- ADR-001 — event log retention via NDJSON (Atlaslink, Accepted).
- ADR-004 — the Session is an event-sourced aggregate (backend track superseded by ADR-006); dependency policy now per ADR-006 Decision 9.
- Issue #24 — observability tracking.
- Auditor A09 — authentication failures must be logged (auth-failure logging lands in `feat/3-task-rest`, per spec §7).
