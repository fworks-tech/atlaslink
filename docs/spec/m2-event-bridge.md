# M2 Event Bridge — Plan (agenthood-ratified)

**Date:** 2026-08-22
**Status:** Shipped — implemented by ADR-001 (Accepted) and the M2 implementation branches
**Issue:** #4 (M2 Event Bridge)

Ratified by an Agenthood Society planning session (the-strategist, the-architect,
the-oracle). All member outputs verified against the installed agenthood runtime.

---

## 1. Problem statement (the-strategist)

The problem is a **transport gap**: in-process `RunEventBus` events are not exposed
as a browser-consumable stream. M2 closes that gap streaming events from the daemon
to the browser in real time, honoring the read-only projection contract (ADR-002,
Agenthood ADR-021).

### Success criteria (testable)

1. Ordered SSE stream — events reach the client in the order the bus emitted them.
2. Last-Event-ID resume — a reconnecting client resumes without a black hole.
3. Pure-projection enforcement — `run.*` events pass to the wire verbatim; no rename,
   enrich, filter, or gate re-derivation.
4. All 8 `RunEvent` types covered: `run.started`, `reasoning`, `tool.called`,
   `tool.result`, `decision.recorded`, `provenance.recorded`, `run.finished`,
   `run.failed`.
5. Serial queue discipline — one session runs at a time; concurrent enqueues serialize.
6. Zero new deps — native `node:http` SSE only.
7. Clean shutdown — active SSE connections receive a distinct end frame (SIGINT/SIGTERM).

### Ranked priorities

correctness (ordering + gate fidelity) > read-only contract > queue discipline >
ops hygiene > testability > reconnect replay.

## 2. Transport decision (the-architect): SSE wins over WebSocket

- One-way flow matches the read-only projection contract — M2 is events→browser only.
- Browser `EventSource` gives automatic reconnection and the `Last-Event-ID` header
  for free — the exact resume mechanic, zero client code, zero server deps.
- Zero new runtime deps (native `node:http`), honoring the zero-deps policy.
- M3 is unaffected: its control surface stays plain HTTP (`POST /tasks` → queue).
  WebSocket is only needed for a bidirectional push channel, which M3 does not need.

## 3. ADR-001 resolution: resolve now via NDJSON retention (the-architect)

The architect overruled deferring: replay without persistence is dishonest.

- `data/` is **already gitignored**. (`data/events.ndjson` — rotation 10 MB × 3,
  `eventId` counter never resets; replay beyond retention surfaces as `bridge.gap`,
  never silence.)
- The pattern is already the org's own: agenthood's `JSONFileTraceStore` writes
  `.agenthood/traces/traces.ndjson`.
