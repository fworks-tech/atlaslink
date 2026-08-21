# ADR-003: Atlas Holds the Sky of Sessions

**Date:** 2026-08-21
**Status:** Accepted

## Context

Atlaslink is the product that makes orchestrating a team of agents as intuitive as drawing a flowchart (ADR-002). The roadmap builds toward M1 (Daemon Core) → M2 (Event Bridge) → M3 (Task API) → M4 (Live Dashboard).

During product naming, the second meaning of "Atlas" surfaced and became the product's north star. In Greek mythology, Atlas was the Titan condemned to hold the sky on his shoulders; in cartography, Gerardus Mercator's 16th-century *Atlas* — a collection of maps with Atlas on the title page — gave the word its meaning of "a book of maps." Applied to this product:

- **Atlaslink is a book of maps** — each map is a live delegation graph of a user's task (nodes = members, edges = delegation, color = gate status, per ADR-002).
- **Atlas is the bearer** — the one holding all those maps/sessions on its shoulders, like Atlas held the sky.

Every task a user creates with Atlaslink is a session (a user-initiated orchestration). Exponential growth in tasks/sessions means Atlas carries a growing "sky" of sessions. This ADR records the decision that **Atlas is the product-level container and identity for all user sessions** — the entity that holds the collection of delegation maps the user can browse, reopen, and watch.

Critically: **Atlas is NOT a Society member.** Agenthood's runtime executes members; the first-in-line agenthood member is The Mediator (agenthood issue #480), which routes a single prompt. Atlas is a different layer — it is the *product's* umbrella over many sessions, not a single-run router.

## Decision

Atlas is the conceptual and structural umbrella of the Atlaslink product:

1. **Atlas = the aggregate of all user sessions.** A session is one user-initiated task orchestration. Atlas holds the set of all sessions the user creates — the "sky of sessions" carried on Atlas's shoulders.

2. **Atlas is Atlaslink-side, not agenthood-side.** Atlas lives in the atlaslink repository as the product identity + data model. It is never added to any agenthood `members` array and never invoked via `npx agenthood run`. Adding it there would violate ADR-002's read-only projection contract and blur the member/non-member boundary.

3. **Atlas names the product's top-level surface.** In the M4 Live Dashboard, Atlas is the root node from which all session delegation graphs hang — the collection of maps the user browses.

4. **The Mediator is the runtime counterpart but not Atlas.** For a single prompt entering the runtime, The Mediator (agenthood) is first in line: classify intent → hand off to a specialist. Atlas is not that router; Atlas is the store of every session those routers execute.

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| Make Atlas an agenthood member (first-in-line router) | Single entry point name | Collides with The Mediator (already claimed, issue #480) and Blurs member/product boundary; violates ADR-002 read-only projection | Atlas's job is holding sessions, not routing a single prompt |
| Atlas as a pure marketing name (no structure) | Zero design work | Loses the cohesive "book of maps / bearer of sessions" model the roadmap needs | The name should map to a real structural layer |
| Atlas as the aggregate-of-sessions umbrella (chosen) | Cohesive product identity; maps to M3 task/session model and M4 dashboard; separates product layer from runtime members | Requires the M3/M4 task/session data model to realize | Chosen — it gives the product its spine without touching the Society |

## Consequences

**Easier:**
- A clear product identity: Atlaslink = the book of maps; Atlas = the bearer of the sessions.
- Clean separation from agenthood: Atlas is Atlaslink's layer; The Mediator is agenthood's first-in-line member.
- The M3 Task API (task/session model) and M4 dashboard (Atlas as root node) have a named conceptual container.

**Harder:**
- The Atlas concept is only fully realized once M3 (task/session data model) and M4 (dashboard) land — until then it is a documented identity, not shipped structure.
- Must resist pressure to add Atlas to the Society's member registry; it would dilute the read-only projection contract.

**New risks:**
- Overscoping: without a crisp task/session model, "Atlas holds sessions" could become a vague metaphor. It is bound to the M3 Task API deliverable.

## References

- ADR-002 — Atlaslink as live projection of society provenance (M4 foundation)
- Agenthood issue #480 — The Mediator (first-in-line runtime member), the runtime counterpart
- Agenthood issue #479 — Steward lane reframe (Load routing) enabling clean mediator routing
- Agenthood issue #481 — original tracking of the Atlas concept on the agenthood side
- Atlaslink README roadmap M1–M4
