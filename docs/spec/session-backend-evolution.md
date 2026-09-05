# Session Backend Evolution — Implementation Plan

**ADR:** [ADR-009: Session Backend Evolution](../adr/ADR-009-session-backend-evolution.md)
**Status:** Proposed
**Date:** 2026-09-05

---

## Phase 1: Interface Standardization + Conformance Suite

**Goal:** Clean backend contract, shared test suite for all backends.

### 1.1 Standardize `SessionBackend` Interface

Align with LangGraph's 5-method pattern:

```typescript
interface SessionBackend {
  // Core persistence
  put(config: SessionConfig, session: Session, metadata: SessionMetadata): Promise<SessionConfig>
  putWrites(config: SessionConfig, writes: PendingWrite[], taskId: string): Promise<void>
  getTuple(config: SessionConfig): Promise<SessionTuple | null>
  list(config: SessionConfig, opts?: ListOpts): AsyncGenerator<SessionTuple>
  deleteSession(sessionId: string): Promise<void>
}

interface SessionConfig {
  sessionId: string
  checkpointId?: string  // optional: specific checkpoint or latest
}

interface SessionTuple {
  config: SessionConfig
  session: Session
  metadata: SessionMetadata
  parentConfig: SessionConfig | null
  pendingWrites: PendingWrite[]
}

interface PendingWrite {
  taskId: string
  channel: string
  value: unknown
}
```

### 1.2 Create `SessionBackendConformance` Test Suite

Shared test suite all backends must pass:

```typescript
// src/session/conformance.test.ts
import { SessionBackendConformance } from './conformance'

// Test in-memory backend
SessionBackendConformance('SessionStore', () => new SessionStore())

// Test Postgres backend
SessionBackendConformance('PostgresBackend', () => createTestPostgresBackend())
```

**Test coverage:**
- `put` / `getTuple` round-trip
- `putWrites` / `getTuple` pending writes
- `list` ordering (newest first)
- `deleteSession` cleanup
- Concurrent writes
- Large sessions (1000+ events)
- Checkpoint ID generation

### 1.3 Refactor Existing Backends

- `SessionStore` — adapt to new interface
- `EventLogBackend` — adapt to new interface
- `PostgresBackend` — adapt to new interface

**Estimated effort:** 2-3 days
**Files changed:** `src/session/types.ts`, `src/session/conformance.test.ts`, `src/session/*.test.ts`

---

## Phase 2: Delta Channels (Storage Optimization)

**Goal:** O(1) per step instead of O(N) for append-heavy data.

### 2.1 Implement `DeltaChannel`

For append-heavy channels (like `events`), store only the delta instead of the full accumulated value:

```typescript
class DeltaChannel<T> {
  // Store only the latest snapshot + pending writes
  // Reconstruct by replaying ancestor writes
  fromCheckpoint(seed?: T): T
  replayWrites(writes: PendingWrite[]): T
}
```

### 2.2 Add `getDeltaChannelHistory` to Backend

```typescript
interface SessionBackend {
  // ... existing methods ...
  getDeltaChannelHistory(config: SessionConfig, channels: string[]): Promise<DeltaChannelHistory>
}

interface DeltaChannelHistory {
  writes: PendingWrite[]
  seed?: unknown  // nearest ancestor snapshot
}
```

### 2.3 Optimize Event Storage

- Store full snapshot every N steps (configurable)
- Store deltas between snapshots
- Reconstruct state by replaying deltas from nearest snapshot

**Estimated effort:** 3-5 days
**Files changed:** `src/session/deltaChannel.ts`, `src/session/types.ts`, backend implementations

---

## Phase 3: Durability Modes

**Goal:** Configurable persistence guarantees for production.

### 3.1 Define Durability Modes

```typescript
type DurabilityMode = 'exit' | 'async' | 'sync'

interface SessionBackendConfig {
  durability: DurabilityMode  // default: 'sync'
}
```

**Mode behavior:**
- `exit` — persist only on session exit (best performance, no mid-execution recovery)
- `async` — persist asynchronously while next step executes (good balance)
- `sync` — persist synchronously before next step starts (highest durability)

### 3.2 Implement in PostgresBackend

```typescript
class PostgresBackend implements SessionBackend {
  async putWrites(config, writes, taskId) {
    switch (this.config.durability) {
      case 'exit':
        // Buffer writes, flush on session exit
        this.pendingWrites.set(config.sessionId, writes)
        break
      case 'async':
        // Fire-and-forget, don't await
        this.db.insertWrites(writes).catch(console.error)
        break
      case 'sync':
        // Await persistence before returning
        await this.db.insertWrites(writes)
        break
    }
  }
}
```

### 3.3 Add Configuration to Server

```typescript
// src/server.ts
const backend = new PostgresBackend(db, {
  durability: process.env.ATLASLINK_DURABILITY_MODE as DurabilityMode || 'sync'
})
```

**Estimated effort:** 2-3 days
**Files changed:** `src/session/postgresBackend.ts`, `src/session/types.ts`, `src/server.ts`

---

## Phase 4: Pending Writes (Fault Tolerance)

**Goal:** Intermediate state persistence for fault tolerance.

### 4.1 Implement Pending Writes

When a session node fails mid-execution, store pending writes from successful nodes:

```typescript
interface SessionBackend {
  // ... existing methods ...
  putWrites(config: SessionConfig, writes: PendingWrite[], taskId: string): Promise<void>
}
```

### 4.2 Recovery Logic

On resume, check for pending writes and don't re-run successful nodes:

```typescript
async function resumeSession(backend: SessionBackend, config: SessionConfig) {
  const tuple = await backend.getTuple(config)
  if (tuple?.pendingWrites.length) {
    // Apply pending writes without re-executing nodes
    for (const write of tuple.pendingWrites) {
      applyWrite(write)
    }
  }
  // Continue from next node
}
```

### 4.3 Integrate with Event Sourcing

Map pending writes to session events:

```typescript
// Pending writes become events
const events = pendingWrites.map(write => ({
  type: write.channel,
  data: write.value,
  taskId: write.taskId,
  pending: true  // mark as pending until confirmed
}))
```

**Estimated effort:** 3-4 days
**Files changed:** `src/session/types.ts`, backend implementations, `src/daemon/`

---

## Testing Strategy

Each phase includes:
1. **Unit tests** for new code
2. **Conformance tests** for backend compliance
3. **Integration tests** for end-to-end flows
4. **Performance benchmarks** for storage optimization

## Rollout

- Phase 1: Non-breaking, existing code continues to work
- Phase 2: New feature, opt-in via configuration
- Phase 3: New feature, opt-in via environment variable
- Phase 4: New feature, integrated with existing event sourcing

## Success Criteria

- [ ] All backends pass conformance suite
- [ ] Delta channels reduce storage by 50%+ for long sessions
- [ ] Durability modes configurable via environment
- [ ] Pending writes enable session recovery without re-execution
- [ ] No breaking changes to existing API
