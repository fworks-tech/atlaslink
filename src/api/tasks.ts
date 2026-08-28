import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { SessionBackend, SessionFilter } from '../session/sessionBackend'
import type { Session as AggregateSession, SessionEvent } from '../session/types'
import { VersionConflictError } from '../session/types'
import type { SessionQueue } from '../bridge/SessionQueue'
import type { SseHandler } from '../bridge/sseEndpoint'
import type { TaskRegistry } from '../tasks/taskRegistry'
import { log } from '../log'
import { registerTokenGate } from './auth'

export interface TaskDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
}

const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const

interface PostBody {
  member: string
  prompt: string
  tweaks?: { provider?: string; member?: Record<string, unknown>; team?: Record<string, unknown> }
}

/** Wire form of the store aggregate — same shape the spec §3 defines. */
export function sessionToWire(s: AggregateSession): AggregateSession {
  return s
}

/**
 * The M3 Task API on Fastify (spec §3): create + enqueue, list with
 * backend-applied filters, aggregate read, and queued-cancel. Registration is
 * encapsulated so the pre-auth token gate (spec §7) applies only to these
 * routes — never /health, /runs, or the global /events stream.
 */
export function registerTaskRoutes(app: FastifyInstance, deps: TaskDeps, opts?: { bindHost?: string }): void {
  app.register(async (scope) => {
    registerTokenGate(scope, { bindHost: opts?.bindHost })

    scope.post<{ Body: PostBody }>(
      '/tasks',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['member', 'prompt'],
            properties: {
              member: { type: 'string', minLength: 1 },
              prompt: { type: 'string', minLength: 1 },
              tweaks: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  provider: { type: 'string' },
                  member: { type: 'object' },
                  team: { type: 'object' },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const { member, prompt, tweaks } = request.body
        const sessionId = `ses-${randomUUID()}`
        const correlationId = `cor-${randomUUID()}`
        const event: SessionEvent = {
          type: 'session.created',
          sessionId,
          correlationId,
          at: new Date().toISOString(),
          member,
          prompt,
          ...(tweaks !== undefined ? { tweaks } : {}),
        }
        // the aggregate is committed first; the queue then runs by the same ids
        await deps.backend.append(event)
        const created = deps.registry.create({
          member,
          prompt,
          provider: tweaks?.provider,
          id: sessionId,
          correlationId,
        })
        deps.queue.declareSession(created)
        log.info('task created', { sessionId, correlationId, member })
        const aggregate = await deps.backend.get(sessionId)
        return reply.code(201).send({ ok: true, session: sessionToWire(aggregate!) })
      }
    )

    scope.get<{ Querystring: { status?: string; since?: string; limit?: number; offset?: number } }>(
      '/tasks',
      {
        schema: {
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] },
              since: { type: 'string' },
              limit: { type: 'integer', minimum: 1, maximum: 500 },
              offset: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      async (request, reply) => {
        const query = request.query
        if (query.since !== undefined && Number.isNaN(Date.parse(query.since))) {
          return reply.code(400).send({ ok: false, error: 'since must be an ISO-8601 date-time' })
        }
        const filter: SessionFilter = {
          status: (query.status as SessionFilter['status']) ?? undefined,
          since: query.since ?? undefined,
          limit: query.limit ?? 50,
          offset: query.offset ?? 0,
        }
        const { sessions, total } = await deps.backend.list(filter)
        return reply.send({
          ok: true,
          sessions: sessions.map(sessionToWire),
          total,
          limit: filter.limit,
          offset: filter.offset,
        })
      }
    )

    scope.get<{ Params: { sessionId: string } }>('/tasks/:sessionId', async (request, reply) => {
      const aggregate = await deps.backend.get(request.params.sessionId)
      if (!aggregate) return reply.code(404).send({ ok: false, error: 'unknown session' })
      return reply.send({ ok: true, session: sessionToWire(aggregate) })
    })

    scope.post<{ Params: { sessionId: string } }>('/tasks/:sessionId/cancel', async (request, reply) => {
      const sessionId = request.params.sessionId

      // Re-evaluate against a fresh aggregate until the state is stable: a
      // VersionConflictError means the lifecycle moved between our read and
      // write (the queue started the run) — resolve rather than 500.
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await deps.backend.get(sessionId)
        if (!current) return reply.code(404).send({ ok: false, error: 'unknown session' })
        if ((TERMINAL_STATUSES as readonly string[]).includes(current.status)) {
          return reply.code(409).send({ ok: false, error: 'session already terminated' })
        }
        if (current.status === 'running') {
          // M3 best-effort contract (spec §3): acknowledge now, cancel lands with the runtime
          return reply.code(202).send({ ok: true, status: 'running', cancel: 'best-effort', session: sessionToWire(current) })
        }
        try {
          await deps.backend.readModifyWrite(sessionId, current.version, () => [
            { type: 'session.cancelled', correlationId: current.correlationId, at: new Date().toISOString() },
          ])
          // dequeue from execution so the pump never runs a cancelled session
          try {
            deps.registry.cancel(sessionId)
          } catch {
            // the registry entry may already be gone or terminal — the store commit is the truth
          }
          const after = await deps.backend.get(sessionId)
          return reply.code(202).send({ ok: true, status: 'cancelled', session: sessionToWire(after!) })
        } catch (err) {
          if (err instanceof VersionConflictError) continue
          throw err
        }
      }
      return reply.code(409).send({ ok: false, error: 'session state changed' })
    })

    // Per-session SSE (spec §3/§4): replay-then-live for one session's events,
    // filtered by correlationId over the global bridge projection.
    scope.get<{ Params: { sessionId: string } }>('/events/:sessionId', async (request, reply) => {
      const aggregate = await deps.backend.get(request.params.sessionId)
      if (!aggregate) return reply.code(404).send({ ok: false, error: 'unknown session' })
      reply.hijack()
      deps.sse.handleForSession(request.raw, reply.raw, aggregate.correlationId)
    })
  })
}