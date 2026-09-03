# Tasks: M5 HITL collaboration room (#76)

Stacked, one-commit-per-task, dependency order. Branch per stage; each targets
its parent. Stages 1–5 merge without closing #76; only the final stage
closes it. (This spec + ADR-007 already landed on `feat/issue-76-hitl-room`
`71fadc1`; code stages stack off that branch.)

## Stage 1 — message log API (off `feat/issue-76-hitl-room`) — DONE on `feat/76-hitl-message-log-api`
- [x] feat(session): add `session.message` + `session.steer` events and `interaction[]` projection in `rehydrate` (+ eventLogBackend allowlist, Postgres status-preserving projection + ranked-CTE exclusion)
- [x] feat(api): add `POST /tasks/:sessionId/message` (anytime chat, CAS, SSE fan-out) + tests
- [x] test(api): unit + integration tests for message ingress, tenant isolation, 409/404 paths
- [x] review follow-ups: shared CAS-append helper (reply + message), write-time terminal re-check, blank-content 400, single store/SSE timestamp, Postgres `projectDirectory` helper + single-source CTE exclusion, PGlite listing / 409-variants / nextStep / SSE-emit / CAS-retry / oversize / allowlist / stored-raw tests

## Stage 2 — queue lanes (`feat/76-hitl-lanes` off stage 1) — DONE
- [x] feat(queue): priority lane for interactive sessions + fairness bound (drain interactive first; 1 standard run per 3 interactive; counter resets on idle drain; skips consume nothing)
- [x] test(queue): lane priority, fairness bound + reset, idle/interactive-only drains, re-entrant declare, late arrival, cancelled-standard skip, per-lane pending; `waitFor` drains instead of fixed sleeps
- deferred (pre-existing, all stages): runner-throw strands the queue until next declare — follow-up issue

## Stage 3 — agent ask + park (`feat/76-hitl-ask-park` off stage 2)
- [ ] chore(spike): verify agenthood runner API for `ask_human`/permission hook + `run.interrupted`; confirm fallback if absent
- [ ] feat(runner): add `ask_human` tool / permission hook emitting `session.awaiting_input`
- [ ] feat(runner): park releasing the pump slot; `POST …/reply` re-queues to interactive-lane front; resume with history
- [ ] test(runner): park→reply→resume round-trip, parked-forever holds no slot and is cancellable, no orphan worker
- [ ] feat(ui): awaiting node + reply composer states for parked sessions

## Stage 4 — steer / interrupt (`feat/76-hitl-steer` off stage 3)
- [ ] feat(api): `POST /tasks/:sessionId/steer` (queued CAS rewrite; running interrupt flag)
- [ ] feat(runner): honor interrupt flag between steps; `AbortSignal` into `runMemberTask`; emit terminal
- [ ] test(e2e): steer queued vs running, interrupt running to terminal
- [ ] feat(ui): interrupt button + inline steer box during `running`

## Stage 5 — room transport (`feat/76-hitl-room-ws` off stage 4)
- [ ] feat(ws): `/sessions/:id/room` channel (presence, multi-human fan-out, approval inbox; no typing indicators)
- [ ] feat(ws): bearer + tenant auth, rate limit, SSE stays read-only projection
- [ ] test(ws): two-client live test, tenant isolation, reconnect/resume
- [ ] feat(ui): multi-human thread, presence, approval inbox

## Stage 6 — spike + close (parallel, merges last)
- [ ] spike(runner): `fx acp` member-runner behind `createApp` seam (approval round-trip evidence)
- [ ] docs: update README/PROGRESS, close #76 via PR
