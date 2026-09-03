import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { SessionBackend, SessionFilter } from '../session/sessionBackend'
import type { Session as AggregateSession, SessionEvent } from '../session/types'
import { VersionConflictError } from '../session/types'
import type { SessionQueue } from '../bridge/SessionQueue'
import type { SseHandler } from '../bridge/sseEndpoint'
import type { TaskRegistry } from '../tasks/taskRegistry'
import { tenantBackendForRequest } from './tenant'
import { appendChatMessage, isTerminal, replyToParked, steerSession } from './sessionActions'
import { log } from '../log'

export interface TaskDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
}

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
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const tenantId = tenantCtx.tenantId!
      const backend = tenantCtx.backend
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
        tenantId,
        ...(projectId !== undefined ? { projectId } : {}),
        ...(tweaks !== undefined ? { tweaks } : {}),
      }
      // the aggregate is committed first; the queue then runs by the same ids
      await backend.append(event)
      const created = deps.registry.create({
        member,
        prompt,
        provider: tweaks?.provider,
        id: sessionId,
        correlationId,
      })
      deps.queue.declareSession(created)
      log.info('task created', { sessionId, correlationId, member, projectId, tenantId })
      const aggregate = await backend.get(sessionId)
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
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const tenantId = tenantCtx.tenantId!
      const backend = tenantCtx.backend
      const query = request.query
      if (query.since !== undefined && Number.isNaN(Date.parse(query.since))) {
        return reply.code(400).send({ ok: false, error: 'since must be an ISO-8601 date-time' })
      }
      const filter: SessionFilter = {
        projectId: query.projectId ?? undefined,
        tenantId,
        status: (query.status as SessionFilter['status']) ?? undefined,
        since: query.since ?? undefined,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      }
      const { sessions, total } = await backend.list(filter)
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
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const aggregate = await tenantCtx.backend.get(request.params.sessionId)
    if (!aggregate) return reply.code(404).send({ ok: false, error: 'unknown session' })
    return reply.send({ ok: true, session: sessionToWire(aggregate) })
  })

  app.post<{ Params: { sessionId: string } }>('/tasks/:sessionId/cancel', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const backend = tenantCtx.backend
    const sessionId = request.params.sessionId

    // Re-evaluate against a fresh aggregate until the state is stable: a
    // VersionConflictError means the lifecycle moved between our read and
    // write (the queue started the run) — resolve rather than 500.
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await backend.get(sessionId)
      if (!current) return reply.code(404).send({ ok: false, error: 'unknown session' })
      if (isTerminal(current.status)) {
        return reply.code(409).send({ ok: false, error: 'session already terminated' })
      }
      if (current.status === 'running') {
        // M3 best-effort contract (spec §3): acknowledge now, cancel lands with the runtime.
        // M5: the abort is real — runSession races the in-flight call against
        // the session controller and finalizes CANCELLED + mirrors it, so the
        // 202 only means "finalization is async", not "maybe".
        try {
          deps.registry.abort(sessionId)
        } catch {
          // no live run tracked — the ack below still holds; a concurrent
          // finalize owns the outcome
        }
        return reply.code(202).send({ ok: true, status: 'running', cancel: 'best-effort', session: sessionToWire(current) })
      }
      try {
        await backend.readModifyWrite(sessionId, current.version, () => [
          { type: 'session.cancelled', correlationId: current.correlationId, at: new Date().toISOString() },
        ])
        // dequeue from execution so the pump never runs a cancelled session
        try {
          deps.registry.cancel(sessionId)
        } catch {
          // the registry entry may already be gone or terminal — the store commit is the truth
        }
        const after = await backend.get(sessionId)
        if (!after) return reply.code(404).send({ ok: false, error: 'unknown session' })
        // the store commit is truth, but live subscribers (dashboard thread,
        // queue watchers) only move on SSE — fan out like every other route
        try {
          deps.sse.broadcaster.emit({
            eventId: after.version,
            type: 'session.cancelled',
            sessionId,
            correlationId: current.correlationId,
            at: new Date().toISOString(),
          })
        } catch {
          // best-effort; store is truth
        }
        return reply.code(202).send({ ok: true, status: 'cancelled', session: sessionToWire(after) })
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
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const backend = tenantCtx.backend
      const tenantId = tenantCtx.tenantId!
      const sessionId = request.params.sessionId
      // shared with the WS room channel — the route only adapts codes to HTTP
      const result = await replyToParked(
        { backend, registry: deps.registry, queue: deps.queue, broadcaster: deps.sse.broadcaster },
        sessionId,
        tenantId,
        request.body.content
      )
      if (result.code !== 201) return reply.code(result.code).send({ ok: false, error: result.error })
      const followup = await backend.get(result.followupId)
      if (!followup) return reply.code(404).send({ ok: false, error: 'unknown session' })
      return reply.code(201).send({ ok: true, session: sessionToWire(result.session), resumedSession: sessionToWire(followup) })
    }
  )

  // Human steer / interrupt: queued → the mission is rewritten before the run
  // starts (registry reprompt + CAS session.steer, rollback on CAS failure);
  // running → the new direction is recorded as session.user_reply and the
  // in-flight run is aborted (runSession finalizes CANCELLED, slot freed).
  // awaiting_input takes a reply, not a steer — 409 points there.
  app.post<{ Params: { sessionId: string }; Body: { content: string } }>(
    '/tasks/:sessionId/steer',
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
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      // shared with the WS room channel — the route only adapts codes to HTTP
      const result = await steerSession(
        {
          backend: tenantCtx.backend,
          registry: deps.registry,
          queue: deps.queue,
          broadcaster: deps.sse.broadcaster,
        },
        request.params.sessionId,
        request.body.content
      )
      if (result.code !== 201) return reply.code(result.code).send({ ok: false, error: result.error })
      return reply.code(201).send({
        ok: true,
        session: sessionToWire(result.session),
        ...(result.interrupted ? { interrupted: true as const } : {}),
      })
    }
  )

  // Anytime human↔human chat: appends to interaction[] without moving the
  // lifecycle (no awaiting_input gate — allowed in any non-terminal state).
  // Contract: store raw, escape at render — the thread path must never use
  // dangerouslySetInnerHTML (stored XSS would fire for every viewer).
  app.post<{ Params: { sessionId: string }; Body: { content: string } }>(
    '/tasks/:sessionId/message',
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
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      // shared with the WS room channel — the route only adapts codes to HTTP
      const result = await appendChatMessage(
        {
          backend: tenantCtx.backend,
          registry: deps.registry,
          queue: deps.queue,
          broadcaster: deps.sse.broadcaster,
        },
        request.params.sessionId,
        request.body.content
      )
      if (result.code !== 201) return reply.code(result.code).send({ ok: false, error: result.error })
      return reply.code(201).send({ ok: true, session: sessionToWire(result.session) })
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
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const backend = tenantCtx.backend
      const sessionId = request.params.sessionId
      const { diagram } = request.body
      const current = await backend.get(sessionId)
      if (!current) return reply.code(404).send({ ok: false, error: 'unknown session' })
      // ephemeral: frontend localStorage is truth for drag positions; backend echoes for now
      // until diagram persistence migrates to event-sourced overlay (not swallowing success as durable)
      return reply.send({ ok: true, diagram, persisted: false })
    }
  )

  // Per-session SSE (spec §3/§4): replay-then-live for one session's events,
  // filtered by correlationId over the global bridge projection.
  app.get<{ Params: { sessionId: string } }>('/events/:sessionId', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const aggregate = await tenantCtx.backend.get(request.params.sessionId)
    if (!aggregate) return reply.code(404).send({ ok: false, error: 'unknown session' })
    reply.hijack()
    deps.sse.handleForSession(request.raw, reply.raw, aggregate.correlationId)
  })

  // Per-project SSE: replay-then-live for all sessions belonging to a project,
  // filtered by the set of correlation IDs for that project's sessions. The live
  // set grows on `session.created` for the same project so the stream is live.
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/events', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const backend = tenantCtx.backend
    const tenantId = tenantCtx.tenantId!
    const project = await backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    const { sessions } = await backend.list({ projectId: request.params.projectId, tenantId, limit: 500, offset: 0 })
    const correlationIds = new Set(sessions.map((s) => s.correlationId))
    reply.hijack()
    deps.sse.handleForProject(request.raw, reply.raw, request.params.projectId, correlationIds)
  })
}