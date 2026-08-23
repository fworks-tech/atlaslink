import { BridgeEnvelope } from './EventLogStore'
import { EventBroadcaster } from './EventBroadcaster'
import { SessionStatus } from '../tasks/taskRegistry'

/**
 * SessionQueue is the serial FIFO worker behind the bridge (ADR-003: Atlas holds
 * the sky of sessions). Sessions are processed strictly one at a time in enqueue
 * order; the injected runner keeps it hermetic in tests. Every lifecycle
 * transition is mirrored to the wire as a namespaced `session.*` event so M4 can
 * render queued sessions that the RunEventBus (which has no "queued" state and
 * emits nothing for a fail-before-any-event run) cannot represent. The terminal
 * status comes from the registry after the run, never guessed (spec §5,
 * "terminal-from-registry").
 *
 * Event shapes (spec §4):
 *   session.queued    — {eventId, type, sessionId, correlationId, member, status, at}
 *   session.started   — same, status 'running'
 *   session.succeeded — same, status 'succeeded'
 *   session.failed    — same, status 'failed'
 */
export class SessionQueue {
  private readonly broadcaster: EventBroadcaster
  private readonly runner: (sessionId: string) => Promise<void>
  private readonly registry: { get(id: string): SessionSnapshot | undefined }
  private readonly queue: string[] = []
  private running = false

  constructor(params: {
    broadcaster: EventBroadcaster
    runner: (sessionId: string) => Promise<void>
    registry: { get(id: string): SessionSnapshot | undefined }
  }) {
    this.broadcaster = params.broadcaster
    this.runner = params.runner
    this.registry = params.registry
  }

  /** Enqueue a session. Emits session.queued and starts processing if idle. */
  declareSession(session: Omit<SessionSnapshot, 'status'>): void {
    const enriched: SessionSnapshot = { ...session, status: SessionStatus.QUEUED }
    this.#emit('session.queued', session.id, enriched, SessionStatus.QUEUED)
    this.queue.push(session.id)
    void this.#pump()
  }

  /** Process queued sessions in FIFO order, strictly one at a time. */
  async #pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const sessionId = this.queue.shift()!
        const started = this.registry.get(sessionId)
        if (!started) continue
        this.#emit('session.started', sessionId, started, SessionStatus.RUNNING)
        await this.runner(sessionId)
        const final = this.registry.get(sessionId)
        if (!final) continue
        if (final.status === SessionStatus.SUCCEEDED) {
          this.#emit('session.succeeded', sessionId, final, SessionStatus.SUCCEEDED)
        } else if (final.status === SessionStatus.FAILED) {
          this.#emit('session.failed', sessionId, final, SessionStatus.FAILED)
        }
      }
    } finally {
      this.running = false
    }
  }

  #emit(type: string, sessionId: string, session: SessionSnapshot, status: string): void {
    const envelope: BridgeEnvelope = {
      eventId: 0, // assigned by the broadcaster
      type,
      sessionId,
      correlationId: session.correlationId,
      member: session.task.member,
      status,
      at: new Date().toISOString(),
    }
    this.broadcaster.emit(envelope)
  }

  /** Number of sessions still queued but not yet started. */
  get pending(): number {
    return this.queue.length
  }
}

export interface SessionSnapshot {
  id: string
  correlationId: string
  task: { member: string }
  status: string
}

export default SessionQueue