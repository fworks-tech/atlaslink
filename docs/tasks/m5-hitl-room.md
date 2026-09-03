# Tasks: M5 HITL collaboration room (#76)

Stacked, one-commit-per-task, dependency order. Branch per stage; each targets
its parent. Stages 1–5 merge without closing #76; only the final stage
closes it. (This spec + ADR-007 already landed on `feat/issue-76-hitl-room`
`71fadc1`; code stages stack off that branch.)

## PR stack (all `Part of #76`, merge top-down; nothing merged yet)
- #77 `feat/76-hitl-message-log-api` → `main` (CI full green)
- #78 `feat/76-hitl-lanes` → stage-1 branch (Vercel only; repo CI runs on PRs to `main`)
- #79 `feat/76-hitl-ask-park` → stage-2 branch (needs agenthood #496 on `main` before its CI goes green)
- #80 `feat/76-hitl-steer` → stage-3 branch (same agenthood dependency)
- #81 `feat/76-hitl-room-ws` → stage-4 branch (room channel + roster read + dashboard UI)
- agenthood: `feat/issue-496-ask-human-park@099d4b0` (ask_human tool + signal + redacted emit; no PR — merge first)
- caveat: `npm run lint` fails on the stage-2/3 tips (prefer-const fixed only at stack tip `2cddbd9`); self-heals as the stack merges

## Stage 1 — message log API (off `feat/issue-76-hitl-room`) — DONE on `feat/76-hitl-message-log-api`
- [x] feat(session): add `session.message` + `session.steer` events and `interaction[]` projection in `rehydrate` (+ eventLogBackend allowlist, Postgres status-preserving projection + ranked-CTE exclusion)
- [x] feat(api): add `POST /tasks/:sessionId/message` (anytime chat, CAS, SSE fan-out) + tests
- [x] test(api): unit + integration tests for message ingress, tenant isolation, 409/404 paths
- [x] review follow-ups: shared CAS-append helper (reply + message), write-time terminal re-check, blank-content 400, single store/SSE timestamp, Postgres `projectDirectory` helper + single-source CTE exclusion, PGlite listing / 409-variants / nextStep / SSE-emit / CAS-retry / oversize / allowlist / stored-raw tests

## Stage 2 — queue lanes (`feat/76-hitl-lanes` off stage 1) — DONE
- [x] feat(queue): priority lane for interactive sessions + fairness bound (drain interactive first; 1 standard run per 3 interactive; counter resets on idle drain; skips consume nothing)
- [x] test(queue): lane priority, fairness bound + reset, idle/interactive-only drains, re-entrant declare, late arrival, cancelled-standard skip, per-lane pending; `waitFor` drains instead of fixed sleeps
- deferred (pre-existing, all stages): runner-throw strands the queue until next declare — follow-up issue

## Stage 3 — agent ask + park (`feat/76-hitl-ask-park` off stage 2) — DONE (`fad462f`; agenthood side uncommitted)
- [x] agenthood: `ask_human` tool + `AskHumanSignal` (rethrown by `ReActLoop`, translated to `run.awaiting_input` + rethrow by `MemberRunner`) — sibling repo, uncommitted, dist rebuilt
- [x] feat(runner): `registry.park()` (`PARKED`, terminal for original) + `runSession` park catch (slot released, no orphan) + server-seam `awaiting_input` mirror
- [x] feat(api): `POST …/reply` records reply on parked original (stays `awaiting_input`) + spawns linked follow-up (`resumeOf`, Q&A folded into prompt) on the interactive lane; blank-content 400
- [x] test: park→reply→resume round-trip, parked holds no slot + cancellable (registry + API), no-orphan (settled runner), queue-spy lane assertion, fx question projection, dashboard projection + follow-resumed
- [x] feat(ui): reply composer follows the resumed session; awaiting node unchanged (first-label prompt)
- [x] review hardening: single-reply-per-park (409 `session already answered`), delimited+capped fold, tweaks/provider passthrough, post-commit failure compensation, question shape validation + live `awaiting_input` fan-out, tool size caps + park redaction (agenthood), PGlite reply-status / CAS-retry / tenant-passthrough / oversize / queue-parked-continues / seam-validation tests, composer refresh + error state
- [x] society review (reviewer/warden/auditor): fold now neutralizes `</human_reply` in both halves + strips markup/newlines from the attribute; seam caps questions/labels/options; `MAX_SESSION_MESSAGES` (500) bounds the chat log; cancel fans out `session.cancelled` SSE; pump emits `session.parked` to close `started`; reply route extracted to `spawnResumeFollowup`; dismissed after verification — concurrent-reply race (CAS retry re-runs guard), park-mirror race (conflict-drop), cancel-misses-PARKED (flows via `registry.cancel`); deferred as pre-existing/out-of-scope — `x-tenant-id` trust, unfiltered global `/events`, member/team tweaks never consumed by runner, per-route throttle, resume-chain depth
- decisions locked: cooperative agenthood change; fx-style question object (no string back-compat); linked-session resume; reply double-delta fixed in-branch
- accepted residuals: no per-route reply throttle (global rate limit + single-reply bound); no resume-chain depth cap; store keeps raw human text (escape-at-render contract)

## Stage 4 — steer / interrupt (`feat/76-hitl-steer` off stage 3) — DONE- [x] feat(api): `POST /tasks/:sessionId/steer` — queued → registry reprompt + CAS `session.steer` (rehydrate rewrites prompt) with rollback; running → abort-first + CAS `user_reply`, 201 `interrupted: true`; awaiting_input/terminal 409s
- [x] feat(runner): registry `abort`/`attachAbort`/`untrackAbort` + `cancel` from RUNNING; runSession abort race finalizes CANCELLED, suppresses orphan finalize; cancel-running fires abort; seam mirrors + pump emits `session.cancelled`
- [x] test: steer queued rewrite (store+registry+SSE+re-steer), steer running interrupt, all 409s, cancel fires abort, abort-race + late-signal suppression, reprompt/abort registry units, steer rehydrate, queue cancelled close-out
- deviation: no step-polling / agenthood `run.interrupted` — single-shot runner + SDK without signal support; orphaned provider call finishes in background, output discarded; true provider abort is a follow-up
- deferred: interrupt button + inline steer box → Stage 5 UI

## Stage 5 — room transport (`feat/76-hitl-room-ws` off stage 4)
- [x] feat(ws): `/sessions/:id/room` channel (presence, multi-human fan-out, approval inbox; no typing indicators)
- [x] feat(ws): bearer + tenant auth, rate limit, SSE stays read-only projection
- [x] test(ws): two-client live test, tenant isolation, reconnect/resume
- [x] feat(ws): `GET /sessions/:id/room/members` roster read (tenant-scoped, no oracle) for clients that cannot hold a socket
- [x] feat(ui): multi-human thread (SSE-live chat/steer turns), presence headcount (5s roster poll), approval inbox (option buttons + composer), anytime chat composer, steer box + interrupt button
- [x] test(ui): projection + subscription + presence-hook + room wiring suites (dashboard 116/116)

## Stage 6 — spike + close (parallel, merges last)
- [ ] spike(runner): `fx acp` member-runner behind `createApp` seam (approval round-trip evidence)
- [ ] docs: update README/PROGRESS, close #76 via PR
