# ADR-001: Event Log Retention via NDJSON

**Date:** 2026-08-22
**Status:** Accepted
**Resolves:** issue #5
**Replaces:** the deferral debated during the M2 planning session

## Context

M2 (Event Bridge, issue #4) exposes the daemon's in-process `RunEventBus` events as a
browser-consumable SSE stream. Its success criteria require **ordered delivery** and
**Last-Event-ID resume** — a reconnecting client must not hit a black hole, and a stale
request must be flagged, never silently dropped.

A replay that cannot recall the past is dishonest: `Last-Event-ID` resume only has
meaning if the server can actually re-serve the events the client missed. That requires
persisting the event stream to disk. The M2 planning session (the-strategist,
the-architect, the-oracle) considered deferring persistence to M4 and rejected the idea:
replay-without-persistence would force either a fake resume or an unbounded in-memory
buffer that dies with the process.

The question for this ADR is the persistence format and retention policy for the
replayable event log.

Two facts make NDJSON the obvious choice:

- `data/` is **already `.gitignore`d** with the comment "Atlaslink runtime data (event
  log, session store)" — the location was reserved for exactly this.
- The pattern is the org's own: agenthood's `JSONFileTraceStore` persists
  `.agenthood/traces/traces.ndjson` as one JSON envelope per line, with a retention
  manager. Atlaslink reuses the idiom rather than inventing a new one.

## Decision

Persist the M2 event log as an append-only NDJSON stream at `data/events.ndjson`, with
rotation and a monotonic cursor:

1. **Format:** one JSON line per event — the full `RunEvent` payload plus a
   monotonically increasing `eventId`. Append-only; no rewrites, no sidecar index.

2. **Rotation:** 10 MB × 3 rotated files (`events.ndjson`, `events.ndjson.1`,
   `events.ndjson.2`). On crossing the size cap, the current tail is renamed to
   `.1`, `.1`→`.2`, and the oldest dropped.

3. **Cursor:** the `eventId` counter **never resets** — neither on restart nor on
   rotation. Clients address replay by `eventId`; a gap in requested coverage surfaces
   as `event: bridge.gap`, never as silence.

4. **Replay semantics:**
   - `Last-Event-ID: N` → serve all retained events with `eventId > N`, then live-tail.
   - Request older than retention (`requested < oldestId`) → `bridge.gap`.

5. **Failure tolerance:** a corrupt tail line is skipped (repairable), and a failed
   append is swallowed (the live stream never blocks because disk is slow).

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| Newline-delimited JSON (NDJSON) append file (chosen) | Zero deps; append-only; one JSON line per event; trivially replayable; matches agenthood's `JSONFileTraceStore` | Rotation needed to bound size; no random access | Chosen — simplest honest persistence |
| Per-day files (`events-2026-08-22.ndjson`) | Human-identifiable shards; easy archival | More moving parts; cursor span across shards must be tracked; not needed at M2 | Deferred — a tuning option in the M2 spec (issue #177 is not implicated) |
| In-memory ring buffer only | Zero I/O, zero disk | Dies with the process; resume is a lie; unbounded stale clients' choice of history | Rejected — replay without persistence is dishonest |
| SQLite / embedded DB | Queries, indexes, robust | New dependency (violates zero-deps); overkill for append-forward replay | Rejected — M2 is append + filter only |
| JSON document store (one file per event) | Isolation | Many small files; inefficient replay | Rejected — NDJSON gives isolation without the file count |

## Consequences

**Easier:**
- The SSE endpoint's `Last-Event-ID` replay is honest and bounded.
- Rotation bounds disk usage; the monotonic cursor keeps semantics stable across
  restart and rollover.
- No new dependencies; the idiom already exists in agenthood (`JSONFileTraceStore`).
- `data/` is already reserved and ignored, so no git hygiene change.

**Harder:**
- Replay that crosses a rotation boundary must read multiple files in order.
- The boot-time tail scan (O(n)) is needed to restore the cursor after restart, unless
  a `data/events.seq` sidecar is added later (recorded as a tuning option in the spec).
- Retention defaults (10 MB × 3 vs per-day) remain a tuning knob, not a blocker.

**New risks:**
- Disk write latency could theoretically interfere with live streaming — mitigated by
  swallowing append failures (decision 5) so the stream never blocks on disk.

## References

- Issue #5 — the persistence decision this ADR resolves
- Issue #4 — M2 Event Bridge, whose success criteria require these semantics
- ADR-002 — read-only projection contract (the event log never re-derives `run.*`)
- Agenthood `JSONFileTraceStore` — the NDJSON + retention idiom this reuses