# Atlaslink — Session Progress Checklist

> Status snapshot of the atlaslink scaffolding session.
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

## 2. Member Activation (19/19)

- [x] All 19 members activated:
      the-scribe, the-architect, the-builder, the-reviewer, the-tester,
      the-debugger, the-auditor, the-herald, the-librarian, the-doorman,
      the-oracle, the-envoy, the-sentinel, the-warden, the-strategist,
      the-steward, the-operator, the-mailman, the-inspector
- [x] `npx agenthood check` → 19/19 skills installed, 11 passing · 0 failing

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
- [ ] Task delegation API (`POST /tasks`)
- [ ] Agenthood member run live-update dashboard

## 6. Related Work in Agenthood

- [x] PR #475: `feat/issue-474-run-event-feed` — execution event feed
      (base for the atlaslink event bridge)

---

## Recommended Next Steps

1. [ ] Scaffold atlaslink daemon that starts an `ApplicationContext` and
       subscribes to `ctx.events`
2. [ ] Bridge events to the browser via SSE/WebSocket (`GET /events`)
3. [ ] Add `POST /tasks` endpoint to delegate runs
4. [ ] Resolve ADR-001 persistence decision
5. [ ] Add a live dashboard UI
