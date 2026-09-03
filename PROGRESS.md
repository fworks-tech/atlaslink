# Atlaslink — Session Progress Checklist

> Status snapshot of the atlaslink project.
> Updated: 2026-08-29

## Legend

- `[x]` complete
- `[ ]` not started
- `[~]` in progress

---

## 1. Agenthood Setup in Atlaslink

- [x] Repo cloned at `C:\github\atlaslink` (branch: `main`, initial commit)
- [x] `package.json` + `package-lock.json` initialized
- [x] `agenthood` installed as local file dependency (`file:../agenthood`)
- [x] `.env` created with `OPENCODE_API_KEY` (gitignored — not committed)
- [x] `AGENTS.md` present
- [x] `.agenthood/config.json` scaffolded
- [x] `.gitignore` present

## 2. Member Activation (20/20)

- [x] All 20 members activated:
      the-scribe, the-architect, the-builder, the-reviewer, the-tester,
      the-debugger, the-auditor, the-herald, the-librarian, the-doorman,
      the-oracle, the-envoy, the-sentinel, the-warden, the-strategist,
      the-steward, the-operator, the-mediator, the-mailman, the-inspector
- [x] `the-mediator` (first-in-line intent router) added via agenthood PR #482
- [x] `npx agenthood check` → 20/20 skills installed, 11 passing · 0 failing

## 3. LLM Provider (Core Fix)

- [x] ~~Primary provider `opencode`~~ → FAILED with `401 Authentication failed`
- [x] Fixed: provider changed to **`opencode-go`** (zen/go tier,
      `https://opencode.ai/zen/go/v1`) in `.agenthood/config.json`
- [x] API key is for the **zen/go tier** (not standard zen)
- [x] `npx agenthood run the-architect "Plan an atlaslink integration"`
      → produced a real plan (provider verified working)

## 4. Phase 1 Event Feed (from agenthood repo)

- [x] Rebuilt agenthood `dist/` (was stale, missing event feed)
- [x] Force-reinstalled into atlaslink (`npm install`)
- [x] `RunEventBus` present in installed package
- [x] Verified in-process event subscription works:
      `Subscribed events: ["run.started","reasoning"]`, listener count 1

### Important Correction
- The event feed is consumed **in-process** via `context.events.subscribe(handler)`
  (an instance of `RunEventBus` on `ApplicationContext`).
- There is **no** `--events` stdout-streaming CLI flag (earlier description was inaccurate).
- 8 event types: `run.started`, `reasoning`, `tool.called`, `tool.result`,
  `decision.recorded`, `provenance.recorded`, `run.finished`, `run.failed`

## 5. Architecture Planning (from the-architect skill)

- [x] ADR-001: persistence layer for events — Accepted, resolves #5
      (NDJSON event log with rotation and cursor restore; no new deps)
- [ ] MCP support (DEFERRED — agenthood already has MCP via Portals)
- [ ] Live web app architecture (SSE/WebSocket bridge from event feed to browser)
      — now governed by ADR-002 (M2/M4)
- [x] Task delegation API (`POST /tasks`) — M3 Task API
- [ ] Agenthood member run live-update dashboard — defined in ADR-002, Atlas as
      root node per ADR-003 (M4)

### Merged documentation (on `main`)
- [x] ADR-002 — `docs/adr/ADR-002-live-diagram-of-society-provenance.md`
      (M4 foundation: live diagram of society provenance)
- [x] ADR-003 — `docs/adr/ADR-003-atlas-holds-the-sky-of-sessions.md`
      (Atlas as the root node of the M4 Live Dashboard)
- [x] ADR-004 — `docs/adr/ADR-004-session-aggregate-durability.md`
      (session as event-sourced aggregate; the NDJSON/DuckDB backend track is
      superseded by ADR-006)
- [x] ADR-005 — `docs/adr/ADR-005-structured-json-logging.md`
      (structured stderr logger with explicit `correlationId` threading,
      explicit swallow boundary)
- [x] ADR-006 — `docs/adr/ADR-006-fastify-http-and-postgres.md`
      (Fastify HTTP layer; PostgreSQL primary store; sessions in Postgres event
      tables behind `SessionBackend`; NDJSON demoted to agent-run provenance;
      accounts + first-class tenancy; streaming/API split; reviewed-dependency
      posture)
- [x] `docs/sequence-diagrams-evidence.md` —
      delegation-chain evidence the M4 dashboard must render from
      `RunEventBus` events and `.agenthood/provenance/*.json`