- Deliverable: `docs/adr/ADR-001-event-log-retention.md` (Status: Accepted, resolves
  issue #5).

## 4. API surface — `GET /events` (SSE)

```
GET /events                          Accept: text/event-stream
HTTP/1.1 200
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### Framing (verbatim passthrough)

```
id: 12
event: tool.called
data: {"eventId":12,"type":"tool.called","executionId":"e-…","member":"the-architect","correlationId":"cor-…","timestamp":"…","step":1,"name":"read_file","args":{…}}
```

- `id` = replay cursor (`eventId`).
- `event:` = the `RunEvent` type.
- `data:` = one JSON line: the full `RunEvent` + `eventId`. `JSON.stringify` escapes
  embedded newlines (pinned by regression test).
- `run.*` events verbatim — read-only contract.

### Extension events (namespaced, distinct from runtime `run.*`)

- `session.*` — `{eventId, type, sessionId, correlationId, member, status, at}`.
  The only way M4 shows queued sessions (ADR-003 names Atlas as session holder).
- `bridge.gap` — `{requested, oldest}`: identifies replay older than the retention
  window. Replay is never silent.
- `bridge.shutdown` + `res.end()` on SIGINT/SIGTERM — distinguishes a controlled
  stop from a network blip.
- `: ping` comment frame every 15 s idle.

### Reconnect / replay

- `Last-Event-ID: N` → emit all retained events with `eventId > N`, then live-tail
  (anti-black-hole).
- First connect, no header: live tail only; M4 sends `Last-Event-ID: 0` to bootstrap
  the full history.
- Stale request (`requested < oldestId`) → `event: bridge.gap`.

## 5. Task breakdown (stacked branches, each revert-safe)

```
main → docs/4-m2-event-bridge → feat/4-event-log-store → feat/4-event-broadcaster → feat/4-session-queue → feat/4-sse-endpoint
```

| # | Branch | Work | File(s) | Testable via |
|---|---|---|---|---|
| 1 | `docs/4-m2-event-bridge` | ADR-001 (Accepted), M2 spec, task breakdown | `docs/adr/ADR-001-event-log-retention.md`, `docs/spec/m2-event-bridge.md`, `docs/tasks/m2-event-bridge.md` | review |
| 2 | `feat/4-event-log-store` | `EventLogStore`: open/append, replay (`readAfter`), `oldestId`, 10 MB × 3 rotation, corrupt-tail tolerance, swallow-write-failure | `src/bridge/EventLogStore.ts` + `.test.ts` | 7 tests |
| 3 | `feat/4-event-broadcaster` | monotonic `eventId`, fan-out, per-client replay + `bridge.gap`, slow-client eviction, subscriber-error isolation | `src/bridge/EventBroadcaster.ts` + `.test.ts` | 6 tests |
| 4 | `feat/4-session-queue` | serial FIFO worker (injected runner for hermeticity), `session.queued/started/succeeded/failed`, terminal-from-registry | `src/bridge/SessionQueue.ts` + `.test.ts` | 6 tests |
| 5 | `feat/4-sse-endpoint` | `GET /events` handler, wiring in `src/server.ts` (`listen()` opens store→broadcaster→queue), provisional `POST /runs`, README/PROGRESS | `src/bridge/sseEndpoint.ts` + `.test.ts`, `src/server.ts`, `src/server.test.ts` | 7+ tests + 1 E2E |

**Untouched:** `src/daemon/runTask.ts`, `src/tasks/taskRegistry.ts`, `src/config.ts`,
`tsconfig.json`, `package.json`. The `node --test src/**/*.test.ts` glob picks up
`src/bridge/` with no config change. ~26 new tests → ~43 total, all hermetic (fake
runner, no LLM, no provider key).

## 6. Open questions / risks

Resolved (2026-08-22, explore agent, evidence in repo):

1. **`POST /runs` in M2 — RESOLVED: SHIP it** (as labeled "M3 preview",
   `{member, prompt}` → `202 {session}`), routed THROUGH the branch-4
   `SessionQueue` — never a direct `runSession` call. Justification: the driver
   path is proven by `runOnce`/`runSession` (`server.ts:34-52`,
   `runTask.ts:19-25`); `listen()` already owns a registry and receives the full
   config (`server.ts:55,96`); serial discipline (success criterion 5) requires
   queue routing and the queue branch precedes the SSE branch; it is the only
   live/E2E trigger; M3 scope is protected by the "M3 preview" label and the
   absence of a data model.
4. **`session.*` extension events — RESOLVED: SHIP them** (emitted by the
   branch-4 `SessionQueue`, NOT from the registry — `taskRegistry.ts` and
   `runTask.ts` remain untouched). Justification: the bus cannot represent
   `queued` or fail-before-any-event (proven by `runTask.test.ts:133-148`);
   `start` precedes subscribe so `session.started` can't be faithfully derived
   from `run.started` (`runTask.ts:26,33`); framing already ratified
   (`§4`); namespaced Addition — no ADR-002 violation (read-only contract binds
   runtime telemetry, not Atlaslink-side session events); M4's queued-session
   view depends on it (ADR-003 names Atlas as session holder).

Still open (tuning, no scope impact):

2. Retention defaults — 10 MB × 3 rotated files vs per-day files (counter never
   resets either way).
3. First connect: live-tail (recommended) vs replay-from-0.
5. `correlationId` — pass through as received (recommended).
6. Boot-time tail scan (O(n), recommended) vs `data/events.seq` sidecar for seq resume.
7. Slow-client threshold (1 MB) / heartbeat (15 s) — tuning knobs.
8. Top technical risk: tapping `runSession`'s per-run `onEvent` seam without
   refactoring or coupling to a global bus — mitigated: the seam exists
   (`runTask.ts` `onEvent`) and subscriber-error tolerance is already M1-tested.

## 7. Next actions

1. Land branch 1 docs: ADR-001 (Accepted, resolves #5), M2 spec, task breakdown —
   record SSE, NDJSON, verbatim passthrough before any code.
2. Start branch 2: `EventLogStore.open(dataDir)` + `append` with the fake-app/M1
   test pattern; expect 17 existing + 7 new green; no config changes.
3. Branch 4 `SessionQueue` emits `session.queued/started/succeeded/failed`;
   branch 5 handles `POST /runs` + `GET /events` + `src/server.test.ts`.

## References

- ADR-001 — event log retention via NDJSON (Atlaslink, Accepted).
- ADR-002 — live diagram of society provenance (Atlaslink).
- ADR-003 — Atlas holds the sky of sessions (Atlaslink).
- Agenthood ADR-021 — read-only PROJECTION CONTRACT.
- Agenthood PR #475 — `feat/issue-474-run-event-feed`: RunEventBus base.
- Issue #4 — M2 Event Bridge; Issue #5 — ADR-001 persistence decision.