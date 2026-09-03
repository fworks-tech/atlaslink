# Spec: M5 HITL collaboration room for live sessions

**Date:** 2026-09-03
**Status:** Accepted — shipped (#76 closed 2026-09-03 via #77–#81 + #83, tip `7dbbf32`)
**Issue:** #76

Derived from the fx.sh study (single-agent Zig harness; reusable patterns are
`ask_user_question`, permission triage, interrupt/steer — no hosted session bus
to reuse) and the Atlaslink session flow (`POST /tasks` → `SessionQueue`
serial pump → `runSession` → `RunEventBus` → SSE read-only projection).

## Problem
Sessions run to completion with no live human input. The store already has
`queued|running|awaiting_input|succeeded|failed|cancelled`, events
`session.awaiting_input {question}` / `session.user_reply {reply}`,
`interaction[]`, `nextStep`, and `POST /tasks/:sessionId/reply`
(`src/session/types.ts:25-27`, `src/session/sessionStore.ts:105-114`,
`src/api/tasks.ts:254`), plus a `SessionThread` composer in the dashboard —
but nothing in the run path ever emits `awaiting_input`: `TaskRegistry` has no
pause state, `SessionQueue` (`src/bridge/SessionQueue.ts:47`) is
run-to-completion, `runSession` (`src/daemon/runTask.ts:19`) has no
suspension/resume. Chat is diagram annotation, not collaboration.

## Proposed Solution
Full-duplex room per session, shipped in stage order (each stage independently
reviewable, stacked branches):

1. **Message log API (truth stays event-sourced).** New `session.message`
   (human↔human, anytime, no lifecycle gate except terminal → 409) and
   `session.steer` (interrupt intent) events; extend `interaction[]`
   projection in `rehydrate` (`src/session/sessionStore.ts:42`).
   `POST /tasks/:sessionId/message` takes `{content: string(1..10000,
   non-blank)}` and appends one `session.message {message: content}` via a
   shared CAS-append helper (`src/api/tasks.ts:46`, also used by reply)
   with 2-attempt `VersionConflictError` retry, write-time terminal
   re-check (a cancel/finish racing the commit still 409s instead of
   polluting a closed session), and best-effort SSE fan-out (store is
   truth, SSE is projection — ADR-002). Wire: `201` + aggregate;
   `404` unknown session; `409` terminal/changed; single shared `at`
   timestamp for store + SSE. The message log is the persisted chat history
   inside the existing `SessionBackend` — no external service, no extra
   cost. Cross-backend invariant: every new chat/steer event must also join
   the `eventLogBackend` store-allowlist, the Postgres
   `STATUS_PRESERVING_EVENTS` directory projection (status-preserving,
   `updated_at` only, single `projectDirectory` helper), and the ranked-CTE
   exclusion (derived from the same set) — otherwise status-filtered
   listing diverges per backend. Contract: store raw, escape at render —
   the thread path must never use `dangerouslySetInnerHTML`. Tenant-scoped
   via `tenantBackendForRequest`, bearer gate + rate limit unchanged.
   `session.steer` reuses the message text field as a plain user turn in
   Stage 1 — the Stage 4 interrupt flag is additive and must not repurpose
   `message`.
2. **Queue lanes (before park, so wait-forever cannot deadlock the pump).**
   Interactive (`awaiting_input`-capable) sessions get a priority lane — the
   serial FIFO pump would otherwise stall behind one parked session or long
   runs. Fairness bound: the pump drains the interactive lane first; after 3
   consecutive interactive runs it takes one standard run if any (Architect
   to finalize the exact bound).
3. **Agent asks (fx `ask_user_question` mirror) — DONE.** `ask_human
   {question: string, context?: string}` tool auto-registered by
   `MemberRunner` for every member run (agenthood; bypasses the
   permission-profile gate by design — it asks, never touches state).
   `execute` throws `AskHumanSignal` (`payload = {question, context?}`),
   which `ReActLoop` rethrows instead of stringifying; `MemberRunner`
   translates it to a `run.awaiting_input {question, context?, durationMs}`
   bus event and rethrows. `runSession` catches the signal, records
   `registry.park()` (new `PARKED` registry state, terminal for the original),
   and returns — the pump slot is free, no orphan. The server seam mirrors
   `session.awaiting_input` (store + SSE) with the single-question payload;
   `nextStep.prompt` keeps the question string so the thread path is
   unchanged. `POST …/reply` appends `session.user_reply` to the parked
   original (which stays `awaiting_input`, still cancellable) and spawns a
   **linked follow-up session** (`resumeOf`, original prompt + Q&A folded in),
   created + enqueued to the interactive lane. Reply rules: **single reply per
   park** (second reply 409s — multi-turn works via the follow-up parking and
   asking again); the fold is `<human_reply question="…" context="…">…</human_reply>`
   with length caps (4000 question / 1000 context / 4000 reply); the provider
   override rides into the resumed run while the full
   `tweaks` object persists on the follow-up store entry (member/team tweaks
   are stored but not consumed by the runner — pre-existing gap shared with
   the create route, out of scope); a declare failure after the
   follow-up commit cancels the follow-up instead of orphaning it. The seam
   validates the single-question shape before mirroring and fans `session.awaiting_input`
   out live on SSE (store stays truth). Question size caps live in the tool
   schema + `execute` (`ASK_HUMAN_MAX_QUESTION_LENGTH=4000` /
   `ASK_HUMAN_MAX_CONTEXT_LENGTH=1000`); park emits are redacted
   like any model text. Society-review hardening: the fold neutralizes
   `</human_reply` in reply, question, and context and strips markup/newlines
   from the attribute halves; the seam enforces the same caps (4000/1000) so a
   compromised runner cannot park unbounded input; the chat log is bounded at
   500 messages; cancel fans out `session.cancelled` SSE; the pump emits
   `session.parked` so queue watchers see the slot release. Park policy per
   decision:
   **wait forever**; a parked session holds no pump slot and is always
   cancellable (registry `cancel` accepts `PARKED`).
4. **Human steer / interrupt — DONE.** `POST /tasks/:sessionId/steer`:
   queued → registry reprompt + CAS `session.steer` (which rewrites
   `task.prompt` in rehydrate), registry rollback on CAS failure; running →
   abort-first then CAS `session.user_reply`, 201 with `interrupted: true`;
   awaiting_input 409s toward reply; terminal 409s. `cancel` on a running
   session now fires the same abort (202 stays async-ack). Deviation from the
   draft: no step-polling and no `run.interrupted` agenthood event — the
   runner is single-shot and the SDK provider path takes no signal, so
   `runSession` races the in-flight call against a per-run AbortController
   owned by the registry (`attachAbort`/`abort`/`untrackAbort`, abort only
   fires on a tracked RUNNING run). The abort win finalizes CANCELLED and
   frees the slot at once; the orphaned provider call completes in the
   background with its output discarded and late park/succeed/fail
   suppressed. Seam mirrors `session.cancelled`; pump emits it to close
   `started`. Follow-up (not this stage): true provider-side abort.
   Dashboard interrupt button + inline steer box deferred to Stage 5 UI.
5. **Room transport — DONE.** WS channel `/sessions/:id/room` with presence,
   multi-human fan-out, and approval inbox (fx ctrl+X equivalent). Typing
   indicators are deferred polish (see Out of Scope). SSE stays
   the read-only projection; all ingress via POST/WS (ADR-002 upheld).
   Dashboard note: the browser holds no socket — the gate token stays
   server-side in the BFF and route handlers cannot proxy WS upgrades — so
   the dashboard joins the room over POST ingress + SSE projection
   (chat/steer/reply/steer-callbacks through the BFF, live thread turns via
   `session.message`/`session.steer` events) with presence as a 5s poll of
   `GET /sessions/:id/room/members`. Stage 4's deferred interrupt button +
   inline steer box shipped here too.
   In parallel, non-gating: fx `acp` runner spike behind the `createApp` seam.

## Out of Scope
Nothing deferred by request (#76 discussion: keep all in) — but ship order
above is the review order. Stages 1–5 merge without closing #76; only the
final stage closes it. Deferred polish after #76 closes: typing indicators,
`auto` reviewer policy (fx-style billed review), Postgres message-log
migration details (lands with backend branch).

## Acceptance Criteria
- [x] Human posts to a running session via WS/POST; appears in
  `interaction[]` (asserted in-process on a hermetic backend, <1s bound);
  second human sees it live.
- [x] Agent `ask_human {question, context?}` parks to `awaiting_input`
  (4000/1000 caps, single-question fold) holding no pump slot;
  diagram shows awaiting node; human reply re-queues and resumes the run
  and a new exchange card is appended to the DAG.
- [x] Steer on queued rewrites prompt via CAS; steer on running is consumed
  before the next tool step.
- [x] Interrupt/cancel of a running session aborts `runMemberTask`, emits a
  terminal event, leaves no orphan worker.
- [x] Tenant A cannot read/write tenant B room (store + WS); unauthenticated
  ingress rejected per bearer gate.
- [x] A parked-forever session holds no pump slot and is cancellable; with
  the fairness bound, interactive sessions drain first and standard sessions
  still progress.

## Testing Strategy
Unit: `rehydrate` for `session.message`/`session.steer`, CAS paths on
message/reply/steer, `filterSessions` unchanged. Postgres: directory
projection preserves status on message/steer (`updated_at` only); ranked CTE
excludes message/steer so trailing chat never hides a session from `?status=`
filters; tenant-isolation + 404/409 paths per endpoint. Integration: park→reply→resume
round-trip, steer queued vs running, abort propagation into registry terminal
state. E2E: two dashboard clients + one run proving ask + answer + interrupt.
Hermetic backends only in CI (`pglite`/memory); managed Postgres never in CI.
Coverage: new suites per endpoint/hook; existing suites stay green.

## Open Questions
- WS stack: native `ws` vs Fastify plugin — decided in ADR-007.
- `question` payload: unified `{question, context?}` — decided in Stage 3 (no string back-compat).
- Lane fairness bound constant — finalized at 3 (`MAX_CONSECUTIVE_INTERACTIVE`).
- agenthood runner API: `ask_human`/permission-hook support and
  `run.interrupted` emission — verify before Stage 3; fallback is
  poll-based park with zero runner cooperation.
- steer payload forward-compat: Stage 1 `session.steer` carries `{message}`
  with no interrupt semantics; Stage 4 must add the running-interrupt flag
  without breaking Stage 1 history — decide field name before Stage 4.
- Deferred security hardening (Stage 1 audit): bearer tokens are not bound
  to tenants (`src/session/tenant.ts` TODO — any bearer can claim any
  `x-tenant-id`; do not widen tenant-scoped writes until fixed); global
  `GET /events` fans out all tenants' chat — needs tenant filtering by
  Stage 5; per-session message caps / pagination (unbounded `interaction[]`
  growth) — Stage 4+.

## References
- Issue #76 — M5 HITL collaboration room.
- `src/api/tasks.ts:99` (create/enqueue), `:212` (cancel), `:254` (reply),
  `:46` (CAS-append helper), `:334` (message).
- `src/daemon/runTask.ts:19` (park point), `src/server.ts:224` (runner seam, `:262` park mirror).
- `src/session/types.ts:1-40`, `src/session/sessionStore.ts:42,105-120`.
- `src/tasks/taskRegistry.ts:4-10,96-135` (PARKED, park/cancel).
- `src/bridge/SessionQueue.ts:47`, `src/bridge/sseEndpoint.ts`.
- ADR-002 (read-only projection), ADR-003 (sky of sessions),
  ADR-004 (event-sourced aggregate), ADR-006 (Fastify + Postgres).
- fx.sh: `https://fx.sh/`, docs `https://fx.sh/llms.txt`,
  repo `https://github.com/vercel-labs/fx`.