### Direction on `main` (ADR-006) — build order
- [x] Fastify HTTP layer + Postgres primary store — ADR-006 Accepted; framework
      swap (PR #41), `PostgresBackend` (PR #42), and `pglite`-in-CI are on main
- [ ] Auth ADR — accounts, tenants, credential handling, tenant scoping at the
      data-access boundary (gates account-facing routes; ADR-006 Decision 7)
- [ ] Infra ADR — Docker packaging, Terraform, GitLab CI; stateless API deployable
      serverless while the streaming daemon stays a containerized service
- [ ] Test tooling — Jest (unit), Playwright (M4 E2E), K6 (API load)

## 6. Related Work in Agenthood

- [x] PR #475: `feat/issue-474-run-event-feed` — execution event feed
      (base for the atlaslink event bridge)

---

## Recommended Next Steps (M1–M4 roadmap per ADR-002/ADR-003)

### M1 — Daemon Core
1. [x] TypeScript conversion of daemon core — all source in `src/**/*.ts`,
       zero-build dev via `tsx`, `tsconfig.json` with `noEmit: true`.
       `src/server.ts`, `src/config.ts`, `src/daemon/contextFactory.ts`,
       `src/daemon/runTask.ts`, `src/tasks/taskRegistry.ts`.
       16 hermetic tests on `feat/m1-daemon-core-typescript`;
       the full suite now runs 93 tests across M1–M3.
       E2E verified with the real provider:
       `run.started → reasoning → tool.called/result → decision.recorded →
       provenance.recorded → run.finished`. Fixed a stale-shell-key shadowing
       bug (project `.env` now overrides exported vars via `loadEnvFile`).
       Fixed session lifecycle bug: `createContext` errors now properly fail
       the session instead of leaving it stuck in QUEUED.

### M2 — Event Bridge
2. [x] Bridge events to the browser via SSE/WebSocket (`GET /events`)
3. [x] Resolve ADR-001 persistence decision (governs event replay for M2)

Delivered on stacked branches `feat/4-event-log-store` → `feat/4-event-broadcaster` →
`feat/4-session-queue` → `feat/4-sse-endpoint`: NDJSON event log with rotation and
cursor restore, verbatim fan-out broadcaster, serial FIFO session worker emitting
`session.*` events, and an SSE endpoint honoring `Last-Event-ID`, `bridge.gap`,
`bridge.shutdown`, a 15 s `: ping`, and the read-only projection contract
(ADR-002). `POST /runs` (M3 preview) delegates sessions through the session queue.

### M3 — Task API
4. [x] Task API spec + breakdown shipped — `docs/spec/m3-task-api.md`,
       `docs/tasks/m3-task-api.md`, ADR-004 (session-aggregate durability) amended by
       ADR-006 (Postgres primary store + Fastify). Branch plan:
       docs (shipped) → session-store (shipped) → fastify-rebuild (shipped) →
       postgres-backend (shipped) → task-rest (shipped).
5. [x] Ship the durable, event-sourced `SessionStore` — in-memory store behind a
       `SessionBackend` port, hardened per post-merge review (issues #28–#36), plus the
       `EventLogStore`-backed `EventLogBackend` (ADR-004) with a per-session snapshot
       cache invalidated on append; merged to main (PRs #27, #37, #38). Per-session
       snapshot cache with `deepFreeze` and backend-contract assertion shipped via
       PR #57 (issue #36).
6. [x] Rebuild the HTTP layer on Fastify (ADR-006 Decision 1), preserving the SSE
       reconnection contract — merged via `feat/6-fastify-rebuild` (PR #41); the
       ADR-005 request envelope stays on the `src/log.ts` facade. Suite: 95.
7. [x] Add `PostgresBackend` over `pglite`/`pg` for hermetic CI (ADR-006 Decisions
       4–5, 9) — merged via `feat/6-postgres-backend` (PR #42). Suite: 108.
8. [x] Implement `POST/GET /tasks`, `GET /tasks/{id}`, cancel, per-session SSE —
       merged via `feat/3-task-rest` (PR #44); the OWASP security pass (PR #46)
       gated `/runs` + `/events` behind the bearer token, added rate limiting,
       auth-rejection logging, and the `execRawDdl` seam rename. Suite: 121.

### M4 — Live Dashboard
9. [ ] Add a live dashboard UI rendering society provenance
       (ADR-002) with Atlas as the root node (ADR-003)

### M5 — HITL collaboration room (#76, in flight)
10. [~] Single-question `ask_human` → park → reply → linked resume; WS room
       (`/sessions/:id/room`) + socketless roster read. Spec:
       `docs/spec/m5-hitl-room.md`. Approval round-trip proven through the
       real stubbed runner (`src/daemon/approvalRoundtrip.test.ts`).
