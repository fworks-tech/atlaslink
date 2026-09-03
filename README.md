# Atlaslink

> **Status: M1–M5 shipped — Daemon, Event Bridge, Task API, Live Dashboard (FULL DAG `chain|fanout|full`, deep-links `/project/:p/session/:s` + `/s/:token` + `?q=<b64url>`) and HITL collaboration room (single-question `ask_human` → park → reply → linked resume, WS room + socketless roster) on `main` (#76 via #77–#81 + #83, Vercel https://atlas.flabs.tech).**

Multi-agent orchestrator, Agenthood proof-of-concept, and modern UI to integrate agents through gorgeous, easy-to-use, live diagram flows.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js >= 22.14](https://img.shields.io/badge/node-%3E%3D22.14-339933.svg)](https://nodejs.org)

---

## What is Atlaslink?

Atlaslink is a product-oriented multi-agent orchestrator built on top of **[Agenthood](https://github.com/fworks-tech/agenthood)**, the agent-team runtime. Its goal is to make orchestrating a team of agents as intuitive as drawing a flowchart.

- **A live diagram-flow UI** — compose agents as visual nodes and connections, and watch them run in real time.
- **A real-time event feed** — every agent decision and action is bridged from the core runtime straight to the browser.
- **A REST/event surface** — a Task API (roadmap M3) to drive the orchestrator programmatically.
- **A hosted product** beginning as an open proof-of-concept — Prototype → product, productized from day one.

## Why Atlaslink?

Orchestrating multiple AI agents today means hand-written glue code, opaque execution, and no visibility into what is happening. Atlaslink treats the agent team the way you would treat a team of people:

- **See what is happening** — a live diagram turns a black-box pipeline into something you can read and debug.
- **Compose, don't code** — wire agents together visually instead of maintaining orchestration logic by hand.
- **A product, not a script** — architected for a real hosted future (SaaS moat is the live orchestration experience, the service, and the ops — not the source).

## What runs today

**M1 Daemon + M2 Event Bridge + M3 Task API + M4 Live Dashboard + M5 HITL room** are shipped on `main`:

- **M1 Daemon** — long-running Fastify server that validates the LLM provider config up front, hosts an `ApplicationContext` per task and subscribes to its `RunEventBus` (`/health` + `src/daemon/`).
- **M2 Event Bridge** — NDJSON `EventLogStore` → `EventBroadcaster` → SSE (`GET /events`, `GET /events/:sessionId`, `GET /projects/:projectId/events`) with `Last-Event-ID` resume, `bridge.gap`/`bridge.shutdown` and 15 s ping (`src/bridge/`).
- **M3 Task API** — bearer-gated `POST/GET /tasks`, `POST /tasks/:id/cancel|reply|diagram`, `GET /tasks?projectId&status` and `POST/GET /projects` over Postgres (`src/session/`, `src/api/`). See [spec](docs/spec/m3-task-api.md).
- **M4 Live Dashboard** — `SocietyDiagram` (`chain|fanout|full` FULL DAG with hex/diamond/stadium/terminal), `SessionInspector`/`SessionThread`, `awaiting_input` ↔ `user_reply` loop and deep-links `/?session=&project=&node=&mode=full`, `/?q=<b64url>`, `/project/:p/session/:s`, `/s/:token` (`dashboard/`, [case studies](docs/diagrams/full-dag-case-studies.md)).

- **M5 HITL collaboration room** (shipped, #76 closed via #77–#81 + #83) — single-question `ask_human` → park → reply → linked resume; WS room (`/sessions/:id/room`) + socketless roster read. See [spec](docs/spec/m5-hitl-room.md).

> **Architecture:** see [docs/architecture/README.md](docs/architecture/README.md) for the whole-system map, per-layer notes under `src/` and `dashboard/`, and the ADR index. Production dashboard at **https://atlas.flabs.tech** (Vercel `force-dynamic` `/?session` — see #64).

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) `>= 22.14`
- `npm`
- The **Agenthood** sibling repository at `../agenthood` (a `file:` dependency). Clone it once:

  ```bash
  git clone https://github.com/fworks-tech/agenthood.git ../agenthood
  ```

### Setup

```bash
# 1. Build the agenthood core machine once (before first run)
cd ../agenthood && npm run build && cd -

# 2. Install dependencies
npm install

# 3. Configure your LLM provider key
cp .env.example .env
#    then edit .env and set OPENCODE_API_KEY
```

### Use the Agenthood runtime

```bash
# List the agent team
npx agenthood list

# Run a health check
npx agenthood check

# Invoke any member against a task
npx agenthood run the-scribe "write a commit message for the current diff"
npx agenthood run the-architect "plan the implementation for issue #42"
```

> **No key?** `agenthood run` falls back through its configured providers (Groq via `GROQ_API_KEY`, free at console.groq.com), or to Ollama for fully offline execution — no key required.

### Run the Atlaslink daemon (M1)

```bash
npm start        # listens on http://127.0.0.1:3000 (ATLASLINK_HOST/PORT override)
npm run dev      # same, with file watching (tsx watch)
curl http://127.0.0.1:3000/health

npm run run -- the-architect "1-line plan for the event bridge"   # one-shot member run
npm test         # hermetic test suite (no LLM/API key required)
npm run typecheck  # TypeScript type checking
```

The daemon boots a long-running server that validates the LLM provider config up front, hosts an `ApplicationContext` per task, and subscribes to its `RunEventBus` — the spine the event bridge (M2) and the dashboard (M4) build on. The event log lives at `data/events.ndjson` (rotated 10 MB × 3, cursor in `data/events.seq`).

### Run the Live Dashboard (M4)

```bash
# two terminals — backend + BFF dashboard
npm start                 # :3000 (ATLASLINK_HOST/PORT, ATLASLINK_DATABASE_URL, ATLASLINK_CORS_ORIGINS)
npm --prefix dashboard run dev   # :3001 → http://127.0.0.1:3001 (proxies to ATLASLINK_API_URL, server-only ATLASLINK_API_TOKEN)
# or single-process production alias
# https://atlas.flabs.tech  (Vercel, `force-dynamic` so `/?session=&mode=full` is never prerendered — see #64)
```

Configure `dashboard/.env.local` when proxying a remote backend (Render :10000 vs local :3000):

```bash
ATLASLINK_API_URL=https://atlaslink-backend.onrender.com
ATLASLINK_API_TOKEN=<your-atlaslink-token> # must match backend ATLASLINK_API_TOKEN (placeholder — not a real token)
```

Selecting a session from the sidebar pushes `/?session=<id>&project=<id>&mode=full` (canonical deep-link; `/?q=<b64url>` and `/project/:p/session/:s` + `/s/:token` redirect there). The header shows *Viewing session `ses-…`*; the diagram isolates to `ATLAS → selected SESSION card → mediator delegation chain (reasoning hex → tool parallelogram → decision diamond → awaiting/terminal)` and updates live from the event bridge.

### Event Bridge (M2)

Run events persist to an append-only NDJSON log and stream to the browser over Server-Sent Events:

```bash
curl -N http://127.0.0.1:3000/events                          # live-tail only
curl -N -H "Last-Event-ID: 42" http://127.0.0.1:3000/events   # resume from 43
curl -N http://127.0.0.1:3000/events/ses-abc123               # per-session tail
curl -N http://127.0.0.1:3000/projects/prj-1/events           # per-project tail
```

Each SSE frame carries `id:` (the replay cursor), `event:` (the type, passed **verbatim** per the read-only projection contract), and `data:` (one JSON line). A resume older than the retention window yields `event: bridge.gap`, never silence. Idle connections receive a `: ping` every 15 s; SIGINT/SIGTERM sends `event: bridge.shutdown` before closing.

Delegating a run publishes `session.*` events (`session.queued/started/succeeded/failed`) and processes the queue strictly one session at a time:

```bash
curl -X POST http://127.0.0.1:3000/runs \
  -H 'Content-Type: application/json' \
  -d '{"member":"the-scribe","prompt":"draft a commit message"}'   # 202 {session}
```

The bridge is layered in `src/bridge/`:

- **`EventLogStore`** — durable source of truth: monotonic `eventId`, rotation, corrupt-tail tolerance, cursor restore.
- **`EventBroadcaster`** — verbatim fan-out, replay (slow-client eviction bounds catch-up), and `detectGap()`.
- **`SessionQueue`** — serial FIFO worker emitting `session.*` events with an injectable runner.
- **`sseEndpoint`** — `SseHandler` (framing, replay, `bridge.gap`/`bridge.shutdown`, ping) + `formatSse`.

## Logging

Atlaslink emits structured **JSON lines to stderr** (one object per line), so a
piped `stdout` stays clean for the human-facing result text. Control verbosity
with `ATLASLINK_LOG_LEVEL` (`debug` | `info` | `warn` | `error`, default `info`):

```bash
ATLASLINK_LOG_LEVEL=debug npm run dev
```

Each line is shaped like:

```json
{ "ts": "2026-08-24T12:00:00.000Z", "level": "info", "msg": "request", "method": "POST", "url": "/runs", "status": 202, "durationMs": 3, "correlationId": "cor-…" }
```

Session-scoped lines carry `correlationId`, so you can filter every log for one
session with `jq`. The logging decision and the explicit swallow boundary (which
failure paths stay silent by design) are recorded in
[ADR-005](docs/adr/ADR-005-structured-json-logging.md).

## Roadmap

| Milestone | Scope | Status |
|-----------|-------|--------|
| **M1 — Daemon Core** | Long-running daemon, agent runtime hosting | Shipped |
| **M2 — Event Bridge** | Real-time event feed bridged to the browser | Shipped |
| **M3 — Task API** | HTTP surface for driving the orchestrator (Fastify + Postgres, bearer gate, `POST/GET /tasks`, cancel, per-session/project SSE) | Shipped (#44, #46) — [spec](docs/spec/m3-task-api.md) |
| **M4 — Live Dashboard** | The live diagram-flow UI — `chain|fanout|full` DAG, Inspector/Thread, `awaiting_input` ↔ `user_reply` loop, deep-links `/project/:p/session/:s` + `/s/:token` + `?q=<b64url>` — [FULL DAG case studies](docs/diagrams/full-dag-case-studies.md) (7 prompts, mermaid) | Shipped (#58 projects, #63 FULL DAG, #64 `force-dynamic`) — [tasks](docs/tasks/m4-live-dashboard.md) |
| **M5 — HITL Room** | Human-in-the-loop collaboration per session — queue lanes + fairness, single-question `ask_human` → park → reply → linked resume, steer/interrupt, WS room + socketless roster read, approval inbox | Shipped (#76 via #77 message-log, #78 lanes, #79 ask-park, #80 steer, #81 room-ws, #83 spike + agenthood #502) — [spec](docs/spec/m5-hitl-room.md) |

Track active work and open issues on the [issues page](https://github.com/fworks-tech/atlaslink/issues).

## Contributing

We'd love your help. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, commit, and pull-request workflow — the repository enforces [Conventional Commits](https://www.conventionalcommits.org/) and agent-team standards via **Agenthood** (`AGENTS.md`).

## License

Distributed under the [Apache License 2.0](LICENSE).
