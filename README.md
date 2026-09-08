# Atlaslink

> Multi-agent orchestration with a live diagram-flow UI. Compose agents like drawing a flowchart, watch them run in real time, and collaborate with them through a WebSocket room.

[![CI](https://github.com/fworks-tech/atlaslink/actions/workflows/ci.yml/badge.svg)](https://github.com/fworks-tech/atlaslink/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js >= 22.14](https://img.shields.io/badge/node-%3E%3D22.14-339933.svg)](https://nodejs.org)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Live dashboard:** [atlas.flabs.tech](https://atlas.flabs.tech) · **[Architecture](docs/architecture/README.md)** · **[ADRs](docs/adr/)** · **[Issues](https://github.com/fworks-tech/atlaslink/issues)**

---

## What is Atlaslink?

Atlaslink is a product-oriented multi-agent orchestrator built on **[Agenthood](https://github.com/fworks-tech/agenthood)**, an agent-team runtime. It turns a black-box pipeline into a live, visual flow you can read, debug, and steer — and it gives you a REST + event surface to drive everything programmatically.

## Features

- **Live diagram-flow composer** — drag agents onto a canvas, wire them together, and watch the execution unfold in real time. The full DAG renders as a society of nodes: reasoning hexagons, tool parallelograms, diamond decisions, and terminal states.
- **Real-time event bridge** — every agent decision and action streams to the browser over Server-Sent Events with `Last-Event-ID` resume, gap detection, and 15-second pings.
- **Human-in-the-loop collaboration** — agents ask single questions via `ask_human`, park the session, and resume from your reply. A per-session WebSocket room lets multiple people observe and steer together.
- **Task & project APIs** — create, list, cancel, reply to, and steer sessions over a bearer-gated HTTP surface. Projects group sessions; the event feed is addressable per session or per project.
- **Event-sourced sessions** — every state change is appended to a durable, rotating NDJSON log. Sessions survive deploys and cold starts when backed by Postgres.
- **Auth & tenancy** — JWT sessions (7-day expiry), SHA-256-hashed API keys, tenant isolation, fail-closed non-loopback binding, and per-user rate limiting.

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js >= 22.14, TypeScript 5.9, tsx |
| HTTP server | Fastify 5, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/websocket` |
| Database | Postgres (production) via `pg`, pglite (CI/tests) — same SQL on both |
| Event store | NDJSON append-only log (10 MB × 3 rotation) |
| Frontend | Next.js 16, React 19, Mantine 9, Tailwind CSS v4, React Flow 12, dagre layout |
| Auth | JWT (HS256), API keys (SHA-256 hashed), scrypt passwords |
| Testing | Node built-in test runner (backend), Vitest (dashboard), c8 coverage |
| CI/CD | GitHub Actions, auto-deploy to Render, semantic-release |

## Quick start

```bash
# 1. Clone and build the Agenthood core machine (sibling repo)
git clone https://github.com/fworks-tech/agenthood.git ../agenthood
cd ../agenthood && npm run build && cd -

# 2. Install and configure Atlaslink
npm install
cp .env.example .env   # then set OPENCODE_API_KEY (or GROQ_API_KEY for free tier)

# 3. Run the daemon and dashboard together
npm start                 # backend on :3000
npm --prefix dashboard run dev   # dashboard on :3001 → http://127.0.0.1:3001
```

Visit <http://127.0.0.1:3001> and create your first session. Or skip local setup and open the hosted dashboard at **[atlas.flabs.tech](https://atlas.flabs.tech)**.

> **No LLM key?** The runtime falls back through its configured providers (Groq via `GROQ_API_KEY`, free at [console.groq.com](https://console.groq.com)), or to Ollama for fully offline execution — no key required.

## API reference

All routes are prefixed with `/v1`. Auth is via `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Liveness + version + uptime |
| `POST` | `/v1/tasks` | Create + enqueue a task |
| `GET` | `/v1/tasks` | List tasks (filter by `projectId`, `status`, `since`, `limit`, `offset`) |
| `GET` | `/v1/tasks/:sessionId` | Get task aggregate |
| `POST` | `/v1/tasks/:sessionId/cancel` | Cancel a task |
| `POST` | `/v1/tasks/:sessionId/reply` | Reply to a parked session |
| `POST` | `/v1/tasks/:sessionId/steer` | Steer/interrupt a running session |
| `POST` | `/v1/tasks/:sessionId/message` | Send an anytime chat message |
| `POST` | `/v1/runs` | Delegate a session to the queue |
| `GET` | `/v1/events` | Global SSE stream (with `Last-Event-ID` resume) |
| `GET` | `/v1/events/:sessionId` | Per-session SSE |
| `GET` | `/v1/projects/:projectId/events` | Per-project SSE |
| `POST` | `/v1/projects` | Create a project |
| `GET` | `/v1/projects` | List projects |
| `WS` | `/v1/sessions/:id/room` | WebSocket room channel |
| `POST` | `/v1/auth/register` | Register account, returns JWT |
| `POST` | `/v1/auth/login` | Login, returns JWT |
| `POST` | `/v1/auth/keys` | Create API key |

Full spec: [`docs/spec/m3-task-api.md`](docs/spec/m3-task-api.md) · [`docs/spec/auth-api.md`](docs/spec/auth-api.md)

### Example

```bash
# Create a task
curl -X POST http://127.0.0.1:3000/v1/tasks \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ATLASLINK_API_TOKEN" \
  -d '{"member":"the-scribe","prompt":"draft a commit message"}'

# Stream events
curl -N http://127.0.0.1:3000/events \
  -H "Authorization: Bearer $ATLASLINK_API_TOKEN"
```

## Security

Atlaslink enforces a fail-closed auth model:

- **JWT sessions** (HS256, 7-day expiry) for dashboard users; **API keys** (`ak_`-prefixed, SHA-256 hashed) for programmatic access.
- **Tenant isolation** — every request is scoped by `request.auth.tenantId`; the `x-tenant-id` header is rejected when auth is present.
- **Fail-closed binding** — the daemon refuses to bind a non-loopback address without auth configured.
- **Rate limiting** — 100 requests per minute, keyed by user ID or IP.
- **Secret scanning** via Gitleaks in CI; no secrets in code or logs.

Details: [ADR-008](docs/adr/ADR-008-auth-and-tenancy.md)

## Deployment

### Render (recommended)

`render.yaml` defines a Docker-based daemon plus a free-tier Postgres. Sessions survive deploys and cold starts when `ATLASLINK_DATABASE_URL` is set. Auto-deploy triggers after every green CI run on `main`.

```bash
# Set in the Render dashboard:
#   OPENCODE_API_KEY (or GROQ_API_KEY)
# Copy the generated ATLASLINK_API_TOKEN into dashboard/.env.local:
echo 'ATLASLINK_API_URL=https://atlaslink-daemon.onrender.com' >> dashboard/.env.local
echo 'ATLASLINK_API_TOKEN=<your-token>' >> dashboard/.env.local
```

### Docker

```bash
docker build -t atlaslink .
docker run -p 3000:3000 --env-file .env atlaslink
```

### Vercel (dashboard)

The dashboard at [atlas.flabs.tech](https://atlas.flabs.tech) is a Next.js app with a BFF proxy (`/api/*` → backend). Set `ATLASLINK_API_URL` and `ATLASLINK_API_TOKEN` as build-time env vars.

### Oracle Cloud Always Free

A zero-cost option: VM + Caddy + Docker Compose. See [`docs/tasks/deploy-oracle-free-tier.md`](docs/tasks/deploy-oracle-free-tier.md).

## Roadmap

| Milestone | Scope | Status |
|-----------|-------|--------|
| **M1 — Daemon Core** | Long-running Fastify server, per-task `ApplicationContext`, `RunEventBus` subscription | Shipped |
| **M2 — Event Bridge** | NDJSON `EventLogStore` → `EventBroadcaster` → SSE with resume, gap detection, 15 s ping | Shipped |
| **M3 — Task API** | Bearer-gated `POST/GET /tasks`, cancel, per-session/project SSE, Postgres-backed | Shipped — [spec](docs/spec/m3-task-api.md) |
| **M4 — Live Dashboard** | `SocietyDiagram` (`chain\|fanout\|full` DAG), `SessionInspector`, `awaiting_input` ↔ `user_reply` loop, deep-links, composer overlay | Shipped — [tasks](docs/tasks/m4-live-dashboard.md) |
| **M5 — HITL Room** | Single-question `ask_human` → park → reply → linked resume, WS room, steer/interrupt, approval inbox | Shipped — [spec](docs/spec/m5-hitl-room.md) |

Milestones M1–M5 are shipped on `main`. The backlog focuses on analytics, session export, cost tracking, and Oracle Cloud migration.

## Quality gates

```bash
npm test                 # hermetic test suite (no LLM/API key required)
npm run test:coverage    # c8 coverage
npm run lint             # ESLint
npm run typecheck        # TypeScript tsc --noEmit

npm --prefix dashboard run dev     # dashboard dev server
npm --prefix dashboard run test    # Vitest unit tests
npm --prefix dashboard run lint    # ESLint
npm --prefix dashboard run typecheck
```

## Documentation

- [Architecture overview](docs/architecture/README.md)
- [Decision records (ADRs)](docs/adr/)
- [Full DAG case studies](docs/diagrams/full-dag-case-studies.md) (mermaid)
- [Task API spec](docs/spec/m3-task-api.md)
- [HITL room spec](docs/spec/m5-hitl-room.md)
- [Auth API spec](docs/spec/auth-api.md)
- [Dashboard README](dashboard/README.md)
- [Disaster recovery runbook](docs/runbooks/disaster-recovery.md)

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, commit (Conventional Commits), and pull-request workflow. The repository enforces these standards via **Agenthood** — see [AGENTS.md](AGENTS.md).

## License

Distributed under the [Apache License 2.0](LICENSE). Copyright 2026 Fabio Ritzel Borges.
