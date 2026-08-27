# src/daemon — the run-execution glue

The one-shot execution path: nothing here touches the wire. It builds the
Agenthood runtime pieces a single run needs and reports the outcome back through
the registry.

## Modules

| File | Responsibility |
|------|----------------|
| `contextFactory.ts` | `validateConfig` (fails fast at boot when a provider key is missing) and `createContext` — an `ApplicationContext` built **lazily per run**, because `ApplicationContext.create` connects the vector store and touches the LLM (pattern re-index). |
| `runTask.ts` | `runSession`: creates the context, subscribes to the run's `RunEventBus`, invokes the member, and finalizes the session from the real outcome (`runMemberTask` throws on failure, so status is never guessed). Injectable `createApp` keeps it hermetic in tests. |

## Invariants

- **Lazy context creation:** never at boot; only when a task actually runs.
- **Terminal-from-registry:** the session's final status comes from the runtime's
  outcome, never from a heuristic.
- **Untouched by the M3/multi-account refactor:** `runTask.ts` and
  `taskRegistry.ts` are a cross-branch invariant — the HTTP layer drives them only
  through `SessionQueue` (ADR-002 read-only contract).