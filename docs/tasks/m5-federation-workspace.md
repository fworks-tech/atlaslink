# Tasks: M5 Federation & Workspace (#290–#298)

One branch per concern, one commit per task, dependency order. Stacked
branches target their parent; each PR links its issue. Stage order mirrors
`docs/spec/m5-federation-workspace.md`.

## Stage 1 — Foundations (decisions before code)
- [ ] docs(adr): ADR-011 federation decomposition + REST compat window (#290)
- [ ] docs(adr): ADR-012 git-backed workspace (#291)
- [x] spike(composition): router vendor spike (Apollo vs Cosmo vs Hive)
  → **Cosmo Router** selected, results recorded on #290 (2026-10-02)

## Stage 2 — Workspace model (issues #292) — DONE
- [x] feat(workspace): resolve workspace path from tenant and project id —
  derived binding, tenant-isolated, traversal-safe (no migration; per-row
  path deferred per ADR-012 amend)
- [x] feat(workspace): git helper — lazy `ensureWorkspace`, `commitAll` with
  `session:` trailer, pinned `readAt`, `diff`, reentrant per-workspace lock
  (module is private to the future files subgraph)
- [x] test(workspace): temp-dir tests — attribution, pinned reads, lock
  serialization + reentrancy (deadlock guard), unsafe ref/path rejection,
  exported-surface contract (revert-only policy)

## Stage 3 — Subgraph extraction (issues #293–#296, one stacked branch each)
- [x] feat(graph): scaffold — shared schema/registry conventions + CI
  composition check (parent branch for the four below; folded into #293)
- [x] feat(session): session subgraph — lifecycle/events/actions/room over
  existing handlers + composition check (#293)
- [x] feat(task): task subgraph — CRUD, validation, diagram projection (#294)
- [x] feat(insights): insights subgraph — read-only over events/traces (#295);
  merge back into `session` instead if it never deploys alone
- [x] feat(files): files subgraph — list/read/diff/commit over the git
  workspace, session-attributed (#296)

## Stage 4 — REST compat window (issue #297)
- [ ] feat(bff): route-by-route shim — legacy REST routes translate to graph
  operations; existing `src/api/*.test.ts` pass unmodified
- [ ] docs(bff): deprecation checklist — every shimmed route listed with its
  removal criterion

## Stage 5 — Dashboard migration (issue #298, last)
- [ ] feat(dashboard): move data layer from REST to the graph
- [ ] test(dashboard): E2E smoke against the router; assert zero legacy REST
  calls
- [ ] chore(bff): mark shim deprecated with removal issue linked

## Documentation
- [ ] docs(federation): explore and document the benefits (and counterpoints)
  of GraphQL Federation for this codebase — ADR/spec section, linked from
  ADR-011 (#317)

## Rules
- No stage starts before its dependency stage merges to `main`.
- `npm test`, `npm run lint`, `npm run typecheck` green on every branch.
- Physical data separation, shim removal, and M6/M7 work are never smuggled
  into a M5 branch — they have their own issues.
