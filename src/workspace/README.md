# src/workspace — layering

Dependency direction: transport → application → domain ← infrastructure.
Every layer imports inward only; nothing here imports from `src/api`,
`src/session`, or the future GraphQL layer.

```
domain/           pure rules, no I/O
  path.ts           workspacePathFor — derived binding (ADR-012), tenant-isolated
infrastructure/   storage side effects
  git.ts            system git adapter: ensure / commitAll / readAt / diff
  lock.ts           per-workspace write mutex (reentrant, process-local)
index.ts          pinned public surface — consumers import ONLY from here
```

## Seams reserved (created when they gain content, not before)

- **Stage 3 — files subgraph (#296):** GraphQL schema + resolvers live in the
  subgraph package and call `index.ts`. Request-derived repo paths MUST come
  from `workspacePathFor`, never from raw input (rule recorded on #296).
- **Use cases:** orchestration helpers (e.g. `applySessionWrite` = write
  files + `commitAll`) appear when the executor (#301) needs them.
- **In-memory adapter:** only if resolver tests ever need to avoid real git —
  today tests run hermetically against temp repos, so no port/interface yet
  (ADR-010's lesson: ports earn their keep with a second implementation).

## Invariants

- `index.test.ts` pins the exported surface — adding an export is a
  deliberate act, not an accident.
- No destructive git operations are exposed; history is append + revert only.
- Writes serialize per workspace; nested calls reenter instead of deadlocking.
