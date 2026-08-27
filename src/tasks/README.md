# src/tasks — the M1-era in-memory registry

`TaskRegistry` is the original, M1-era in-memory task/session store. It is the
**legacy** surface: the M3 session layer ([`src/session/README.md`](../session/README.md))
supersedes its durability and concurrency model.

## What it provides today

- `create({member, prompt, provider?})` — assigns `ses-…` / `cor-…` ids and a
  dedicated `correlationId`, stamped onto the run's `ExecutionContext` so events,
  traces, decisions, and provenance join by it.
- `start` / `succeed` / `fail` — the M1 status machine that `runSession` drives.
- `msg(error)` — the standard error-to-string helper used across the codebase.
- `SessionStatus` — the shared `queued|running|succeeded|failed` constants.

## Why it still exists

`runTask.ts` and `taskRegistry.ts` are a **cross-branch invariant** (untouched by
the M3 refactor): `createAppServer` and `SessionQueue` depend on the registry to
route and finalize runs, and the read-only projection contract (ADR-002) requires
widely-used seams never to be re-plumbed while a rewrite is in flight. The task-rest
branch reconciles it with the event-sourced session aggregate, which also carries a
`cancelled` status this legacy model lacks.