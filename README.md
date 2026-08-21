# Atlaslink

> **Status: Coming soon** — Atlaslink is an early proof-of-concept. Today only the underlying **Agenthood** runtime is runnable; the live diagram-flow UI and HTTP surface are on the roadmap.

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

The scaffold is in. What works right now is the **Agenthood Autonomous Runtime** that Atlaslink is built on: a 19-member agent team you can invoke directly from the CLI.

This is **not yet** the Atlaslink UI — that arrives with roadmap milestones **M1 (Daemon Core)** through **M4 (Live Dashboard)**.

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

> **No key?** The `just-do` CLI and member tooling fall back to Groq (`GROQ_API_KEY`, free at console.groq.com), or to Ollama for fully offline execution — no key required.

## Roadmap

| Milestone | Scope |
|-----------|-------|
| **M1 — Daemon Core** | Long-running daemon, agent runtime hosting |
| **M2 — Event Bridge** | Real-time event feed bridged to the browser |
| **M3 — Task API** | HTTP surface for driving the orchestrator |
| **M4 — Live Dashboard** | The live diagram-flow UI |

Track active work and open issues on the [issues page](https://github.com/fworks-tech/atlaslink/issues).

## Contributing

We'd love your help. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, commit, and pull-request workflow — the repository enforces [Conventional Commits](https://www.conventionalcommits.org/) and agent-team standards via **Agenthood** (`AGENTS.md`).

## License

Distributed under the [Apache License 2.0](LICENSE).
