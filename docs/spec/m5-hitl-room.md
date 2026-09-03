# Spec: M5 HITL collaboration room for live sessions

**Date:** 2026-09-03
**Status:** Proposed — draft for review
**Issue:** #76

Derived from the fx.sh study (single-agent Zig harness; reusable patterns are
`ask_user_question`, permission triage, interrupt/steer — no hosted session bus
to reuse) and the Atlaslink session flow (`POST /tasks` → `SessionQueue`
serial pump → `runSession` → `RunEventBus` → SSE read-only projection).

## Problem
Sessions run to completion with no live human input. The store already has
`queued|running|awaiting_input|succeeded|failed|cancelled`, events
`session.awaiting_input {question}` / `session.user_reply {reply}`,
`interaction[]`, `nextStep`, and `POST /tasks/:id/reply`
(`src/session/types.ts:1`, `src/session/sessionStore.ts:105`,
`src/api/tasks.ts:194`), plus a `SessionThread` composer in the dashboard —
but nothing in the run path ever emits `awaiting_input`: `TaskRegistry` has no
pause state, `SessionQueue` (`src/bridge/SessionQueue.ts:47`) is
run-to-completion, `runSession` (`src/daemon/runTask.ts:19`) has no
suspension/resume. Chat is diagram annotation, not collaboration.

## Proposed Solution
Full-duplex room per session, shipped in stage order (each stage independently
reviewable, stacked branches):

1. **Message log API (truth stays event-sourced).** New `session.message`
   (human↔human, anytime, no status gate) and `session.steer` (interrupt
   intent) events; extend `interaction[]` projection in `rehydrate`
   (`src/session/sessionStore.ts:42`). `POST /tasks/:id/message` appends a
   user turn any time; best-effort SSE fan-out (store is truth, SSE is
   projection — ADR-002). The message log is the persisted chat history
   inside the existing `SessionBackend` — no external service, no extra
   cost. Tenant-scoped via `tenantBackendForRequest`, bearer
   gate + rate limit unchanged.
2. **Agent asks (fx `ask_user_question` mirror).** New `ask_human
   {question, options?}` tool / permission hook in the runner closure
   (`src/server.ts:224`, `src/daemon/runTask.ts`). Emits
   `session.awaiting_input` (store + SSE), parks the worker polling
   `backend.get` with heartbeat, resumes on `POST …/reply` (existing endpoint
   + wake). Question payload mirrors fx shape
   `{questions:[{label,description,options}]}` while keeping plain-string
   `question` backwards compatible. Park policy per decision: **wait forever**;
   parked session stays `awaiting_input` and is always cancellable.
3. **Human steer / interrupt.** `POST …/message?mode=steer`: queued →
   CAS prompt rewrite; running → append `session.user_reply` + interrupt flag
   the runner polls between steps. Harden `cancel` (`src/api/tasks.ts:154`)
   with `AbortSignal` into `runMemberTask`; runner emits terminal status
   (new `run.interrupted` event on the agenthood side). Dashboard gets an
   interrupt button (Esc-equivalent) + inline steer box during `running`.
4. **Room transport.** WS channel `/sessions/:id/room` with presence/typing,
   multi-human fan-out, and approval inbox (fx ctrl+X equivalent). SSE stays
   the read-only projection; all ingress via POST/WS (ADR-002 upheld).
5. **Queue lanes.** Interactive (`awaiting_input`-capable) sessions get a
   priority lane — the serial FIFO pump otherwise blocks HITL behind long
   runs. fx `acp` runner spike proceeds in parallel behind the `createApp` seam,
   not gating this slice.

## Out of Scope
Nothing deferred by request (#76 discussion: keep all in) — but ship order
above is the review order. Recommended follow-up if throughput bites:
presence/typing polish, `auto` reviewer policy (fx-style billed review),
Postgres message-log migration details (lands with backend branch).

## Acceptance Criteria
- [ ] Human posts to a running session via WS/POST; appears in
  `interaction[]` <1s; second human sees it live.
- [ ] Agent `ask_human` parks to `awaiting_input`; diagram shows awaiting
  node; human reply resumes the same worker; diagram grows.
- [ ] Steer on queued rewrites prompt via CAS; steer on running is consumed
  before the next tool step.
- [ ] Interrupt/cancel of a running session aborts `runMemberTask`, emits a
  terminal event, leaves no orphan worker.
- [ ] Tenant A cannot read/write tenant B room (store + WS); unauthenticated
  ingress rejected per bearer gate.
- [ ] Parked-forever session is cancellable and listed as `awaiting_input`
  without starving other interactive sessions (lanes).

## Testing Strategy
Unit: `rehydrate` for `session.message`/`session.steer`, CAS paths on
message/reply/steer, `filterSessions` unchanged. Integration: park→reply→resume
round-trip, steer queued vs running, abort propagation into registry terminal
state. E2E: two dashboard clients + one run proving ask + answer + interrupt.
Hermetic backends only in CI (`pglite`/memory); managed Postgres never in CI.
Coverage: new suites per endpoint/hook; existing suites stay green.

## Open Questions
- WS stack: native `ws` vs Fastify plugin — decided in ADR-007.
- `question` object shape versioning (string vs fx-shaped object) — ADR-007.
- Lane scheduling fairness bounds — deferred to implementation, noted here.

## References
- Issue #76 — M5 HITL collaboration room.
- `src/api/tasks.ts:41` (create/enqueue), `:154` (cancel), `:194` (reply).
- `src/daemon/runTask.ts:19` (park point), `src/server.ts:224` (runner seam).
- `src/session/types.ts:1`, `src/session/sessionStore.ts:42,105`.
- `src/bridge/SessionQueue.ts:47`, `src/bridge/sseEndpoint.ts`.
- ADR-002 (read-only projection), ADR-003 (sky of sessions),
  ADR-004 (event-sourced aggregate), ADR-006 (Fastify + Postgres).
- fx.sh: `https://fx.sh/`, docs `https://fx.sh/llms.txt`,
  repo `https://github.com/vercel-labs/fx`.
