# Tasks: M5 Federation & Workspace (#290–#298)

One branch per concern, one commit per task, dependency order. Stacked
branches target their parent; each PR links its issue. Stage order mirrors
`docs/spec/m5-federation-workspace.md`.

## Stage 1 — Foundations (decisions before code)
- [ ] docs(adr): ADR-011 federation decomposition + REST compat window (#290)
- [ ] docs(adr): ADR-012 git-backed workspace (#291)
- [ ] spike(composition): time-boxed router vendor spike (Apollo Router vs
  Cosmo vs Yoga), record selection under #290 — must run offline-composed
  schemas in CI without a live network

## Stage 2 — Workspace model (issues #292)
- [ ] feat(projects): bind a git workspace to a project row (path reference,
  metadata columns/migration)
- [ ] feat(files): git helper — commit with `session:` trailer, pinned read,
  diff, per-workspace write lock (private to the future files subgraph)
- [ ] test(files): temp-dir unit tests — attribution, lock serialization,
  pinned reads, revert-only policy

## Stage 3 — Subgraph extraction (issues #293–#296, one stacked branch each)
- [ ] feat(graph): scaffold — shared schema/registry conventions + CI
  composition check (parent branch for the four below)
- [ ] feat(session): session subgraph — lifecycle/events/actions/room over
  existing handlers + composition check (#293)
- [ ] feat(task): task subgraph — CRUD, validation, diagram projection (#294)
- [ ] feat(insights): insights subgraph — read-only over events/traces (#295);
  merge back into `session` instead if it never deploys alone
- [ ] feat(files): files subgraph — list/read/diff/commit over the git
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

## Rules
- No stage starts before its dependency stage merges to `main`.
- `npm test`, `npm run lint`, `npm run typecheck` green on every branch.
- Physical data separation, shim removal, and M6/M7 work are never smuggled
  into a M5 branch — they have their own issues.
