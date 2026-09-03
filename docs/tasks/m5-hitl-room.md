# Tasks: M5 HITL collaboration room (#76 — shipped/closed)

Stacked, one-commit-per-task, dependency order. The stack below merged
top-down to `main` on 2026-09-03 and the stage branches were deleted; only
`feat/issue-76-hitl-room` remains as history.

## PR stack (all `Part of #76`, merged top-down)
- #77 `feat/76-hitl-message-log-api` → `main` (`06b67c2`)
- #78 `feat/76-hitl-lanes` → `main` (`34d1d4a`)
- #79 `feat/76-hitl-ask-park` (unified-API migration) → `main` (`b51708d`)
- #80 `feat/76-hitl-steer` → `main` (`851a452`)
- #81 `feat/76-hitl-room-ws` (room channel + roster read + dashboard UI) → `main` (`7c41284`)
- agenthood #502 merged to `main` (unified `AskHumanSignal.payload = {question, context?}`, 4000/1000 caps, `run.awaiting_input{question, context?, durationMs}`); dist rebuilt from `main`
- #83 `feat/76-hitl-spike` (spike + closeout, merged LAST) → `main` (`7dbbf32`, closes #76)

## Stage 1 — message log API (off `feat/issue-76-hitl-room`) — DONE on `feat/76-hitl-message-log-api`
- [x] feat(session): add `session.message` + `session.steer` events and `interaction[]` projection in `rehydrate` (+ eventLogBackend allowlist, Postgres status-preserving projection + ranked-CTE exclusion)
- [x] feat(api): add `POST /tasks/:sessionId/message` (anytime chat, CAS, SSE fan-out) + tests
- [x] test(api): unit + integration tests for message ingress, tenant isolation, 409/404 paths
- [x] review follow-ups: shared CAS-append helper (reply + message), write-time terminal re-check, blank-content 400, single store/SSE timestamp, Postgres `projectDirectory` helper + single-source CTE exclusion, PGlite listing / 409-variants / nextStep / SSE-emit / CAS-retry / oversize / allowlist / stored-raw tests

## Stage 2 — queue lanes (`feat/76-hitl-lanes` off stage 1) — DONE
- [x] feat(queue): priority lane for interactive sessions + fairness bound (drain interactive first; 1 standard run per 3 interactive; counter resets on idle drain; skips consume nothing)
- [x] test(queue): lane priority, fairness bound + reset, idle/interactive-only drains, re-entrant declare, late arrival, cancelled-standard skip, per-lane pending; `waitFor` drains instead of fixed sleeps
- deferred (pre-existing, all stages): runner-throw strands the queue until next declare — follow-up issue

## Stage 3 — agent ask + park (`feat/76-hitl-ask-park` off stage 2) — DONE (`fad462f`; agenthood #502 merged, dist rebuilt from `main`)
- [x] agenthood: `ask_human` tool + `AskHumanSignal` (`payload = {question, context?}`, 4000/1000 caps; rethrown by `ReActLoop`, translated to `run.awaiting_input{question, context?, durationMs}` + rethrow by `MemberRunner`) — sibling repo, merged
- [x] feat(runner): `registry.park()` (`PARKED`, terminal for original) + `runSession` park catch (slot released, no orphan) + server-seam `awaiting_input` mirror
- [x] feat(api): `POST …/reply` records reply on parked original (stays `awaiting_input`) + spawns linked follow-up (`resumeOf`, Q&A folded into prompt) on the interactive lane; blank-content 400
- [x] test: park→reply→resume round-trip, parked holds no slot + cancellable (registry + API), no-orphan (settled runner), queue-spy lane assertion, unified question projection, dashboard projection + follow-resumed
- [x] feat(ui): reply composer follows the resumed session; awaiting node unchanged (question-text prompt)
- [x] review hardening: single-reply-per-park (409 `session already answered`), delimited+capped fold, tweaks/provider passthrough, post-commit failure compensation, single-question shape validation + live `awaiting_input` fan-out, tool size caps (4000/1000) + park redaction (agenthood), PGlite reply-status / CAS-retry / tenant-passthrough / oversize / queue-parked-continues / seam-validation tests, composer refresh + error state
- [x] society review (reviewer/warden/auditor): fold now neutralizes `</human_reply` in all three halves + strips markup/newlines from the attributes; seam caps question/context (4000/1000); `MAX_SESSION_MESSAGES` (500) bounds the chat log; cancel fans out `session.cancelled` SSE; pump emits `session.parked` to close `started`; reply route extracted to `spawnResumeFollowup`; dismissed after verification — concurrent-reply race (CAS retry re-runs guard), park-mirror race (conflict-drop), cancel-misses-PARKED (flows via `registry.cancel`); deferred as pre-existing/out-of-scope — `x-tenant-id` trust, unfiltered global `/events`, member/team tweaks never consumed by runner, per-route throttle, resume-chain depth
- decisions locked: cooperative agenthood change; unified single-question payload (no string back-compat); linked-session resume; reply double-delta fixed in-branch
- accepted residuals: no per-route reply throttle (global rate limit + single-reply bound); no resume-chain depth cap; store keeps raw human text (escape-at-render contract)

## Stage 4 — steer / interrupt (`feat/76-hitl-steer` off stage 3) — DONE
- [x] feat(api): `POST /tasks/:sessionId/steer` — queued → registry reprompt + CAS `session.steer` (rehydrate rewrites prompt) with rollback; running → abort-first + CAS `user_reply`, 201 `interrupted: true`; awaiting_input/terminal 409s
- [x] feat(runner): registry `abort`/`attachAbort`/`untrackAbort` + `cancel` from RUNNING; runSession abort race finalizes CANCELLED, suppresses orphan finalize; cancel-running fires abort; seam mirrors + pump emits `session.cancelled`
- [x] test: steer queued rewrite (store+registry+SSE+re-steer), steer running interrupt, all 409s, cancel fires abort, abort-race + late-signal suppression, reprompt/abort registry units, steer rehydrate, queue cancelled close-out
- deviation: no step-polling / agenthood `run.interrupted` — single-shot runner + SDK without signal support; orphaned provider call finishes in background, output discarded; true provider abort is a follow-up
- deferred: interrupt button + inline steer box → Stage 5 UI

## Stage 5 — room transport — DONE
- [x] feat(ws): `/sessions/:id/room` channel (presence, multi-human fan-out, approval inbox; no typing indicators)
- [x] feat(ws): bearer + tenant auth, rate limit, SSE stays read-only projection
- [x] test(ws): two-client live test, tenant isolation, reconnect/resume
- [x] feat(ws): `GET /sessions/:id/room/members` roster read (tenant-scoped, no oracle) for clients that cannot hold a socket
- [x] feat(ui): multi-human thread (SSE-live chat/steer turns), presence headcount (5s roster poll), approval inbox (question + context + reply composer, no option pills), anytime chat composer, steer box + interrupt button
- [x] test(ui): projection + subscription + presence-hook + room wiring suites (dashboard 116/116, incl. post-migration composer rewrite)

## Stage 6 — spike + close (parallel, merged last) — DONE
- [x] spike(runner): approval round-trip evidence — `src/daemon/approvalRoundtrip.test.ts` drives the REAL runner behind the `createApp` seam with the stubbed provider (`the-builder`, hermetic temp project dir, provider keys scrubbed): ask_human parks (`parked`, slot released, `run.awaiting_input{question, context?}` observed, listeners drained), reply spawns the linked follow-up on the interactive lane with the single-question fold, follow-up runs to SUCCEEDED
- [x] docs: README/PROGRESS ship-state updated (#84); #76 closed by #83
