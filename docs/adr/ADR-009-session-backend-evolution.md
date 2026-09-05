# ADR-009: Session Backend Evolution (LangGraph-Inspired)

**Date:** 2026-09-05
**Status:** Proposed
**Issue:** #184, #183, #182

---

## Context

LangGraph (41k GitHub stars) is a mature stateful agent orchestration framework with proven patterns for persistence, human-in-the-loop, and state management. Atlaslink shares the same core problem space — durable sessions, event sourcing, HITL — but evolved independently.

Analysis of LangGraph's architecture reveals five patterns we can adopt to improve Atlaslink's storage efficiency, API cleanliness, and production readiness:

1. **Delta channels** — O(1) per step instead of O(N) for append-heavy data
2. **Checkpoint conformance suite** — formal test contract for all backends
3. **Durability modes** — configurable persistence guarantees
4. **Interface standardization** — clean 5-method backend contract
5. **Pending writes** — intermediate state persistence for fault tolerance

## Decision

Implement LangGraph-inspired improvements in four phases, each building on the previous.

## Alternatives Considered

| Option | Why Considered | Why Rejected |
|--------|---------------|-------------|
| Fork LangGraph checkpoint library | Mature, well-tested | Python, different language; would add heavy dependency |
| Build from scratch without inspiration | Clean slate | Reinvents proven patterns |
| Adopt LangGraph directly | Feature-complete | Different architecture (graph-based vs session-based) |
| Phased adoption (chosen) | Incremental, testable | — |

## Consequences

**Positive:**
- Storage efficiency: Delta channels reduce checkpoint size from O(N) to O(1)
- Quality: Conformance suite catches backend regressions automatically
- Production readiness: Durability modes let operators choose consistency vs performance
- API cleanliness: Standardized interface makes adding new backends trivial

**Negative:**
- Migration cost: Existing backends need refactoring to match new interface
- Complexity: Delta channels add state reconstruction logic
- Testing burden: Conformance suite adds CI time

**Neutral:**
- Backward compatible: existing APIs continue to work during transition

## References

- [LangGraph Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)
- [LangGraph Delta Channels](https://docs.langchain.com/oss/python/langgraph/checkpointers#delta-channel-support)
- [LangGraph Durability Modes](https://docs.langchain.com/oss/python/langgraph/checkpointers#durability-modes)
