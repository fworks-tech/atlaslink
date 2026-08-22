# M2 Event Bridge — Task Breakdown

**Source of truth:** [`docs/spec/m2-event-bridge.md`](../spec/m2-event-bridge.md)
**Issue:** #4 (M2 Event Bridge)
**Status:** Proposed — branch plan, not yet implemented

The M2 implementation is split into stacked, revert-safe branches. Each branch lands
independently and keeps the full hermetic suite green (no LLM, no provider key). Each
branch is fully defined by the spec; the per-branch file list and test counts below are
the contract this breakdown tracks.

```
main → docs/4-m2-event-bridge → feat/4-event-log-store → feat/4-event-broadcaster → feat/4-session-queue → feat/4-sse-endpoint
```

## Branch 1 — `docs/4-m2-event-bridge` (documentation)

- [x] `docs/adr/ADR-001-event-log-retention.md` — Status: Accepted, resolves issue #5
- [x] `docs/spec/m2-event-bridge.md` — transport decision, ADR-001 resolution, `GET /events` contract, resolved scope
- [x] `docs/tasks/m2-event-bridge.md` — this breakdown

## Branch 2 — `feat/4-event-log-store`

- New: `src/bridge/EventLogStore.ts` + `src/bridge/EventLogStore.test.ts`
- `open(dataDir)`; `append(event)`; `replay(readAfter)`; `oldestId`
- 10 MB × 3 rotation (`events.ndjson`, `.1`, `.2`); monotonic `eventId` never resets
- Corrupt-tail tolerance; swallow-write-failure (stream never blocks on disk)
- Expected: 7 new tests; existing 17 stay green

## Branch 3 — `feat/4-event-broadcaster`

- New: `src/bridge/EventBroadcaster.ts` + `.test.ts`
- Monotonic `eventId`; fan-out to subscribers; per-client replay + `bridge.gap`
- Slow-client eviction (1 MB); subscriber-error isolation
- Expected: 6 new tests

## Branch 4 — `feat/4-session-queue`

- New: `src/bridge/sessionQueue.ts` + `.test.ts`
- Serial FIFO worker with injected runner (hermetic)
- Emits `session.queued/started/succeeded/failed`; terminal status read from the registry
- `src/tasks/taskRegistry.ts`, `src/daemon/runTask.ts` remain untouched
- Expected: 6 new tests

## Branch 5 — `feat/4-sse-endpoint`

- New: `src/bridge/sseEndpoint.ts` + `.test.ts`
- Wiring in `src/server.ts` (`listen()` opens store → broadcaster → queue)
- `GET /events` (SSE) with `Last-Event-ID` replay; provisional `POST /runs` ("M3 preview")
- README / PROGRESS documentation update
- Expected: 7+ tests + 1 E2E

## Cross-branch invariants

- **Untouched:** `src/daemon/runTask.ts`, `src/tasks/taskRegistry.ts`, `src/config.ts`,
  `tsconfig.json`, `package.json`
- **Zero new deps** — native `node:http` SSE only
- **Read-only contract:** `run.*` events pass through verbatim; `session.*`/`bridge.*`
  are namespaced extension events (ADR-002)
- Test glob `node --test src/**/*.test.ts` picks up `src/bridge/` with no config change
- Total target: ~43 hermetic tests (17 existing + ~26 new)