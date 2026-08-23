import { EventLogStore, BridgeEnvelope } from './EventLogStore'

/**
 * EventBroadcaster fans out bridge events from an EventLogStore to registered
 * listeners.  It does not couple tightly to the log's internals; instead:
 *
 *  1. After log.append(envelope), call broadcaster.emit(envelope) to notify
 *     all subscribers.
 *  2. On first subscribe(), replay recent events so the subscriber catches up.
 *  3. detectGap() reports any missing eventId in the current store.
 *  4. highWaterMark controls how many events are retained for replay.
 */
export class EventBroadcaster {
  private readonly log: EventLogStore
  private readonly listeners: Set<(event: unknown) => void>
  private readonly highWaterMark: number
  private gap: number | null = null

  constructor(log: EventLogStore, options: { highWaterMark?: number } = {}) {
    this.log = log
    this.listeners = new Set()
    this.highWaterMark = options.highWaterMark ?? 1000
  }

  /** Register a listener that receives every newly appended bridge event. */
  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener)
    // Replay recent events so the subscriber catches up
    this.#replayFrom(this.log.oldestId ?? 1)
    return () => this.listeners.delete(listener)
  }

  /** Emit a bridge envelope to all registered listeners. */
  emit(envelope: BridgeEnvelope): void {
    const { type: _type, ...envelopeWithoutType } = envelope
    const event: unknown = {
      type: 'bridge',
      executionId: String(envelope.eventId),
      member: 'bridge',
      correlationId: String(envelope.eventId),
      timestamp: new Date().toISOString(),
      ...envelopeWithoutType,
    }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // misbehaving subscriber never breaks the broadcaster
      }
    }
  }

  /** Replay events starting from the given eventId (inclusive). */
  #replayFrom(startId: number): void {
    const stored = this.log.replay(startId - 1)
    for (const s of stored) {
      const { type: _type, ...envelopeWithoutType } = s.envelope
      const event: unknown = {
        type: 'bridge',
        executionId: String(s.eventId),
        member: 'bridge',
        correlationId: String(s.eventId),
        timestamp: new Date().toISOString(),
        ...envelopeWithoutType,
      }
      for (const listener of this.listeners) {
        try {
          listener(event)
        } catch {
          // misbehaving subscriber never breaks the broadcaster
        }
      }
    }
  }

   /** Detect a gap in the eventId sequence and return the missing id, or null. */
  detectGap(): number | null {
    const replay = this.log.replay(-1)
    const ids = replay.map((e) => e.eventId).filter((id): id is number => Number.isInteger(id))
    if (ids.length < 2) return null
    for (let i = 1; i < ids.length; i++) {
      if (ids[i] !== ids[i - 1] + 1) {
        const missing = ids[i - 1] + 1
        if (this.gap === null || missing !== this.gap) {
          this.gap = missing
          return missing
        }
      }
    }
    return null
  }

  getGap(): number | null {
    return this.gap
  }
}

export default EventBroadcaster