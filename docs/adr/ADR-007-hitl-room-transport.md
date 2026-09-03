# ADR-007: HITL room transport and question shape

**Date:** 2026-09-03
**Status:** Accepted (Stage 5 shipped; question object decided in Stage 3 with no string back-compat — supersedes the "keep compatible" recommendation below)

## Context
M5 (#76) adds a multi-human realtime room per session: anytime chat, agent
`ask_human` park/resume, human steer/interrupt. The store skeleton
(`awaiting_input` / `user_reply`, `POST …/reply`) exists but no run-path
producer/consumer; SSE is a read-only projection (ADR-002); the queue is
serial FIFO. fx.sh contributes patterns (`ask_user_question`, interrupt/steer,
approval inbox) — not a server. Two decisions block implementation: the
realtime transport and the `question` payload shape.

## Decision
- Transport: WebSocket channel `/sessions/:id/room` for presence + fan-out;
  all state ingress still commits via the event-sourced `SessionBackend`
  (store is truth, WS/SSE are projections). SSE remains the read-only tail.
- Question: unified single-question `{question: string, context?: string}`
  (agenthood #502, `AskHumanSignal.payload`; caps
  `ASK_HUMAN_MAX_QUESTION_LENGTH=4000` /
  `ASK_HUMAN_MAX_CONTEXT_LENGTH=1000`). The park event is
  `run.awaiting_input {question, context?, durationMs}`; the store seam
  mirrors `session.awaiting_input {question, context?}` and keeps
  `nextStep.prompt` as the question string; the resume fold is the
  single-question `<human_reply question="…" context="…">`. No
  questions-array, no labels/options, no string back-compat — this supersedes
  the fx-shaped recommendation below.

## Alternatives Considered
| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| SSE+POST only, no WS | No new protocol; matches current stack | No presence/typing; multi-human fan-out is polling | Rejected per #76 (WS room chosen) |
| WS as source of truth | Lower latency | Splits truth from event log; breaks ADR-002/004 | Rejected — store stays the commit |
| String-only question | Simplest | Cannot carry context threading | Rejected — unified shape carries both |
| Full fx embed now | Inherits tools/MCP/skills | Zig/WASM ops, no Windows addon, SDK churn | Deferred to parallel spike |

## Consequences
Easier: true mid-run collaboration with tenant-scoped realtime; one question
shape end to end (`ask_human` → `run.awaiting_input` → `session.awaiting_input`
→ room snapshot/inbox → `session.user_reply` → linked follow-up fold), so the
dashboard inbox is question + context + composer with no option-picker branch.
Harder: new
protocol surface (auth, rate-limit, ordering), lane scheduling, parked-worker
accounting (wait-forever policy). Lanes land before park (Stage 2 before
Stage 3), and park releases the pump slot with reply re-queueing — so
wait-forever cannot deadlock the serial pump. Risks: serial-queue starvation without lanes;
WS reconnect/resume semantics; interrupt partial-output semantics (needs
agenthood `run.interrupted` event).
Dashboard corollary (Stage 5): the browser holds no room socket — the bearer
stays server-side in the BFF and route handlers cannot proxy upgrades — so
the dashboard joins over POST ingress + SSE projection with presence as a
short poll of `GET /sessions/:id/room/members`. No token ever reaches the
client bundle; no new protocol for the dashboard to speak.

## References
- Issue #76; `docs/spec/m5-hitl-room.md`; `docs/tasks/m5-hitl-room.md`.
- ADR-002 (read-only projection), ADR-003, ADR-004, ADR-006.
- fx.sh `https://fx.sh/`, `https://fx.sh/llms.txt`,
  `https://github.com/vercel-labs/fx`.
