import { appendFileSync, renameSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const ROTATION_FILES = 3
export const MAX_BYTES = 10 * 1024 * 1024
const TAIL_BASENAME = 'events.ndjson'
const SEQ_BASENAME = 'events.seq'

/**
 * Broadly-typed bridge envelope. The broadcaster assigns `eventId`; this branch
 * accepts an envelope that already carries one and persists it verbatim.
 */
export interface BridgeEnvelope {
  eventId: number
  type: string
  [key: string]: unknown
}

export interface EventLogStoreOptions {
  /** Rotation size cap in bytes; kept injectable so tests can force rotation. */
  maxBytes?: number
}

export interface StoredEnvelope {
  eventId: number
  envelope: BridgeEnvelope
}

/**
 * Append-only NDJSON event log at `dataDir/events.ndjson` with 10 MB × 3
 * rotation (`events.ndjson`, `.1`, `.2`, oldest dropped) per ADR-001.
 * The `eventId` cursor never resets: it is restored on open from the
 * `events.seq` sidecar, else by a boot-time tail scan, and rewritten to the
 * surviving cursor after every rotation. A corrupt tail line is skipped, and a
 * failed append is swallowed so the live stream never blocks on disk.
 */
export class EventLogStore {
  readonly dataDir: string
  readonly maxBytes: number
  #nextEventId = 0
  #tailBytes = 0

  private constructor(dataDir: string, maxBytes: number) {
    this.dataDir = dataDir
    this.maxBytes = maxBytes
  }

  static async open(dataDir: string, options: EventLogStoreOptions = {}): Promise<EventLogStore> {
    mkdirSync(dataDir, { recursive: true })
    const store = new EventLogStore(dataDir, options.maxBytes ?? MAX_BYTES)
    store.#restoreCursor()
    return store
  }

  /** Smallest retained eventId across all rotation files, or undefined when empty. */
  get oldestId(): number | undefined {
    let oldest: number | undefined
    for (const line of this.#readLines()) {
      const eventId = this.#parseId(line)
      if (eventId === undefined) continue
      if (oldest === undefined || eventId < oldest) oldest = eventId
    }
    return oldest
  }

  /** Next eventId the broadcaster should assign. Monotonic across restart + rotation. */
  get nextEventId(): number {
    return this.#nextEventId
  }

  append(envelope: BridgeEnvelope): void {
    if (!Number.isInteger(envelope.eventId) || envelope.eventId < 0) return
    this.#nextEventId = Math.max(this.#nextEventId, envelope.eventId + 1)
    const line = JSON.stringify(envelope) + '\n'
    this.#rotateIfNeeded(Buffer.byteLength(line, 'utf8'))
    try {
      appendFileSync(this.#path(0), line, 'utf8')
      this.#tailBytes += Buffer.byteLength(line, 'utf8')
    } catch {
      // swallow-write-failure: a slow/failed disk write never blocks the live stream
      console.warn(`EventLogStore: append of eventId ${envelope.eventId} failed, swallowed`)
    }
  }

  /**
   * All retained envelopes with `eventId > readAfter`, ascending, joined across
   * rotation files (`.1` oldest, `.2` next, current tail newest). Empty when
   * `readAfter` reaches the newest.
   */
  replay(readAfter: number): StoredEnvelope[] {
    const events: StoredEnvelope[] = []
    for (const line of this.#readLines()) {
      const stored = this.#parseLine(line)
      if (stored && stored.eventId > readAfter) events.push(stored)
    }
    return events
  }

  /**
   * Rotation cascade per ADR-001: when the tail would exceed the cap once the
   * incoming line lands, `.1` → `.2` (oldest dropped), tail → `.1`, then the
   * sidecar is rewritten to the surviving cursor. Runs before appending.
   */
  #rotateIfNeeded(incomingLen: number): void {
    if (!(this.#tailBytes > 0 && this.#tailBytes + incomingLen > this.maxBytes)) return
    try {
      if (existsSync(this.#path(1))) renameSync(this.#path(1), this.#path(2))
      if (existsSync(this.#path(0))) renameSync(this.#path(0), this.#path(1))
      this.#tailBytes = 0
      this.#writeSeq()
    } catch {
      // rotation must never break live streaming either; size state resets so a
      // persistent rename failure does not re-throw on every append
      console.warn('EventLogStore: rotation failed, swallowed')
      this.#tailBytes = 0
    }
  }

  /**
   * Restore the cursor from `events.seq` (present and parseable) reconciled
   * with a tail scan. The sidecar is a fast-restart hint written at rotation;
   * the scan is a correctness backstop so the counter never dips below — or
   * collides with — an eventId that is already stored on disk. Without a valid
   * sidecar the scan alone drives the resume.
   */
  #restoreCursor(): void {
    const seqPath = this.#pathSeq()
    let seqValue = -1
    if (existsSync(seqPath)) {
      const parsed = Number(readFileSync(seqPath, 'utf8').trim())
      if (Number.isInteger(parsed) && parsed >= 0) seqValue = parsed
    }
    const scanMax = this.#scanMaxEventId()
    this.#nextEventId = Math.max(seqValue, scanMax + 1)
    if (this.#nextEventId < 0) this.#nextEventId = 0
    if (existsSync(this.#path(0))) {
      try {
        this.#tailBytes = Buffer.byteLength(readFileSync(this.#path(0), 'utf8'), 'utf8')
      } catch {
        this.#tailBytes = 0
      }
    }
  }

  #scanMaxEventId(): number {
    let max = -1
    for (const line of this.#readLines()) {
      const eventId = this.#parseId(line)
      if (eventId !== undefined && eventId > max) max = eventId
    }
    return max
  }

  #writeSeq(): void {
    try {
      appendFileSync(this.#pathSeq(), String(this.#nextEventId) + '\n', 'utf8')
    } catch {
      // a failed sidecar write is non-fatal; a subsequent rotation retries it
    }
  }

  #parseId(line: string): number | undefined {
    try {
      const parsed = JSON.parse(line) as { eventId?: unknown }
      return typeof parsed.eventId === 'number' && Number.isInteger(parsed.eventId) ? parsed.eventId : undefined
    } catch {
      return undefined
    }
  }

  #parseLine(line: string): StoredEnvelope | undefined {
    try {
      const id = this.#parseId(line)
      if (id === undefined) return undefined
      return { eventId: id, envelope: JSON.parse(line) as BridgeEnvelope }
    } catch {
      return undefined
    }
  }

  /** Reads rotation files oldest → newest so replay order matches emission order. */
  #readLines(): string[] {
    const lines: string[] = []
    for (let i = ROTATION_FILES - 1; i >= 0; i--) {
      if (!existsSync(this.#path(i))) continue
      try {
        lines.push(...readFileSync(this.#path(i), 'utf8').split(/\r?\n/).filter((line) => line.length > 0))
      } catch {
        // an unreadable/corrupt rotation file is skipped — corrupt-tail tolerance
      }
    }
    return lines
  }

  #path(index: number): string {
    return index === 0 ? join(this.dataDir, TAIL_BASENAME) : join(this.dataDir, `${TAIL_BASENAME}.${index}`)
  }

  #pathSeq(): string {
    return join(this.dataDir, SEQ_BASENAME)
  }
}