# ADR-012: Git-Backed Workspace for Project Files

**Date:** 2026-10-02
**Status:** Accepted
**Issue:** #291

---

## Context

Projects exist as workspace containers for sessions (M4 Project API,
`src/api/projects.ts`), but they hold no files. M6 gives sessions
Claude Code-class capabilities — writing specs (`.md`), generating code,
editing files — and three consumers depend on file history:

- **Humans** need diffs and review of what an agent changed.
- **Sessions** need a stable snapshot to work against, even while another
  session in the same project writes concurrently.
- **AutoHarness (M7)** needs replayable fixtures: repository state at commit
  X plus the session events that produced it.

The alternatives all lose something: DB/object-storage blobs rebuild
versioning, diffs, and blame from scratch; a hosted git provider as the
source of truth makes every read a network call and couples runtime to an
external SLA.

## Decision

A hybrid model — **git owns content, the database owns metadata**:

1. **Content** lives in a git repository per project workspace, on local
   disk (a volume in production). The server drives it by shelling out to
   the system `git` CLI — no native bindings, no library lock-in; git is
   the platform feature.
2. **Metadata** lives in the existing store: file references, the session
   attribution of each write, and workspace bindings on the project row.
3. **Attribution:** every agent-driven write batch is one commit whose
   message carries a `session: <id>` trailer and, when applicable, the plan
   step it belongs to. The audit trail is then two-sided and joinable:
   event-sourced session log ↔ git history.
4. **Concurrency:** writes are serialized per workspace with a single-writer
   lock; readers always read a pinned commit or the tip under the lock.
   `# ponytail: per-workspace lock — per-file optimistic locking if
   concurrent sessions to one project ever become common`
5. **Fixture strategy (M7):** a harness run pins `repo@commit` + the session
   event range; no separate snapshot machinery is ever built.

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|--------------|
| DB blobs per file version | Managed, no disk | Rebuild diff/merge/history; no cloneable artifact; growth in DB | Reimplements git badly |
| Object storage (S3-style) + version ids | Cheap, scalable | Same rebuild problem; diff is an app concern | Fails review and fixture needs |
| Hosted git provider as backend | UI for free | Network per I/O; external SLA; tenant credential sprawl | Runtime must work offline/hermetically |
| Git worktrees on disk + DB metadata (chosen) | Diff/history/audit free; fixtures trivial; offline | Disk/volume ops; per-workspace lock ceiling | — |

## Consequences

- Production needs a persistent volume (Render disk or equivalent);
  ephemeral filesystems lose the workspace — the operator runbook must pin
  the workspace path.
- The files subgraph (ADR-011) is the only writer; direct session writes to
  disk bypassing the lock are a correctness bug, enforced by keeping the git
  helper private to that subgraph.
- Repo state is mutable history: destructive git operations (force-push,
  reset) are forbidden server-side; recovery is `revert` commits.
- Clone/checkout cost grows with repository size — accepted for now, with
  gc/prune scheduled if workspaces churn heavily.

## References

- Issues #291, #296 (files subgraph), #301 (session file writes)
- `src/api/projects.ts` (project container, M4)
- ADR-004 (event-sourced sessions — the other half of the audit trail)
- ADR-011 (federation boundaries the files subgraph plugs into)
