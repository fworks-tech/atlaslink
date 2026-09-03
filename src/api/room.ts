import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket, RawData } from 'ws'
import type { SessionBackend } from '../session/sessionBackend'
import type { Session as AggregateSession } from '../session/types'
import type { BridgeEnvelope } from '../bridge/EventLogStore'
import type { EventBroadcaster } from '../bridge/EventBroadcaster'
import type { EventLogStore } from '../bridge/EventLogStore'
import type { SessionQueue } from '../bridge/SessionQueue'
import type { TaskRegistry } from '../tasks/taskRegistry'
import { tenantBackendForRequest } from './tenant'
import { checkBearer } from './auth'
import { appendChatMessage, replyToParked, steerSession } from './sessionActions'

/**
 * WS room channel (Stage 5, ADR-007): one realtime room per session for
 * multi-human presence + fan-out + approval inbox. The store stays the
 * commit path — every ingress frame delegates to the same sessionActions the
 * HTTP routes use, so WS and POST cannot diverge. SSE remains the read-only
 * projection; the room adds what SSE cannot: presence, per-session resume,
 * and bidirectional ingress on one connection.
 *
 * Wire (JSON frames):
 *   server → client: joined | snapshot | backlog | gap | event | presence | ack | error
 *   client → server: chat | reply | steer  ({id?, content})
 */
export interface RoomDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  broadcaster: EventBroadcaster
  log: EventLogStore
}

/** Close codes (ws application range): auth, bad tenant, unknown session. */
export const ROOM_CLOSE_UNAUTHORIZED = 4401
export const ROOM_CLOSE_BAD_TENANT = 4400
export const ROOM_CLOSE_UNKNOWN_SESSION = 4404

/** Bounds: frames, names, backlog, and per-connection ingress rate. */
export const MAX_ROOM_FRAME_BYTES = 128 * 1024
export const MAX_ROOM_CONTENT_LENGTH = 10000
export const MAX_ROOM_NAME_LENGTH = 50
export const MAX_ROOM_BACKLOG_EVENTS = 200
export const MAX_ROOM_SNAPSHOT_TURNS = 50
export const MAX_ROOM_INGRESS_PER_MINUTE = 60

interface RoomMember {
  id: string
  name: string
  joinedAt: string
}

interface RoomClient {
  id: string
  socket: WebSocket
  name: string
  joinedAt: string
  send: (frame: Record<string, unknown>) => void
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'anonymous'
  // display-only: strip control chars, bound length, never trust it further
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean.length === 0 ? 'anonymous' : clean.slice(0, MAX_ROOM_NAME_LENGTH)
}

