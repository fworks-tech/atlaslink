# FULL DAG Case Studies — Live Society Diagram

> Contract: `docs/adr/ADR-002` (members=nodes, handoffs=edges, color=gate, click→traces) and `ADR-003` (Atlas root). Rendered live by `dashboard/src/lib/graph.ts:49` `buildSocietyGraph({mode:"full"})` via dagre `TB` → React Flow.

## Legend

```mermaid
flowchart TD
  Atlas["Atlas<br/>root · bearer of sessions"]
  Atlas --> Session["Session<br/>queued / running / awaiting_input / succeeded / failed / cancelled"]
  Session --> M1["Member<br/>active pulse if running last"]
  M1 --> R1{{"reasoning<br/>hex — step coalesced"}}
  R1 --> T1[/"tool.called<br/>hex/parallelogram — name + args"/]
  T1 --> T1r[/"tool.result<br/>output"/]
  T1r --> D1{"decision<br/>diamond — outcome"}
  D1 --> Await["awaiting_input<br/>stadium dashed — Atlas asks"]
  Await --> Term(["terminal<br/>octagon ✔/✖"])
  classDef atlas fill:#0a0e1a,stroke:#7aa2ff
  classDef session fill:#0f1526,stroke:#ffffff1a
  classDef ok fill:#166534,stroke:#3ddc97
  classDef fail fill:#7f1d1d,stroke:#ff6b6b
  classDef running fill:#1e3a5f,stroke:#7aa2ff
```

- `StatusBadge` colors: `succeeded=ok`, `failed=danger`, `running=accent`, `awaiting_input=accent dashed`.
- Reasoning coalesced by `step` in `dashboard/src/lib/runProjection.ts:1`, tool pairing via `pairId` `dashboard/src/lib/eventPairing.ts:1`.
- Deep-link: `https://atlas.flabs.tech/project/<projectId>/session/<sessionId>?mode=full` or `?q=<base64url({p,s,n,m})>` via `dashboard/src/lib/shareLink.ts:1`.

---

## 1. Understand codebase (read-only fan-out)

```mermaid
flowchart TD
  Atlas --> S1["Session: understand codebase<br/>succeeded"]
  S1 --> Mediator
  Mediator --> Oracle
  Mediator --> Librarian
  Oracle --> Architect
  Librarian --> Architect
  Architect --> Scribe
```

Prompt: `Help me to understand the codebase on https://github.com/...` — mediator routes to `the-oracle`/`the-librarian` parallel reads, `the-architect` synthesizes, `the-scribe` records. No `Builder` mutation.

## 2. Fix bug (happy + retry loop)

```mermaid
flowchart TD
  Atlas --> S42["Session Fix #42<br/>succeeded"]
  S42 --> Mediator --> Debugger --> Builder --> Tester --> Reviewer
```

```mermaid
flowchart TD
  Atlas --> S43["Session Fix #43<br/>failed → retry"]
  S43 --> Mediator --> Debugger --> Builder --> Tester
  Tester -- "fail" --> Builder
  Builder --> Tester --> Reviewer
```

Live recolor via `session.succeeded/failed` `dashboard/src/lib/sessionProjection.ts:13`.

## 3. Add feature (Spec→Build→Test→Review)

```mermaid
flowchart TD
  Atlas --> SF["Session: add feature X<br/>awaiting_input"]
  SF --> Mediator --> Strategist --> Architect --> Builder --> Tester --> Reviewer --> Herald
  Tester --> Tool1[/"tool: read_file"/]
  Tool1 --> Tool1r[/"tool.result"/]
  Tool1r --> Dec1{"decision: review pass"}
  Dec1 --> Herald
  SF -.-> Await["Atlas: confirm API shape?"]
```

Shows `session.awaiting_input` dashed stadium + docked reply input `dashboard/src/app/page.tsx:1` → `POST /tasks/:id/reply`.

## 4. Refactor (Warden gate)

```mermaid
flowchart TD
  Atlas --> SR["Session: refactor module Y<br/>succeeded"]
  SR --> Mediator --> Warden --> Architect --> Builder --> Tester --> Reviewer
  Warden -. "gate pass" .-> Reviewer
```

`the-warden` gate color; full DAG shows `decision` diamond `gate pass/fail`.

## 5. Audit (parallel fan-out)

```mermaid
flowchart TD
  Atlas --> SA["Session: audit codebase<br/>succeeded"]
  SA --> Mediator --> Auditor
  Auditor --> Warden
  Auditor --> Sentinel
  Auditor --> Tester
  Warden --> Reviewer
  Sentinel --> Reviewer
  Tester --> Reviewer
```

`Auditor` fans to 3 checks, dagre `nodesep 48` fans out.

## 6. Onboarding (Atlas sky — multi-session)

```mermaid
flowchart TD
  Atlas --> S_On1["Session: onboarding Tour A<br/>succeeded"]
  Atlas --> S_On2["Session: onboarding Lab B<br/>running"]
  Atlas --> S_On3["Session: onboarding Quiz C<br/>queued"]
  S_On1 --> Mediator --> Librarian --> Steward
  S_On2 --> Mediator --> Oracle --> Builder
  S_On3 --> Mediator
```

Illustrates `ADR-003` — `buildSocietyGraph` handles `sessions.length>1`, `StatusBadge` mixed colors.

## 7. Performance (loop back to Operator)

```mermaid
flowchart TD
  Atlas --> SP["Session: perf investigation<br/>succeeded"]
  SP --> Mediator --> Operator --> Debugger --> Builder --> Tester
  Tester -- "metrics fail" --> Operator
  Operator --> Reviewer
  Tester --> ToolP[/"tool: benchmark<br/>150ms"/]
  ToolP --> DecP{"decision: metrics ok?"}
  DecP --> Reviewer
```

Long-tail SSE, `bridge.gap` banner handling `dashboard/src/hooks/useEvents.ts:29`.

---

## Links
- Task breakdown: `docs/tasks/m4-live-dashboard.md:17`
- Architecture: `docs/architecture/README.md:148`
- Spec: `docs/spec/m3-task-api.md:51` `interaction/nextStep`
- ADR-002/003: `docs/adr/ADR-002*` `ADR-003*`
- Evidence sequences: `docs/sequence-diagrams-evidence.md:11` (time view complements this structural view)
