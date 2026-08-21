# ADR-002: Live Diagram of Society Provenance

**Date:** 2026-08-21
**Status:** Accepted

## Context

Atlaslink's stated goal is to "make orchestrating a team of agents as intuitive as drawing a flowchart" (see README). The roadmap builds toward this: **M1 (Daemon Core)** hosts the long-running runtime, **M2 (Event Bridge)** streams real-time events to the browser, **M3 (Task API)** exposes an HTTP surface to drive orchestrations, and **M4 (Live Dashboard)** renders the live diagram-flow UI.

During planning for M4, we kept sketching the desired UI by hand: a picture of the Agenthood members as nodes, delegation arrows between them, and the outcome of each handoff marked on the node. It was, frankly, the most compelling artifact we had — a sparse, legible diagram that explained the whole system at a glance.

Then came the insight: **that manual delegation diagram is not a mockup of the product. It is the product's actual subject matter.** Agenthood already *is* a society whose members delegate to each other, whose every handoff is a delegation event with a gate status, and whose provenance and decision history are recorded to disk (`.agenthood/traces`, `.agenthood/provenance`, `.agenthood/decisions`). Atlaslink does not need to invent new telemetry or a custom instrumentation model to feed the diagram — the diagram was already being produced in every planning session. It simply is the live projection of the society's own provenance and delegation chain.

The M2 event decision (**issue #5 "resolve ADR-001 event persistence decision"**, pending) governs *how* the runtime's events are persisted and replayed. This ADR governs *what* those events are projected onto: the society's own lineage, not a bespoke dashboard.

## Decision

Atlaslink IS the live projection of the Agenthood society's own provenance/delegation chain — a real-time diagram of:

- **Members** — the nodes of the graph.
- **Delegation handoffs** — the directed edges between nodes.
- **Gate status** — the color of each node (pass/fail).

It consumes Agenthood's read-only **PROJECTION CONTRACT** (Agenthood ADR-021). The contract defines what the projection may read and how it must interpret it:

| Contract element | Maps to |
|------------------|---------|
| **nodes** | Agenthood members |
| **directed edges** | delegation handoffs |
| **node color** | gate status (pass / fail) |
| **click → drill into** | `.agenthood/traces`, provenance, and decision files |

The projection is **read-only**: Atlaslink visualizes what Agenthood already records; it does not extend or modify the runtime's telemetry to make the picture prettier.

The milestones slot into this naturally:

- **M2 Event Bridge** streams `RunEventBus` events from the runtime to the browser.
- **M3 Task API** drives orchestrations over the HTTP surface.
- **M4 Live Dashboard** renders the projection as the live diagram-flow UI.

The projection contract is the spine connecting them: the Event Bridge delivers the events, the Task API triggers the orchestrations that produce them, and the Live Dashboard renders the resulting lineage.

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| Bespoke dashboard with custom telemetry | Full control over data shape; decoupled from Agenthood internals | Duplication of the linkage Agenthood already records; drifting picture; extra instrumentation to build and maintain | Rejects the founding insight — the gorgeous UI is already the society's own lineage; building parallel telemetry recreates by hand what Agenthood records for free |
| Instrument Agenthood with Atlaslink-specific hooks | Attractive data shaped exactly for the UI | Couples Atlaslink into the runtime; violates read-only contract; harder to keep the runtime clean | The projection contract already exposes everything the diagram needs |
| Static/canned visualization (no live projection) | Simplest to build | Not live; not a "live diagram-flow" product; loses the pipeline-readability moat | Contradicts the core value proposition |

## Consequences

**Easier:**

- A genuine moat without bespoke plumbing — the live-orchestration experience comes from projecting real provenance, not from re-implementing an observability stack.
- The diagram is always truthful: it renders the same lineage the society actually executed, so what you see is what happened.
- Each milestone (M2/M3/M4) builds on a single, stable projection contract, so layers can be developed and reviewed independently.

**Harder:**

- We are constrained by the projection contract's shape; anything the contract doesn't expose (e.g. richer per-step metadata) requires an Agenthood-side change and an ADR there.
- Debugging drift between the runtime's recording and the projection's rendering is a real risk — the read-only boundary must be enforced rather than assumed.
- The plan is coupled to Agenthood ADR-021; if that contract changes, Atlaslink's projection must track it.

**New risks:**

- Contract drift between Agenthood and Atlaslink over time.
- Rendering latency if `RunEventBus` volume outpaces the projection's ability to update nodes.

## References

- Atlaslink [README.md](../README.md) — roadmap M1–M4, "live diagram-flow UI" goal.
- Atlaslink [CONTRIBUTING.md](../CONTRIBUTING.md) — branch/commit/PR conventions governing implementation of this decision.
- Atlaslink issue #5 — "resolve ADR-001 event persistence decision" (pending): governs how runtime events are persisted/replayed; the layer this ADR's projection consumes once written.
- Agenthood **ADR-021** — the read-only PROJECTION CONTRACT (nodes, directed edges, node color / gate status, click-to-drill into `.agenthood/traces`, provenance, decision files).
- Agenthood `.agenthood/traces`, `.agenthood/provenance`, `.agenthood/decisions` — the record files the drill-down reads.
