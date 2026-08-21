# Atlaslink — Session Progress Checklist

> Status snapshot of the atlaslink project.
> Updated: 2026-08-21

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

- [ ] ADR-001: persistence layer for events (DEFERRED for later)
      — options under consideration: PostgreSQL+Prisma, LanceDB, JSON+retention
- [ ] MCP support (DEFERRED — agenthood already has MCP via Portals)
- [ ] Live web app architecture (SSE/WebSocket bridge from event feed to browser)
      — now governed by ADR-002 (M2/M4)
- [ ] Task delegation API (`POST /tasks`) — M3 Task API
- [ ] Agenthood member run live-update dashboard — defined in ADR-002, Atlas as
      root node per ADR-003 (M4)

### Merged documentation (on `main`)
- [x] ADR-002 — `docs/adr/ADR-002-live-diagram-of-society-provenance.md`
      (M4 foundation: live diagram of society provenance)
- [x] ADR-003 — `docs/adr/ADR-003-atlas-holds-the-sky-of-sessions.md`
      (Atlas as the root node of the M4 Live Dashboard)
- [x] `docs/sequence-diagrams-evidence.md` —
      delegation-chain evidence the M4 dashboard must render from
      `RunEventBus` events and `.agenthood/provenance/*.json`

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
       16 hermetic tests on `feat/m1-daemon-core-typescript`.
       E2E verified with the real provider:
       `run.started → reasoning → tool.called/result → decision.recorded →
       provenance.recorded → run.finished`. Fixed a stale-shell-key shadowing
       bug (project `.env` now overrides exported vars via `loadEnvFile`).
       Fixed session lifecycle bug: `createContext` errors now properly fail
       the session instead of leaving it stuck in QUEUED.

### M2 — Event Bridge
2. [ ] Bridge events to the browser via SSE/WebSocket (`GET /events`)
3. [ ] Resolve ADR-001 persistence decision (governs event replay for M2)

### M3 — Task API
4. [ ] Add `POST /tasks` endpoint to delegate runs

### M4 — Live Dashboard
5. [ ] Add a live dashboard UI rendering society provenance
       (ADR-002) with Atlas as the root node (ADR-003)
