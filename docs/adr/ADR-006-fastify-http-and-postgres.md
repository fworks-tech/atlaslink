# ADR-006: Fastify HTTP Layer and PostgreSQL as the Primary Store

**Date:** 2026-08-27
**Status:** Accepted
**Issue:** M3 Task API (framework, storage, and product-shape follow-up)

## Context

Two forces converge: the HTTP surface has outgrown the hand-rolled `node:http` server
in `src/server.ts`, and the product is moving from a single-user daemon to a
multi-account system — accounts/users, tenant-scoped session history and tables, and
cloud integrations. Both are supportable, but only with a real framework and a real
relational store.

1. **Routing, validation, and serialization sprawl.** The bespoke router grows a
   conditional branch per route; request validation and response serialization are
   re-implemented by hand each time. With auth, webhook receivers, and CRUD surfaces
   arriving, a framework with schema-first validation, plugin composition, and a
   lifecycle model is the standard answer — Fastify: `fast-json-stringify` serializers,
   a mature plugin ecosystem, and pino as its default logger (congruent with ADR-005).

2. **The single-user storage model does not scale to accounts.** ADR-001/ADR-004 built
   durability on the NDJSON `EventLogStore`: rebuild-on-read, local file, no hosted
   dependency. That is correct for a hermetic local daemon and wrong as the backbone
   of a multi-tenant product:
   - Account and row-level data (users, tenants, session history, user tables,
     integration state) is relational and tenant-scoped by nature; scanning a shared
     NDJSON file cannot express `WHERE tenant_id = ?` or join a session to its user.
   - The per-tenant "seam" the m3 spec reserved for later is now the primary access
     pattern, not a filter bolt-on.
   - Optimistic `version` CAS and deterministic rehydration (ADR-004 Decision 4) are
     worth keeping — they are the *correct concurrency model* — but they must run against
     an indexable, queryable, concurrently-writable store.

**Why Postgres.** Sessions and account data are an OLTP-shaped workload — many writers,
point updates, optimistic versioning, joins across user/tenant/session — not DuckDB's
bulk-analytics or NDJSON's append-only envelope. Postgres's concurrency and SQL are the
native fit, it runs operated everywhere (managed service in production, fully in-process
via `pglite` in development and CI so the hermetic suite survives), and it is the
commodity relational engine with a standardized driver ecosystem. DuckDB/MotherDuck was
the right pick when the SQL lift was speculative and no product data existed; with
accounts and product tables on the roadmap its embedded single-writer file model is the
wrong shape.

## Decision

1. **Fastify becomes the HTTP layer.** `src/server.ts` is rebuilt on Fastify; all routes
   (`/runs`, `/events`, `/health`, and M3 `/tasks`) move to Fastify routes with JSON-schema
   validation and schema-based response serialization. The M2 transport decision
   ("zero new deps — native `node:http` SSE only", m2 spec success criterion 6) is
   superseded.

2. **The SSE contract survives the rewrite.** `GET /events` keeps its reconnection
   semantics — `Last-Event-ID` resume, the 15s `: ping`, `bridge.gap`/`bridge.shutdown` —
   as a Fastify route. The existing `sseEndpoint` tests are the contract and must pass
   unchanged in behavior.

3. **Logging adopts Fastify's pino while keeping ADR-005's contract.** One JSON object
   per line, level via env, `correlationId` threaded explicitly and now free per-request
   via pino request child loggers. ADR-005's hand-rolled `src/log.ts` emit path may be
   replaced by pino configuration; the ADR-005 contract and swallow boundary stand.

4. **PostgreSQL is the primary operational store.** Users, tenants, session state, and
   product tables live in Postgres. Development and hermetic tests run `pglite`
   (in-process, no network); production connects to managed Postgres. Postgres is the
   durable truth for account-scoped data, not a cached read-side.

5. **Event-sourced sessions persist to Postgres event tables.** The ADR-004 model holds —
   event append is the commit, `version` is the optimistic CAS token, rehydration is
   deterministic — but the event stream moves from the NDJSON file to Postgres
   append-only tables keyed by `tenant_id` + `session_id` (denormalized version included).
   Rehydration becomes a SQL-filtered read instead of a file scan, which is what makes
   tenant isolation and history queries first-class. The `SessionBackend` port stands;
   `PostgresBackend` replaces the planned `DuckDbBackend`, and the `duckdb` dependency
   token (ADR-004 Decision 6) is revoked.

6. **The NDJSON `EventLogStore` is demoted to agent-run provenance.** ADR-001/ADR-002's
   immutable append log remains valuable as the audit/provenance record of agent
   execution (what the runtime emitted), fed from the bridge and consumed by the M4
   provenance dashboard. It is no longer the source of truth for session data. Whether it
   itself migrates to Postgres is a later decision, not assumed either way here.

