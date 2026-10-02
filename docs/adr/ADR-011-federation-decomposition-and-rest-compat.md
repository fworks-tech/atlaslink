# ADR-011: GraphQL Federation Decomposition With a REST Compat Window

**Date:** 2026-10-02
**Status:** Accepted
**Issue:** #290

---

## Context

Atlaslink is a single Fastify deployable: session lifecycle, task CRUD,
insights, room/auth/project routes all ship in one process
(`src/api/*`, `src/server.ts`). Module boundaries exist
(`src/session/`, `src/bridge/`, `src/insights.ts`) but nothing enforces
them at the deployment or contract level, and every consumer — the dashboard
above all — speaks REST directly.

Two forces push toward a graph:

- **Independent deployability.** Session execution, read-only reporting, and
  file/workspace serving have different scaling and failure profiles; they
  should not share one release train.
- **The agentic roadmap (M6).** Sessions will belong to projects sharing a
  workspace of files; consumers need composable queries (session + its plan +
  its file diffs) that REST endpoint sprawl cannot express without N+1
  round-trips.

The dashboard and any other existing consumers cannot be migrated in the same
change — a big-bang rewrite contradicts one-concern-per-branch and would
block M5 behind a full UI rewrite.

## Decision

1. **Subgraph boundaries:** four subgraphs — `session` (lifecycle, events,
   actions, room), `task` (CRUD, validation, diagram projection),
   `insights` (read-only reporting over events/traces), and `files`
   (workspace content, introduced with the git-backed workspace — ADR-012).
   The dashboard is a **consumer**, never a subgraph.
2. **Composition:** Federation v2-compatible schemas. Each subgraph is served
   with the `@apollo/subgraph` conventions over the existing Fastify
   handlers — the handlers move, the business logic does not get rewritten.
   Extraction is staged per subgraph (schema-compatible first, physically
   extracted when its branch lands), composed by an edge router.
   **Router vendor: Cosmo Router** — selected by a time-boxed spike
   (2026-10-02, results on #290) against the criteria below: pure
   Apache-2.0 with no license gate on any step, fully local composition
   (`npx wgc router compose`, no token — the closest fit to hermetic
   offline CI), native Windows binary, health endpoint + JSON structured
   logs (requires `dev_mode: false`), best cross-subgraph latency in the
   smoke test (7.44 ms avg). Apollo Router ranked 2nd (best DX, but ELv2
   is not open source and gates CI on license acceptance), Hive Router 3rd
   (no Windows binary — forces Docker on local dev).
3. **REST compat window:** existing REST routes persist as a thin BFF shim
   that translates to graph operations. The shim is the last thing standing
   between the monolith and its removal, with explicit deprecation criteria:
   - dashboard network layer runs entirely on the graph (issue #298);
   - no non-shim consumer has hit a legacy route for one full release;
   - shim removal is tracked as its own issue, never done "while we're in
     there".

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|--------------|
| Big-bang REST → graph rewrite | Single contract surface immediately | One enormous branch; blocks all M6 work; violates one-concern-per-branch | Schedule and review risk unacceptable |
| Graph additive, REST frozen forever | Zero consumer migration | Two contract surfaces maintained indefinitely; decomposition benefit never realized | The compat window becomes a permanent home |
| tRPC/gRPC between services | Type-safe, Node-native | No composition story for external/consumer queries; re-invents what the graph gives | Fails the composable-query requirement |
| Federation v2 + staged extraction + REST shim (chosen) | Ship subgraph-by-subgraph; consumers migrate last; each stage reversible | Dual surfaces during the window; router adds an ops component | — |

## Consequences

- Composition check runs in CI from the first subgraph; a breaking schema
  change fails before deploy, not in the dashboard.
- The router becomes a new runtime component — its health gate belongs in
  the operator runbook, and local dev needs a compose-from-source mode so
  `npm test` stays offline and hermetic.
- Session and task subgraphs initially read the same stores behind the
  `SessionBackend` port (ADR-009/ADR-010) — physical data separation is a
  later decision, not a prerequisite for decomposition.
- The REST shim is deliberate debt with a removal checklist, not an
  accident; every route kept alive there is listed in issue #297.

## References

- Issues #290–#298 (M5 — Federation & Workspace milestone)
- ADR-002 (read-only projection), ADR-006 (Fastify + Postgres),
  ADR-008 (auth and tenancy), ADR-009/ADR-010 (SessionBackend port)
- `src/api/*` (routes to be redistributed), `src/server.ts` (composition root)
