import { BridgeEnvelope } from './EventLogStore'
import { EventBroadcaster } from './EventBroadcaster'
import { SessionStatus } from '../tasks/taskRegistry'

/**
 * SessionQueue is the serial worker behind the bridge (ADR-003: Atlas holds
 * the sky of sessions). Sessions are processed strictly one at a time; the
 * injected runner keeps it hermetic in tests. Every lifecycle
 * transition is mirrored to the wire as a namespaced `session.*` event so M4 can
 * render queued sessions that the RunEventBus (which has no "queued" state and
 * emits nothing for a fail-before-any-event run) cannot represent. The terminal
 * status comes from the registry after the run, never guessed (spec §5,
 * "terminal-from-registry").
 *
 * Lanes (M5 HITL): the pump drains two FIFO lanes. Interactive sessions —
 * human-blocked work resumed by a reply or redirected by a steer, where a
 * human is actively waiting — jump ahead of standard sessions, but a fairness
 * bound caps consecutive interactive runs at MAX_CONSECUTIVE_INTERACTIVE so a
 * flood of chatty sessions cannot starve the standard lane. Skipped
 * (cancelled) sessions consume no worker time and neither advance nor reset
 * the bound.
 *
 * Event shapes (spec §4):
 *   session.queued    — {eventId, type, sessionId, correlationId, member, status, at}
 *   session.started   — same, status 'running'
 *   session.succeeded — same, status 'succeeded'
 *   session.failed    — same, status 'failed'
 *   session.parked    — same, status 'parked' (slot released, run awaiting human)
 *   session.cancelled — same, status 'cancelled' (slot released, run interrupted)

/** Fairness bound: at most this many interactive runs before a waiting standard session is served. */
export const MAX_CONSECUTIVE_INTERACTIVE = 3

export type SessionLane = 'standard' | 'interactive'

export class SessionQueue {
  private readonly broadcaster: EventBroadcaster
  private readonly runner: (sessionId: string) => Promise<void>
  private readonly registry: { get(id: string): SessionSnapshot | undefined }
  private readonly standard: string[] = []
  private readonly interactive: string[] = []
  private consecutiveInteractive = 0
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

  /**
   * Enqueue a session. Emits session.queued and starts processing if idle.
   * New work defaults to the standard lane; resumed/steered sessions where a
   * human is waiting use the interactive lane.
   */
  declareSession(session: Omit<SessionSnapshot, 'status'>, opts?: { lane?: SessionLane }): void {
    const enriched: SessionSnapshot = { ...session, status: SessionStatus.QUEUED }
    this.#emit('session.queued', session.id, enriched, SessionStatus.QUEUED)
    if (opts?.lane === 'interactive') {
      this.interactive.push(session.id)
    } else {
      this.standard.push(session.id)
    }
    void this.#pump()
  }

  /** Process queued sessions one at a time: interactive first, within the fairness bound. */
  async #pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const next = this.#next()
        if (next === undefined) {
          // drained: the "consecutive" in the fairness bound ends here, so a
          // later burst starts unbiased instead of yielding on stale debt
          this.consecutiveInteractive = 0
          return
        }
        const started = this.registry.get(next.id)
        // a cancelled queued session is skipped, never run (spec §3 guarantee)
        if (!started || started.status === SessionStatus.CANCELLED) continue
        // skipped sessions consume no worker time, so only runs account the bound
        this.consecutiveInteractive = next.lane === 'interactive' ? this.consecutiveInteractive + 1 : 0
        const sessionId = next.id
        this.#emit('session.started', sessionId, started, SessionStatus.RUNNING)
        await this.runner(sessionId)
        const final = this.registry.get(sessionId)
        if (!final) continue
        if (final.status === SessionStatus.SUCCEEDED) {
          this.#emit('session.succeeded', sessionId, final, SessionStatus.SUCCEEDED)
        } else if (final.status === SessionStatus.FAILED) {
          this.#emit('session.failed', sessionId, final, SessionStatus.FAILED)
        } else if (final.status === SessionStatus.PARKED) {
          // a parked run releases its slot without a terminal registry state —
          // close the started event so queue watchers never see it running-forever
          this.#emit('session.parked', sessionId, final, SessionStatus.PARKED)
        } else if (final.status === SessionStatus.CANCELLED) {
          // a steered/interrupted run finalized CANCELLED by the abort race —
          // same slot-release close-out as a park
          this.#emit('session.cancelled', sessionId, final, SessionStatus.CANCELLED)
        }
      }
    } finally {
      this.running = false
    }
  }

  /**
   * Pick the next session id. Interactive first while the fairness bound
   * holds; otherwise the head of the standard lane.
   */
  #next(): { id: string; lane: SessionLane } | undefined {
    if (
      this.interactive.length > 0 &&
      (this.standard.length === 0 || this.consecutiveInteractive < MAX_CONSECUTIVE_INTERACTIVE)
    ) {
      return { id: this.interactive.shift()!, lane: 'interactive' }
    }
    const id = this.standard.shift()
    return id === undefined ? undefined : { id, lane: 'standard' }
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

  /** Number of sessions still queued but not yet started, across both lanes. */
  get pending(): number {
    return this.standard.length + this.interactive.length
  }

  /** Queued-but-not-started counts per lane (observability for the Stage 5 dashboard). */
  get pendingByLane(): { standard: number; interactive: number } {
    return { standard: this.standard.length, interactive: this.interactive.length }
  }
}

export interface SessionSnapshot {
  id: string
  correlationId: string
  task: { member: string }
  status: string
}

export default SessionQueue