7. **Accounts and tenancy are first-class.** Every account-scoped table carries
   `tenant_id`; authorization is applied at the data-access boundary (and, where it pays,
   via Postgres row-level security), never spliced into per-route scans. The m3 spec's
   "tenantId = 'default', multi-tenancy = filter later" seam is retired.
   Auth flows, credential storage, and the exact user/tenant schema are scoped to the
   auth ADR; this ADR only fixes the boundary (framework, store, tenant-key discipline).

8. **The API splits from the streaming daemon.** The stateless API surface (session CRUD,
   auth, webhook receivers, queries) is packaged to deploy as serverless functions
   (AWS Lambda + API Gateway); the long-running daemon (agent runs + SSE fan-out) stays a
   containerized service. Lambda's execution-time and connection model cannot serve
   long-lived SSE streams; request/response surfaces are its natural fit. Cloud
   integrations add laterlong-running workers (polling/scheduling) which are ordinary
   services — deployed with the daemon, state in Postgres. Infrastructure (Terraform)
   and packaging (Docker) are scoped to a following infra ADR.

9. **Dependency posture: zero-new-deps becomes reviewed-dependencies.** Retiring the
   blanket zero-new-deps policy (M2 spec, ADR-004 Decision 6) in favor of: dependencies
   are acceptable when a framework or engine *is* the point (Fastify, `pg`/`pglite`);
   speculative dependencies remain deferred until their feature ships. Every new
   dependency is recorded in the ADR that brings it in.

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| Keep native `node:http` + NDJSON | Zero new deps; already shipped | Router/validation sprawl; no tenant expression; linear rescan | The account-product surface is exactly what this cannot absorb |
| Express | Ubiquitous, minimal | No schema validation or serialization story, weaker async throughput | The reason for a framework is validation + serialization, not routing sugar |
| NestJS | DI, batteries, enterprise conventions | Heavy scaffolding for a small surface | Adoptable later behind the route layer; Fastify fits now |
| Hono | Edge-friendly, fast | Younger ecosystem, weaker pino/serializer pairing | Fastify maturity covers the same ground with more ops familiarity |
| DuckDB (deferred track) | Embedded, offline, zero-hosted-dep | Single-writer file model; analytics-strong; MotherDuck niche | OLTP + accounts workload; Postgres runs offline via `pglite` anyway |
| Postgres only as materialization behind NDJSON truth | Keeps log as truth | Adds a second truth holder; account data still in files | With accounts, the DB is the truth; log demoted to provenance (Decision 6) |
| Keep NDJSON as session source of truth + Postgres for account data | Familiar to current code | Two divergent truth systems for the same session; tenant joins span stores | One relational truth for session + account data is simpler and consistent |

## Consequences

**Easier:**
- Schema-validated routes and serialization for a growing API surface, plus pino
  correlation threading per request (aligned with ADR-005).
- Real SQL for session history, `/tasks` filters, M4 dashboard queries, and the
  multi-tenant path that is now the primary access pattern.
- Postgres as the natural store for accounts, session history, product tables, and later
  integration/job state — one consistent data boundary.
- Serverless deployability for the stateless API without dragging the streaming daemon
  into Lambda's constraints.

**Harder:**
- New runtime dependencies (Fastify, `pg`/`pglite`) — the zero-new-deps posture is
  deliberately retired (Decision 9) and must stay principled.
- SSE must be re-implemented on Fastify without regressing reconnection semantics — the
  `sseEndpoint` tests are the gate.
- The session-role changes and account model touch the port boundary (migrations,
  RLS), so M3 task-rest now lands alongside auth plumbing, not before it.
- Production-postgres-vs-`pglite` parity must be verified — migrations run against both;
  dialect kept to standard SQL.

**New risks:**
- `pglite`/managed-Postgres drift — mitigated by running the same schema migrations in
  CI against both and keeping dialect surface standard.
- Auth correctness (credential handling, tenant scoping) is now a hard requirement before
  account-facing routes ship — the auth ADR must precede expose-any-user-data.
- Two deployment targets (serverless API, container daemon) plus later workers add
  orchestration surface — owned by the infra ADR, not grown ad hoc.
- The provenance story weakens if the NDJSON log is dropped prematurely — Decision 6
  keeps it fed and consumed until a deliberate migration decision is made.

## References

- ADR-001 — event log retention via NDJSON: stands for agent-run provenance (Decision 6).
- ADR-002 — read-only projection contract (unchanged).
- ADR-003 — Atlas holds the sky of sessions (unchanged).
- ADR-004 — session-aggregate durability: Decisions 1–2 and 4 stand; the DuckDB/NDJSON
  backend track (Decisions 3, 5, 6) is superseded by Decisions 4–5 of this ADR.
- ADR-005 — structured logging: contract stands; implementation may move to pino.
- M2 spec success criterion 6 — superseded by Decision 1.
- m3 spec §2 session model — `tenantId` seam retired by Decision 7.
- Auth ADR, infra ADR — pending; scoped here but not yet written.