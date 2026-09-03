# Tasks: M5 HITL collaboration room (#76)

Stacked, one-commit-per-task, dependency order. Branch per stage; each targets
its parent. Stages 1–5 merge without closing #76; only the final stage
closes it. (This spec + ADR-007 already landed on `feat/issue-76-hitl-room`
`71fadc1`; code stages stack off that branch.)

## Stage 1 — message log API (off `feat/issue-76-hitl-room`)
- [ ] feat(session): add `session.message` + `session.steer` events and `interaction[]` projection in `rehydrate`
- [ ] feat(api): add `POST /tasks/:id/message` (anytime chat, CAS, SSE fan-out) + tests
- [ ] test(api): unit + integration tests for message ingress, tenant isolation, 409/404 paths

## Stage 2 — queue lanes (`feat/76-hitl-lanes` off stage 1)
- [ ] feat(queue): priority lane for interactive sessions + fairness bound (drain interactive first; 1 standard run per 3 interactive)
- [ ] test(queue): parked/long sessions never starve the other lane; fairness bound asserted

## Stage 3 — agent ask + park (`feat/76-hitl-ask-park` off stage 2)
- [ ] chore(spike): verify agenthood runner API for `ask_human`/permission hook + `run.interrupted`; confirm fallback if absent
- [ ] feat(runner): add `ask_human` tool / permission hook emitting `session.awaiting_input`
- [ ] feat(runner): park releasing the pump slot; `POST …/reply` re-queues to interactive-lane front; resume with history
- [ ] test(runner): park→reply→resume round-trip, parked-forever holds no slot and is cancellable, no orphan worker
- [ ] feat(ui): awaiting node + reply composer states for parked sessions

## Stage 4 — steer / interrupt (`feat/76-hitl-steer` off stage 3)
- [ ] feat(api): `POST /tasks/:id/steer` (queued CAS rewrite; running interrupt flag)
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
