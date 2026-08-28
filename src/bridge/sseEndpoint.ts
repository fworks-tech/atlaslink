import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventLogStore, BridgeEnvelope } from './EventLogStore'
import { EventBroadcaster } from './EventBroadcaster'

export const PING_INTERVAL_MS = 15000

/**
 * Serialize a bridge envelope as a Server-Sent Events frame per spec §4.
 * `run.*`, `session.*`, and `bridge.*` types pass verbatim; the emitter owns
 * `type`, and this endpoint never rewrites it (read-only projection contract).
 */
export function formatSse(envelope: BridgeEnvelope): string {
  const lines = [`id: ${envelope.eventId}`, `event: ${envelope.type}`, `data: ${JSON.stringify(envelope)}`]
  return lines.join('\n') + '\n\n'
}

/** An active SSE client connection tracked for shutdown. */
interface SseClient {
  res: ServerResponse
}

/**
 * `GET /events` Server-Sent Events handler. Replays events after Last-Event-ID
 * when provided (else live-tail only), then pushes live events verbatim. A stale
 * resume (`requested < oldestId`) is surfaced as `bridge.gap`, never silence.
 * Tracks open connections so a SIGINT/SIGTERM can send `bridge.shutdown` before
 * ending the stream, and pings idle connections to keep them alive.
 */
export class SseHandler {
  private readonly log: EventLogStore
  readonly broadcaster: EventBroadcaster
  private readonly clients = new Set<SseClient>()
  private readonly ping: ReturnType<typeof setInterval>

  constructor(log: EventLogStore, broadcaster: EventBroadcaster) {
    this.log = log
    this.broadcaster = broadcaster
    // `:ping` comment frame every PING_INTERVAL_MS keeps idle streams alive
    this.ping = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.res.write(': ping\n\n')
        } catch {
          /* a closing socket is reclaimed on its res 'close' event */
        }
      }
    }, PING_INTERVAL_MS)
    this.ping.unref()
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    this.#handle(req, res)
  }

  /**
   * Per-session variant (spec §3): replay-then-live limited to one session's
   * events by `correlationId`. Uses the same wire contract — Last-Event-ID
   * resume, ping, gap, shutdown — filtered at the projection boundary.
   */
  handleForSession(req: IncomingMessage, res: ServerResponse, correlationId: string): void {
    this.#handle(req, res, (envelope) => envelope.correlationId === correlationId)
  }

  #handle(req: IncomingMessage, res: ServerResponse, filter?: (envelope: BridgeEnvelope) => boolean): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const lastIdRaw = req.headers['last-event-id']
    const lastId = typeof lastIdRaw === 'string' ? parseInt(lastIdRaw, 10) : NaN

    if (!Number.isNaN(lastId)) {
      const oldest = this.log.oldestId
      if (oldest !== undefined && lastId < oldest) {
        // requested event fallen off the retention window → bridge.gap, never silence
        this.#frame(res, {
          eventId: lastId,
          type: 'bridge.gap',
          requested: lastId,
          oldest,
          at: new Date().toISOString(),
        })
      } else {
        for (const stored of this.log.replay(lastId)) {
          if (filter !== undefined && !filter(stored.envelope)) continue
          this.#frame(res, stored.envelope)
        }
      }
    }

    const unsubscribe = this.broadcaster.subscribe(
      (envelope) => {
        if (filter !== undefined && !filter(envelope)) return
        this.#frame(res, envelope)
      },
      { replay: false },
    )

    const client: SseClient = { res }
    this.clients.add(client)
    const onClose = (): void => {
      unsubscribe()
      this.clients.delete(client)
      res.removeListener('close', onClose)
    }
    res.on('close', onClose)

    // initial comment establishes the event-stream framing per spec §4
    res.write(': keep-alive\n\n')
  }

  /**
   * Graceful shutdown: send `bridge.shutdown` to every open client and end the
   * stream so a controlled stop is distinguishable from a network blip.
   */
  shutdown(): void {
    for (const client of this.clients) {
      try {
        client.res.write(`event: bridge.shutdown\ndata: {}\n\n`)
        client.res.end()
      } catch {
        /* already closed */
      }
    }
    this.clients.clear()
    clearInterval(this.ping)
  }

  #frame(res: ServerResponse, envelope: BridgeEnvelope): void {
    try {
      res.write(formatSse(envelope))
    } catch {
      /* write errors surface via res 'close'; normal for a disconnected client */
    }
  }
}