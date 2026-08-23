import { EventLogStore, BridgeEnvelope } from './EventLogStore'

/**
 * EventBroadcaster fans out bridge events from an EventLogStore to registered
 * listeners. Envelopes pass verbatim (the read-only projection contract,
 * ADR-002): `type` is whatever the emitter assigned (e.g. `run.*`, `session.*`,
 * `bridge.*`) and is never rewritten.
 *
 * Responsibilities:
 *  1. emit(envelope) assigns a monotonic eventId, persists it, and delivers it
 *     verbatim to every subscriber.
 *  2. On subscribe() with replay, the most recent highWaterMark events are
 *     replayed so a fresh subscriber catches up with bounded memory (slow-client
 *     eviction drops the oldest).
 *  3. detectGap() reports the first missing eventId so a consumer can emit
 *     `bridge.gap` rather than silently skip.
 *  4. A throwing subscriber never breaks the broadcaster or its peers.
 */
export class EventBroadcaster {
  private readonly log: EventLogStore
  private readonly listeners: Set<(event: BridgeEnvelope) => void>
  private readonly highWaterMark: number
  private gap: number | null = null

  constructor(log: EventLogStore, options: { highWaterMark?: number } = {}) {
    this.log = log
    this.listeners = new Set()
    this.highWaterMark = options.highWaterMark ?? 1000
  }

  /**
   * Register a listener. By default replays recent events first so the
   * subscriber catches up; pass `{ replay: false }` for live delivery only.
   * Returns an unsubscribe function.
   */
  subscribe(listener: (event: BridgeEnvelope) => void, options: { replay?: boolean } = {}): () => void {
    this.listeners.add(listener)
    if (options.replay !== false) {
      const oldest = this.log.oldestId
      // Slow-client eviction: replay only the most recent highWaterMark events.
      const floor = Math.max(oldest ?? 0, this.log.nextEventId - this.highWaterMark)
      for (const stored of this.log.replay((oldest ?? 0) - 1)) {
        if (stored.eventId < floor) continue
        this.#deliver(stored.envelope)
      }
    }
    return () => this.listeners.delete(listener)
  }

  /** Assign a monotonic eventId, persist the envelope, and fan it out verbatim. */
  emit(envelope: BridgeEnvelope): void {
    const persisted = { ...envelope, eventId: this.log.nextEventId }
    this.log.append(persisted)
    this.#deliver(persisted)
  }

  /** All retained envelopes with `eventId >= startId`, ascending (Last-Event-ID resume). */
  replayFrom(startId: number): BridgeEnvelope[] {
    return this.log.replay(startId - 1).map((s) => s.envelope)
  }

  #deliver(envelope: BridgeEnvelope): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(envelope)
      } catch {
        // misbehaving subscriber never breaks the broadcaster or its peers
      }
    }
  }

  /**
   * Detect the first gap in the eventId sequence and return the missing id, or
   * null when contiguous (or too few events to judge).
   */
  detectGap(): number | null {
    const ids = this.log.replay(-1).map((e) => e.eventId).filter((id): id is number => Number.isInteger(id))
    if (ids.length < 2) return null
    for (let i = 1; i < ids.length; i++) {
      if (ids[i] !== ids[i - 1] + 1) {
        const missing = ids[i - 1] + 1
        if (this.gap === missing) continue
        this.gap = missing
        return missing
      }
    }
    return null
  }

  getGap(): number | null {
    return this.gap
  }
}

export default EventBroadcaster