# Agenthood Sequence Diagrams — Live Execution Evidence

> **Purpose:** Record the delegation *occurrences* from the "capture the insight as ADRs" session, as evidence of the Agenthood runtime actually executing the multi-member delegation chain. These diagrams are the concrete visual contract that Atlaslink's M4 Live Dashboard (ADR-002) must render in real time from `RunEventBus` events and `.agenthood/provenance/*.json`.

The task-level view below is exactly the orchestration graph Atlaslink shows for a user "task"; the per-run views are the drill-down when a node is clicked.

## 1. Top-level "task" diagram — user prompt → sequence of member runs → outcome

Runs recorded from `2026-08-21T05:03`–`05:17` (see `.agenthood/provenance/`).

```mermaid
sequenceDiagram
    autonumber
    actor user as User (task: "capture insight as ADRs")
    participant ah as Agenthood Runtime

    user->>ah: npx agenthood run the-architect "draft ADR-021..."
    activate the-architect
    the-architect-->>ah: written to atlaslink cwd (sandbox: sibling repo blocked)
    deactivate the-architect
    ah->>ah: move ADR-021 to agenthood repo + correct facts (.json, ADR-020 title)

    user->>ah: npx agenthood run the-doorman "validate branch docs/issue-477..."
    activate the-doorman
    the-doorman-->>ah: PASS
    deactivate the-doorman

    user->>ah: npx agenthood run the-architect "draft ADR-002..."
    activate the-architect
    the-architect-->>ah: OK (atlaslink/docs/adr/ADR-002)
    deactivate the-architect

    user->>ah: npx agenthood run the-sentinel "validate ADR-002 structure"
    activate the-sentinel
    the-sentinel-->>ah: 2 drift findings
    deactivate the-sentinel
    ah->>ah: remove spec-only sections + reframe ADR-001 ref

    user->>ah: npx agenthood run the-sentinel "re-validate"
    activate the-sentinel
    the-sentinel-->>ah: CLEAN PASS
    deactivate the-sentinel

    user->>ah: npx agenthood run the-librarian "doc quality"
    activate the-librarian
    the-librarian-->>ah: minor terminology finding -> fixed
    deactivate the-librarian

    user->>ah: npx agenthood run the-doorman "branch + commit standards"
    activate the-doorman
    the-doorman-->>ah: PASS
    deactivate the-doorman

    user->>ah: npx agenthood run the-scribe "commit msgs + PR descriptions"
    activate the-scribe
    the-scribe-->>ah: PASS
    deactivate the-scribe

    ah-->>user: ADR-021 (agenthood PR #478) + ADR-002 (atlaslink PR #11), both on boards
```

`RunEventBus` emits each step live (`run.started`, `tool.called`, `decision.recorded`, `run.finished/failed`) — the stream the M2 Event Bridge relays to the M4 dashboard.

## 2. Per-run diagrams (drill-down views)

### a. the-architect — draft ADR-021
```mermaid
sequenceDiagram
    autonumber
    actor user
    participant arch as the-architect
    participant tools as Tool sandbox (cwd=atlaslink)

    user->>arch: task: draft ADR-021 (projection contract)
    arch->>tools: read RunEventBus/ProvenanceStore/DecisionLog
    tools-->>arch: BLOCKED (path traversal: sibling repo denied)
    arch->>tools: read AGENTS.md + PROGRESS.md (fallback)
    arch->>tools: WRITE atlaslink/docs/adr/ADR-021.md
    arch-->>user: DONE + caveat: "move target repo needed"
```

### b. the-sentinel — validate ADR-002 (first pass)
```mermaid
sequenceDiagram
    autonumber
    actor user
    participant sent as the-sentinel
    participant scan as docs/adr/ scan

    user->>sent: task: structural validation of ADR-002
    sent->>scan: read ADR-002 + list docs/adr/
    scan-->>sent: only ADR-002 present (no ADR-001)
    sent-->>user: FAIL - spec sections + dangling ADR-001 reference
```

### c. the-sentinel — re-validate (clean pass)
```mermaid
sequenceDiagram
    autonumber
    actor user
    participant sent as the-sentinel

    user->>sent: task: re-validate ADR-002 after fixes
    sent->>sent: verify heading sequence
    sent->>sent: verify ADR-001 framed as pending issue #5
    sent-->>user: CLEAN PASS
```

### d. the-librarian — doc quality
```mermaid
sequenceDiagram
    autonumber
    actor user
    participant lib as the-librarian

    user->>lib: task: review doc quality + cross-refs
    lib->>lib: README + ADR-002 consistency (M1-M4, "live diagram-flow UI")
    lib-->>user: finding: "gate outcome" vs "gate status" -> unified
```

### e. the-scribe — commit messages + PR descriptions
```mermaid
sequenceDiagram
    autonumber
    actor user
    participant scr as the-scribe

    user->>scr: task: finalize commit msgs + PR descriptions (2 changes)
    scr->>scr: verify imperative/lowercase/<=150/no trailing period
    scr-->>user: "docs(adr): add ADR-021..." + "docs(adr): add ADR-002..." + PR bodies + Closes #N
```

## Design

- **Task-level view** (section 1) = the orchestration graph Atlaslink shows for a user prompt.
- **Per-run view** (section 2) = drill-down when a member node is selected.
- Both are rebuilt in real time from `.agenthood/provenance/*.json` + `RunEventBus` events, per Agenthood ADR-021 (projection contract) and Atlaslink ADR-002 (live diagram of society provenance).