function firstQuery(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

export function registerRoomRoutes(app: FastifyInstance, deps: RoomDeps): void {
  const rooms = new Map<string, Map<string, RoomClient>>()
  // Registration-time capture: the upgrade check runs after harnesses (and
  // any env-scoping caller) restore the env, so ambient reads would miss it.
  const expectedToken = process.env.ATLASLINK_API_TOKEN

  const rosterOf = (sessionId: string): RoomMember[] =>
    [...(rooms.get(sessionId)?.values() ?? [])].map((c) => ({ id: c.id, name: c.name, joinedAt: c.joinedAt }))

  const broadcastPresence = (sessionId: string): void => {
    const frame = { type: 'presence', members: rosterOf(sessionId) }
    for (const client of rooms.get(sessionId)?.values() ?? []) client.send(frame)
  }

  // Roster read for clients that cannot hold a socket (the dashboard BFF
  // cannot proxy WS upgrades and the browser must never see the bearer):
  // same tenant scoping as the upgrade, no existence oracle — a wrong tenant
  // reads as unknown, and an empty room reads as an empty roster.
  app.get<{ Params: { id: string } }>(
    '/sessions/:id/room/members',
    async (request, reply) => {
      const query = (request.query ?? {}) as Record<string, unknown>
      const tenantValue = firstQuery(query.tenant) ?? request.headers['x-tenant-id']
      const tenantCtx = tenantBackendForRequest({ headers: { 'x-tenant-id': tenantValue } }, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const aggregate = await tenantCtx.backend.get(request.params.id)
      if (!aggregate || aggregate.tenantId !== tenantCtx.tenantId) {
        return reply.code(404).send({ ok: false, error: 'unknown session' })
      }
      return { ok: true, members: rosterOf(request.params.id) }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/sessions/:id/room',
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest<{ Params: { id: string } }>) => {
      void (async () => {
        const query = (request.query ?? {}) as Record<string, unknown>
        const sessionId = request.params.id

        // Browsers cannot set upgrade headers: same bearer via ?token=.
        // The preHandler gate may already have enforced the header — this
        // check is idempotent with it, never weaker.
        if (!checkBearer(request.headers.authorization, firstQuery(query.token), expectedToken)) {
          socket.close(ROOM_CLOSE_UNAUTHORIZED, 'unauthorized')
          return
        }
        const tenantValue = firstQuery(query.tenant) ?? request.headers['x-tenant-id']
        const tenantCtx = tenantBackendForRequest({ headers: { 'x-tenant-id': tenantValue } }, deps.backend)
        if (tenantCtx.error) {
          socket.close(ROOM_CLOSE_BAD_TENANT, tenantCtx.error)
          return
        }
        const backend = tenantCtx.backend
        const tenantId = tenantCtx.tenantId!
        const aggregate = await backend.get(sessionId)
        // no existence oracle across tenants: wrong tenant reads as unknown
        if (!aggregate || aggregate.tenantId !== tenantId) {
          try {
            socket.send(JSON.stringify({ type: 'error', error: 'unknown session' }))
          } catch {
            // closing anyway
          }
          socket.close(ROOM_CLOSE_UNKNOWN_SESSION, 'unknown session')
          return
        }

        const clientId = `cli-${randomUUID()}`
        const send = (frame: Record<string, unknown>): void => {
          try {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame))
          } catch {
            // slow/dead peer — best-effort; close handler cleans up
          }
        }
        const client: RoomClient = {
          id: clientId,
          socket,
          send,
          name: sanitizeName(firstQuery(query.name)),
          joinedAt: new Date().toISOString(),
        }
        let room = rooms.get(sessionId)
        if (!room) {
          room = new Map()
          rooms.set(sessionId, room)
        }
        room.set(clientId, client)

        // snapshot first: the joiner renders instantly without a refetch
        send({ type: 'joined', clientId, members: rosterOf(sessionId) })
        send({ type: 'snapshot', session: snapshotOf(aggregate) })

        // resume: replay what the client missed, or say it fell off retention
        const sinceRaw = firstQuery(query.since)
        if (sinceRaw !== undefined) {
          const since = Number.parseInt(sinceRaw, 10)
          if (Number.isNaN(since)) {
            // explicit over silent: the client can fix its cursor instead
            // of wondering why no backlog arrived
            send({ type: 'error', error: 'invalid since cursor' })
          } else {
            const oldest = deps.log.oldestId
            if (oldest !== undefined && since < oldest) {
              send({ type: 'gap', requested: since, oldest })
            } else {
              const missed = deps.log
                .replay(since)
                .map((stored) => stored.envelope)
                .filter((envelope) => roomFilter(envelope, sessionId, aggregate.correlationId))
                .slice(-MAX_ROOM_BACKLOG_EVENTS)
              send({ type: 'backlog', events: missed })
            }
          }
        }
        broadcastPresence(sessionId)

        const unsubscribe = deps.broadcaster.subscribe(
          (envelope) => {
            if (!roomFilter(envelope, sessionId, aggregate.correlationId)) return
            send({ type: 'event', event: envelope })
          },
          { replay: false }
        )

        // sliding-window ingress throttle: the service caps bound store
        // growth, this bounds per-connection CPU on the hot path
        const ingressAt: number[] = []
        const throttled = (): boolean => {
          const now = Date.now()
          while (ingressAt.length > 0 && ingressAt[0]! < now - 60_000) ingressAt.shift()
          if (ingressAt.length >= MAX_ROOM_INGRESS_PER_MINUTE) return true
          ingressAt.push(now)
          return false
        };

        socket.on('message', (data: RawData) => {
          void (async () => {
            const raw = data.toString()
            if (Buffer.byteLength(raw) > MAX_ROOM_FRAME_BYTES) {
              send({ type: 'error', error: 'frame too large' })
              return
            }
            let frame: { id?: unknown; type?: unknown; content?: unknown }
            try {
              frame = JSON.parse(raw) as typeof frame
            } catch {
              send({ type: 'error', error: 'malformed frame' })
              return
            }
            const id = typeof frame.id === 'string' ? frame.id : undefined
            if (frame.type !== 'chat' && frame.type !== 'reply' && frame.type !== 'steer') {
              send({ type: 'error', id, error: 'unknown frame type' })
              return
            }
            if (typeof frame.content !== 'string' || frame.content.length > MAX_ROOM_CONTENT_LENGTH) {
              send({ type: 'ack', id, ok: false, code: 400, error: 'content must be a string up to 10000 chars' })
              return
            }
            if (throttled()) {
              send({ type: 'ack', id, ok: false, code: 429, error: 'room ingress rate exceeded' })
              return
            }
            const ingress = { backend, registry: deps.registry, queue: deps.queue, broadcaster: deps.broadcaster }
            if (frame.type === 'chat') {
              const result = await appendChatMessage(ingress, sessionId, frame.content)
              send(result.code === 201
                ? { type: 'ack', id, ok: true, code: 201, status: result.session.status, version: result.session.version }
                : { type: 'ack', id, ok: false, code: result.code, error: result.error })
            } else if (frame.type === 'reply') {
              const result = await replyToParked(ingress, sessionId, tenantId, frame.content)
              send(result.code === 201
                ? { type: 'ack', id, ok: true, code: 201, status: result.session.status, version: result.session.version, resumedSessionId: result.followupId }
                : { type: 'ack', id, ok: false, code: result.code, error: result.error })
            } else {
              const result = await steerSession(ingress, sessionId, frame.content)
              send(result.code === 201
                ? { type: 'ack', id, ok: true, code: 201, status: result.session.status, version: result.session.version, interrupted: result.interrupted }
                : { type: 'ack', id, ok: false, code: result.code, error: result.error })
            }
          })()
        })

        socket.on('close', () => {
          unsubscribe()
          rooms.get(sessionId)?.delete(clientId)
          if (rooms.get(sessionId)?.size === 0) rooms.delete(sessionId)
          else broadcastPresence(sessionId)
        })
        socket.on('error', () => {
          // close handler owns cleanup; errors are just observed here
        })
      })()
    }
  )
}

/** Live + replay filter: this session's envelopes, plus its run events via correlation. */
export function roomFilter(envelope: BridgeEnvelope, sessionId: string, correlationId: string): boolean {
  const sessionMatch = (envelope as { sessionId?: unknown }).sessionId
  if (typeof sessionMatch === 'string') return sessionMatch === sessionId
  return (envelope as { correlationId?: unknown }).correlationId === correlationId
}

/** Join-time snapshot: bounded history head so the client renders instantly. */
export function snapshotOf(aggregate: AggregateSession): Record<string, unknown> {
  return {
    sessionId: aggregate.sessionId,
    status: aggregate.status,
    version: aggregate.version,
    member: aggregate.task.member,
    prompt: aggregate.task.prompt,
    ...(aggregate.projectId !== undefined ? { projectId: aggregate.projectId } : {}),
    interaction: aggregate.interaction.slice(-MAX_ROOM_SNAPSHOT_TURNS),
    nextStep: aggregate.nextStep,
    ...(aggregate.question !== undefined ? { question: aggregate.question } : {}),
    ...(aggregate.resumeOf !== undefined ? { resumeOf: aggregate.resumeOf } : {}),
  }
}
