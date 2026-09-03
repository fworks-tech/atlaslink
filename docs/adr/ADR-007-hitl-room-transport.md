# ADR-007: HITL room transport and question shape

**Date:** 2026-09-03
**Status:** Proposed

## Context
M5 (#76) adds a multi-human realtime room per session: anytime chat, agent
`ask_human` park/resume, human steer/interrupt. The store skeleton
(`awaiting_input` / `user_reply`, `POST …/reply`) exists but no run-path
producer/consumer; SSE is a read-only projection (ADR-002); the queue is
serial FIFO. fx.sh contributes patterns (`ask_user_question`, interrupt/steer,
approval inbox) — not a server. Two decisions block implementation: the
realtime transport and the `question` payload shape.

## Decision
(TBD in review — recommendation:)
- Transport: WebSocket channel `/sessions/:id/room` for presence + fan-out;
  all state ingress still commits via the event-sourced `SessionBackend`
  (store is truth, WS/SSE are projections). SSE remains the read-only tail.
- Question: fx-shaped `{questions:[{label,description,options}]}` with
  plain-string `question` kept backwards compatible.

## Alternatives Considered
| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| SSE+POST only, no WS | No new protocol; matches current stack | No presence/typing; multi-human fan-out is polling | Rejected per #76 (WS room chosen) |
| WS as source of truth | Lower latency | Splits truth from event log; breaks ADR-002/004 | Rejected — store stays the commit |
| String-only question | Simplest | Cannot render fx-style option pickers | Rejected — keep compat, add shape |
| Full fx embed now | Inherits tools/MCP/skills | Zig/WASM ops, no Windows addon, SDK churn | Deferred to parallel spike |

## Consequences
Easier: true mid-run collaboration with tenant-scoped realtime. Harder: new
protocol surface (auth, rate-limit, ordering), lane scheduling, parked-worker
accounting (wait-forever policy). Lanes land before park (Stage 2 before
Stage 3), and park releases the pump slot with reply re-queueing — so
wait-forever cannot deadlock the serial pump. Risks: serial-queue starvation without lanes;
WS reconnect/resume semantics; interrupt partial-output semantics (needs
agenthood `run.interrupted` event).

## References
- Issue #76; `docs/spec/m5-hitl-room.md`; `docs/tasks/m5-hitl-room.md`.
- ADR-002 (read-only projection), ADR-003, ADR-004, ADR-006.
- fx.sh `https://fx.sh/`, `https://fx.sh/llms.txt`,
  `https://github.com/vercel-labs/fx`.
