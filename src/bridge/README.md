# src/bridge — the Event Bridge (M2)

Bridges agent-execution events from the daemon to clients. Everything crossing the
wire is a **bridge envelope** (`{ eventId, type, ... }`); this layer persuades it
onto disk (NDJSON) and out to browsers (SSE) while never rewriting it (ADR-002).

## Modules

| File | Responsibility |
|------|----------------|
| `EventLogStore.ts` | Append-only, 10 MB × 3 rotating NDJSON log (ADR-001). Monotonic `eventId` cursor restored from sidecar + tail scan; failures swallowed so the live stream never blocks on disk. |
| `EventBroadcaster.ts` | Assigns `eventId`, persists the envelope, fans it out verbatim to subscribers; replays the recent `highWaterMark` for slow subscribers; `detectGap()` surfaces the first hole. |
| `SessionQueue.ts` | Serial FIFO session worker (ADR-003). Sessions run strictly one at a time; every lifecycle transition is mirrored as a `session.*` event because the `RunEventBus` has no "queued" state. |
| `sseEndpoint.ts` | `SseHandler` for `GET /events`: `Last-Event-ID` resume, stale-resume `bridge.gap`, 15 s `: ping`, graceful `bridge.shutdown`, no `request` log line. `formatSse` serializes the envelope per spec §4. |
| `insights.ts` | Pure aggregator (`buildInsightsReport`) over trace envelopes: cost/token/reliability grouped by member and model, plus optimization-lever rankings and a cost trend. Used by the CLI `insights` command. |

## Invariants

- **Verbatim envelopes (ADR-002):** the emitter owns `type`; the bridge never
  rewrites it or injects fields.
- **Swallow-write:** a failed append/rotation logs a warning and the stream keeps
  flowing (ADR-005 live-stream-never-blocks rule).
- **Deterministic replay:** rotation files are read oldest → newest so replay order
  matches emission order.
- **Serial execution:** all runs route through `SessionQueue`; nothing in the HTTP
  layer drives `runTask` inline.

## Tests

`*.test.ts` here run against real sockets and temp log dirs, fully hermetic.
`sseEndpoint.test.ts` is the contract gate for the Fastify rewrite (ADR-006
Decision 2) — it must pass unchanged.