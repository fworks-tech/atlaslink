# Agenthood integration audit — Atlaslink

Date: 2026-11-20
Scope: `.agenthood/`, `agenthood` npm dependency, `AGENTS.md`, CI, and runtime integration in `src/`.

## Current state

- **Dependency:** `agenthood@^4.4.0` (PR #412 open, CI green). Previously `^4.0.0`.
- **Config:** `.agenthood/config.json` — `version: 1`, `runtime: other`, 20 members (canonical bare names), 1 provider (`opencode-go` / `deepseek-v4.1-flash`), hooks + conventions wired.
- **Skills:** 44 files under `.agenthood/skills/`, synced to the installed package (CI gate `sync-skills --check`).
- **Lockfile:** `agenthood.lock` committed (20 members hashed).
- **Hooks:** `.githooks/pre-commit` runs `sync-skills --check`; `commit-msg` runs commitlint. Wired by `postinstall`.
- **CI:** `sync-skills --check` in the `check` job. No `doctor`/`verify --strict` in CI.
- **Runtime usage in code:** `getMemberNames()` (agents API), `MemberRegistry`, `ApplicationContext`, `AskHumanSignal`, `RunEventBus`, `LLMConfig`, checkpoint store, config loader, provider validation. Insights reads `TraceEnvelope` (now includes `provider` in 4.4.0).
- **Extra dependency added manually:** `@opencode/plugin@2.3.2` (agenthood 4.4.0's `dist/opencode-plugin.js` imports it without declaring it — upstream bug).

## Findings

### F1 — AGENTS.md stale version reference (should fix)
`AGENTS.md` says `agenthood npm package (^4.0.0)` in the Autonomous Runtime section. Should read `^4.4.0`. Cosmetic but misleading for contributors.

### F2 — No Groq fallback provider configured (nice to have)
`.env.example` documents `GROQ_API_KEY` and the README mentions adding a provider entry, but `.agenthood/config.json` declares only `opencode-go`. A single provider means no failover when the primary is down or rate-limited. Adding a second entry (Groq, priority lower) would exercise the chain-winner logic that 4.4.0 records as `provider` in traces.

### F3 — `provider` field in traces is unused (should fix / opportunity)
Agenthood 4.4.0 records which provider answered a run (`TraceEnvelope.provider`). Atlaslink's insights fold by member and model only; the dashboard cost page ranks agents, not providers. Surfacing provider in insights (a `byProvider` group) and the cost page would make multi-provider setups observable — directly enables F2's value.

### F4 — `@opencode/plugin` missing upstream declaration (upstream bug, tracked)
Agenthood 4.4.0 changed its main entry to `dist/opencode-plugin.js`, which imports `@opencode/plugin` without listing it in `dependencies`/`peerDependencies`. We patched locally by adding it. Should be reported to fworks-tech/agenthood.

### F5 — CI does not run `doctor` or `verify --strict` (should fix)
CI runs `sync-skills --check` but not `npx agenthood doctor` or `npx agenthood verify --strict`. These catch lockfile drift, hook misconfiguration, and lane-overlap/injection issues. Adding them as steps (after install) would harden the gate. Note: `doctor` may emit "no-lockfile" noise for global skills when run outside a clean project context — verify in CI before enabling.

### F6 — New 4.4.0 exports unused (opportunity)
`memberSkills`, `memberTimeoutMs`, `nodeRuntime`, `runMemberTool` are new. Atlaslink hand-rolls member-name handling and timeout defaults. `memberTimeoutMs()` (env `AGENTHOOD_MEMBER_TIMEOUT_MS`) could centralize the run timeout instead of a hardcoded value — check `src/daemon/runTask.ts` and task registry for hardcoded timeouts.

### F7 — `.agenthood/skill-cache/metadata.json` stale cache (cleanup)
A leftover skill cache from a previous discovery run lives under `.agenthood/skill-cache/` (gitignored). It references legacy `the-*` skill paths. Harmless but confusing; can be deleted. Not blocking.

### F8 — AGENTS.md skills table lists 20 bare names; package ships 44 (info)
The skills table in AGENTS.md enumerates the 20 canonical members, but the synced catalog has 44 (AWS, docker, kubernetes, etc.). Those extra skills are discoverable via `agenthood skills` / `search`. Consider documenting that the project syncs the full catalog, or filter to relevant ones — but filtering breaks `sync-skills --check` parity. Keep as-is.

### F9 — Custom skill `.agents/skills/workspace-write` (info)
A project-local skill not part of agenthood, used by the Atlaslink executor (ADR-012). It is not covered by `sync-skills --check` (different dir) and not in the agenthood catalog. That's correct and intentional; just be aware it won't be validated by the integrity gate.

### F10 — Legacy `the-*` aliases (info)
`src/members.ts` uses `MemberRegistry.has()` which resolves both bare and `the-*` names. API gates accept both for backward compat. No change needed; keep until legacy sessions are gone.

## Recommended next steps (ordered)

1. **Merge PR #412** (CI green) and delete the branch. *(blocks nothing)*
2. **Fix F1** — update `^4.0.0` → `^4.4.0` in AGENTS.md. One-line chore commit.
3. **Report F4 upstream** — open an issue on fworks-tech/agenthood about the missing `@opencode/plugin` declaration; keep the local dep until fixed.
4. **Add Groq fallback (F2)** — add a second provider entry to `.agenthood/config.json` (requires `GROQ_API_KEY` in `.env`), then run `doctor` + a smoke run to confirm chain-winner recording.
5. **Surface provider in insights (F3)** — add `byProvider` to `InsightsReport` + schema + resolver; mirror `byModel`. Add a dashboard cost-by-provider view. Includes tests.
6. **Harden CI (F5)** — add `npx agenthood doctor` and `npx agenthood verify --strict` steps to the `check` job; run once in a draft PR to confirm no noise.
7. **Centralize timeout (F6)** — replace hardcoded run timeouts with `memberTimeoutMs()` (env-overridable), document `AGENTHOOD_MEMBER_TIMEOUT_MS` in `.env.example`.
8. **Cleanup (F7)** — delete `.agenthood/skill-cache/` locally; ensure gitignored (already is).

## Not in scope / not recommended

- Filtering the synced skill catalog to "relevant" skills: breaks CI parity with the package.
- Migrating `runtime` away from `other`: OpenCode is not a first-class runtime in agenthood's enum; `other` is correct.
- Removing legacy `the-*` aliases: still needed for stored sessions/agents.
- Running `agenthood upgrade` instead of `sync-skills`: `sync-skills` is the CI-gated path; keep it.

## Verification checklist for any follow-up

- `npm ci` green
- `npm run typecheck`, `npm run lint`, `npm test` green
- `node scripts/sync-skills.mjs --check` green
- `npx agenthood doctor` — 0 warnings (after F5 lands)
- `npx agenthood verify --strict` green
