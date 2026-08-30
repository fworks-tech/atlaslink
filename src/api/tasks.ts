import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { SessionBackend, SessionFilter } from '../session/sessionBackend'
import type { Session as AggregateSession, SessionEvent } from '../session/types'
import { VersionConflictError } from '../session/types'
import type { SessionQueue } from '../bridge/SessionQueue'
import type { SseHandler } from '../bridge/sseEndpoint'
import type { TaskRegistry } from '../tasks/taskRegistry'
import { log } from '../log'

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
  projectId?: string
  tweaks?: { provider?: string; member?: Record<string, unknown>; team?: Record<string, unknown> }
}

/** Wire form of the store aggregate — same shape the spec §3 defines. */
export function sessionToWire(s: AggregateSession): AggregateSession {
  return s
}

/**
 * The M3 Task API on Fastify (spec §3): create + enqueue, list with
 * backend-applied filters, aggregate read, and queued-cancel. The pre-auth
 * bearer gate and rate limit are installed once in `createAppServer` on the
 * scope that owns /runs, /events, and these routes (spec §7) — this module
 * stays a declarative route list.
 */
export function registerTaskRoutes(app: FastifyInstance, deps: TaskDeps): void {
  app.post<{ Body: PostBody }>(
    '/tasks',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['member', 'prompt'],
          properties: {
            member: { type: 'string', minLength: 1 },
            prompt: { type: 'string', minLength: 1, maxLength: 10000 },
            projectId: { type: 'string', maxLength: 200 },
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
      const { member, prompt, projectId, tweaks } = request.body
      const sessionId = `ses-${randomUUID()}`
      const correlationId = `cor-${randomUUID()}`
      const event: SessionEvent = {
        type: 'session.created',
        sessionId,
        correlationId,
        at: new Date().toISOString(),
        member,
        prompt,
        ...(projectId !== undefined ? { projectId } : {}),
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
      log.info('task created', { sessionId, correlationId, member, projectId })
      const aggregate = await deps.backend.get(sessionId)
      return reply.code(201).send({ ok: true, session: sessionToWire(aggregate!) })
    }
  )

  app.get<{ Querystring: { projectId?: string; status?: string; since?: string; limit?: number; offset?: number } }>(
    '/tasks',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string' },
            status: { type: 'string', enum: ['queued', 'running', 'awaiting_input', 'succeeded', 'failed', 'cancelled'] },
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
        projectId: query.projectId ?? undefined,
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

  app.get<{ Params: { sessionId: string } }>('/tasks/:sessionId', async (request, reply) => {
    const aggregate = await deps.backend.get(request.params.sessionId)
    if (!aggregate) return reply.code(404).send({ ok: false, error: 'unknown session' })
    return reply.send({ ok: true, session: sessionToWire(aggregate) })
  })

  app.post<{ Params: { sessionId: string } }>('/tasks/:sessionId/cancel', async (request, reply) => {
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

  // Full DAG: Atlas asks follow-up in the latest card → user replies → diagram grows
  app.post<{ Params: { sessionId: string }; Body: { content: string } }>(
    '/tasks/:sessionId/reply',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const sessionId = request.params.sessionId
      const { content } = request.body
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await deps.backend.get(sessionId)
        if (!current) return reply.code(404).send({ ok: false, error: 'unknown session' })
        if (current.status !== 'awaiting_input') {
          if ((TERMINAL_STATUSES as readonly string[]).includes(current.status)) {
            return reply.code(409).send({ ok: false, error: 'session already terminated' })
          }
          return reply.code(409).send({ ok: false, error: 'session not awaiting input' })
        }
        try {
          await deps.backend.readModifyWrite(sessionId, current.version, () => [
            { type: 'session.user_reply', correlationId: current.correlationId, at: new Date().toISOString(), reply: content },
            // re-queue as running so the diagram keeps growing — next iteration
            { type: 'session.running', correlationId: current.correlationId, at: new Date().toISOString() },
          ])
          const after = await deps.backend.get(sessionId)
          // also fan out on SSE so live diagram updates without polling
          // (store is truth; SSE is best-effort projection)
          try {
            deps.sse.broadcaster.emit({ eventId: 0, type: 'session.user_reply', sessionId, correlationId: current.correlationId, at: new Date().toISOString(), reply: content } as unknown as { eventId: number; type: string } & Record<string, unknown>)
          } catch {}
          return reply.code(201).send({ ok: true, session: sessionToWire(after!) })
        } catch (err) {
          if (err instanceof VersionConflictError) continue
          throw err
        }
      }
      return reply.code(409).send({ ok: false, error: 'session state changed' })
    }
  )

  // Persist editor drag positions (ephemeral) — diagram is a projection, but user wins position
  app.post<{ Params: { sessionId: string }; Body: { diagram: { nodes: { id: string; type: string; position: { x: number; y: number } }[]; edges: { id: string; source: string; target: string }[]; mode: string } } }>(
    '/tasks/:sessionId/diagram',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['diagram'],
          properties: {
            diagram: {
              type: 'object',
              additionalProperties: false,
              required: ['nodes', 'edges', 'mode'],
              properties: {
                nodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
                edges: { type: 'array', items: { type: 'object', additionalProperties: true } },
                mode: { type: 'string', enum: ['chain', 'fanout', 'full'] },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const sessionId = request.params.sessionId
      const { diagram } = request.body
      const current = await deps.backend.get(sessionId)
      if (!current) return reply.code(404).send({ ok: false, error: 'unknown session' })
      // ephemeral: keep in memory on the backend instance; rehydrated sessions without diagram stay null
      // store in backend is event-sourced, so we piggyback on a non-persisted in-memory overlay via registry meta
      // for now we just echo; frontend localStorage is truth for drag until full persistence ships
      return reply.send({ ok: true, diagram })
    }
  )

  // Per-session SSE (spec §3/§4): replay-then-live for one session's events,
  // filtered by correlationId over the global bridge projection.
  app.get<{ Params: { sessionId: string } }>('/events/:sessionId', async (request, reply) => {
    const aggregate = await deps.backend.get(request.params.sessionId)
    if (!aggregate) return reply.code(404).send({ ok: false, error: 'unknown session' })
    reply.hijack()
    deps.sse.handleForSession(request.raw, reply.raw, aggregate.correlationId)
  })

  // Per-project SSE: replay-then-live for all sessions belonging to a project,
  // filtered by the set of correlation IDs for that project's sessions. The live
  // set grows on `session.created` for the same project so the stream is live.
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/events', async (request, reply) => {
    const project = await deps.backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    const { sessions } = await deps.backend.list({ projectId: request.params.projectId, limit: 500, offset: 0 })
    const correlationIds = new Set(sessions.map((s) => s.correlationId))
    reply.hijack()
    deps.sse.handleForProject(request.raw, reply.raw, request.params.projectId, correlationIds)
  })
}