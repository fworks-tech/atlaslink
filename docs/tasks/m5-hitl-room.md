# Tasks: M5 HITL collaboration room (#76)

Stacked, one-commit-per-task, dependency order. Branch per stage; each targets
its parent.

## Stage 1 — message log API (`feat/76-hitl-message-log-api` off main)
- [ ] feat(session): add `session.message` + `session.steer` events and `interaction[]` projection in `rehydrate`
- [ ] feat(api): add `POST /tasks/:id/message` (anytime chat, CAS, SSE fan-out) + tests
- [ ] test(api): unit + integration tests for message ingress, tenant isolation, 409/404 paths
- [ ] docs(spec): land `docs/spec/m5-hitl-room.md` (this spec) + ADR-007 stub

## Stage 2 — agent ask + park (`feat/76-hitl-ask-park` off stage 1)
- [ ] feat(runner): add `ask_human` tool / permission hook emitting `session.awaiting_input`
- [ ] feat(runner): park worker on `backend.get` poll with heartbeat; wake on `POST …/reply`
- [ ] test(runner): park→reply→resume round-trip, parked-forever cancellable, no orphan worker
- [ ] feat(ui): awaiting node + reply composer states for parked sessions

## Stage 3 — steer / interrupt (`feat/76-hitl-steer` off stage 2)
- [ ] feat(api): `POST …/message?mode=steer` (queued CAS rewrite; running interrupt flag)
- [ ] feat(runner): honor interrupt flag between steps; `AbortSignal` into `runMemberTask`; emit terminal
- [ ] test(e2e): steer queued vs running, interrupt running to terminal
- [ ] feat(ui): interrupt button + inline steer box during `running`

## Stage 4 — room transport (`feat/76-hitl-room-ws` off stage 3)
- [ ] feat(ws): `/sessions/:id/room` channel (presence/typing, multi-human fan-out, approval inbox)
- [ ] feat(ws): bearer + tenant auth, rate limit, SSE stays read-only projection
- [ ] test(ws): two-client live test, tenant isolation, reconnect/resume
- [ ] feat(ui): multi-human thread, presence, approval inbox

## Stage 5 — lanes + spike (parallel, merges last)
- [ ] feat(queue): priority lane for interactive sessions + fairness bound
- [ ] spike(runner): `fx acp` member-runner behind `createApp` seam (approval round-trip evidence)
- [ ] docs: update README/PROGRESS, close #76 via PR
