# Spec: M5 Federation & Workspace

**Date:** 2026-10-02
**Status:** Proposed
**Milestone:** M5 — Federation & Workspace (#290–#298)
*Not to be confused with the shipped HITL-room spec (`m5-hitl-room.md`), from
the older milestone numbering.*

## Problem

Atlaslink is one Fastify deployable: session execution, task CRUD, insights,
room/auth/project routes ship together (`src/api/*`, `src/server.ts`).
Module boundaries exist but no contract or deployment enforces them, and the
dashboard consumes REST directly. Meanwhile projects (`src/api/projects.ts`)
are empty containers — there are no workspace files, so the M6 agentic
roadmap (spec `.md` generation, coding tasks, session file edits) and the
M7 AutoHarness fixture strategy (repo state at commit X + session events)
have nowhere to land. Flow work and fine-tuning are blocked behind both.

## Proposed Solution

Decompose into four Federation v2 subgraphs — `session`, `task`, `insights`,
`files` — behind an edge router, with REST preserved as a BFF shim until the
dashboard migrates last (ADR-011). Add a git-backed workspace per project —
git owns content on a volume, the DB owns metadata and session attribution
(ADR-012). Shipped in stacked, independently mergeable stages:

1. **Foundations** — ADR-011 + ADR-012 accepted (#290, #291).
2. **Workspace model** — extend projects with workspace binding and file
   metadata; projects themselves already exist from M4 (#292).
3. **Subgraph extraction**, one branch per subgraph, each landing with its
   composition check in CI: `session` (#293) → `task` (#294) → `insights`
   (#295) → `files` (#296, needs the git store from stage 2).
4. **REST BFF shim** — every legacy route translates to graph operations,
   existing API tests pass unmodified (#297).
5. **Dashboard migration** — last; removes the dashboard from the shim's
   consumer list and triggers deprecation tracking (#298).

Each subgraph must earn its independence: it owns its schema, has one
deployment unit, and fails alone. A subgraph that never deploys separately
is a folder, not a boundary — if `insights` never justifies its own release
train, it merges back into `session` before extraction rather than after.

## Out of Scope

- M6 agentic capabilities (planning HITL, file writes, spec generation,
  coding execution) — they *consume* this milestone's seams (#299–#303).
- M7 fine-tuning and AutoHarness (#304–#310) — they consume ADR-012
  fixtures and traces.
- Physical data separation per subgraph — all subgraphs share the
  `SessionBackend` port (ADR-009/ADR-010) until a scaling need forces it.
- Removal of the REST shim — only its deprecation criteria are set here.
- Router vendor final selection — time-boxed spike, recorded in #290.

## Acceptance Criteria

- [ ] CI composes all four subgraph schemas; a breaking change fails the
  build before it reaches the dashboard.
- [ ] Each subgraph runs as its own deployable with its own health gate;
  killing one does not take the others down.
- [ ] Every existing REST response shape is served identically by the shim
  (`src/api/*.test.ts` green without modification).
- [ ] A project workspace can store files; each agent/session write is a
  git commit attributable to a session id; reads can pin a commit.
- [ ] Concurrent writes to one workspace serialize; no lost updates.
- [ ] `npm test` remains offline and hermetic — composition check is the
  only network-touching job, and it runs against local schema files.
- [ ] Dashboard runs entirely on the graph with no legacy REST calls (#298).

## Testing Strategy

- **Composition:** schema files checked into each subgraph; CI runs the
  federation composition check (hermetic, no router process needed).
- **Contract:** per-subgraph suites adapted from the existing API tests;
  the shim stage proves legacy suites pass unmodified.
- **Workspace:** git helper unit tests in temp directories (commit
  attribution, lock serialization, pinned reads); integration test writing
  through the files subgraph and diffing the resulting commit.
- **Regression:** existing `npm test` (node --test, hermetic backends) and
  `npm run lint` / `npm run typecheck` green at every stage.
- E2E: dashboard smoke against the router once stage 5 lands.

## Open Questions

- Router vendor: **decided — Cosmo Router** (spike 2026-10-02, results on
  #290; recorded in ADR-011). Gotcha: `dev_mode: false` for JSON logs.
- Production volume for git workspaces on Render: size, snapshot/backup
  story — decided with the operator runbook before #296 merges.
- Whether `task` and `insights` compose into fewer subgraphs if extraction
  shows no independent scaling need — re-evaluate at #295, cheap to merge
  now, expensive to split later.
- Namespace/prefix strategy for subgraph schemas — **decided at the #293
  scaffold**: no type prefixing; `Session`/`Task` are federation entities
  with `@key(fields: "id")` and exactly one owning subgraph (`session`,
  `task`); cross-subgraph references go through the entity, never through
  duplicated fields. Root fields are owned by one subgraph — `Query` fields
  never collide because each subgraph names its own namespace in
  composition (verified by the CI compose check).

## Subgraph Conventions (scaffold, #293)

- Layout: `src/subgraphs/<name>/schema.graphql` + `resolvers.ts`; exactly
  the directories that `compose.yaml` lists (enforced by
  `src/subgraphs/subgraphs.test.ts`).
- Schemas are Federation v2.3 (`@link` …/federation/v2.3, import `@key`,
  `@shareable`); entities have a single owner; the compose check in CI is
  the contract gate.
- `src/subgraphs/compose.yaml` lists subgraphs as a **YAML list** — wgc
  0.132.x crashes on map-style entries (`config.subgraphs.entries`).
- `npm run compose` pins `wgc@0.132.2` via npx (no CLI dependency in the
  lockfile) and writes the router execution config to `router-config.json`
  (gitignored; mounted by the router runtime stage).
- Files subgraph (#296): request-derived repo paths MUST come from
  `workspacePathFor` (tenant + project resolved server-side, never from raw
  input); `commitFiles` requires a `sessionId` that exists in the calling
  tenant's session store — every commit stays attributable.
- Routing: all subgraphs are served from the gated monolith Fastify scope at
  `POST /v1/graphql/<name>` (ADR-011: handlers move, business logic does not
  get rewritten); `routing_url` entries assume the default dev port 3000.
- `insights` folds the process-global trace store (`.agenthood/traces`) —
  aggregates only (member/model/cost/tokens), never session content. It is
  not tenant-partitioned because trace envelopes carry no tenant id; tenancy
  arrives if traces gain one.

## References

- Issues #290–#298; milestone "M5 — Federation & Workspace"
- ADR-011 (decomposition + REST window), ADR-012 (git-backed workspace)
- ADR-002/003/004 (event-sourced sessions, projections), ADR-006 (Fastify +
  Postgres), ADR-008 (auth/tenancy), ADR-009/010 (SessionBackend port)
- `src/api/*` (routes to redistribute), `src/api/projects.ts` (M4 projects),
  `src/server.ts` (composition root), `docs/spec/session-backend-evolution.md`
