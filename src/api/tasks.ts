import type { FastifyInstance } from 'fastify'
import type { SessionBackend, SessionFilter } from '../session/sessionBackend'
import type { Session as AggregateSession } from '../session/types'
import type { SessionQueue } from '../bridge/SessionQueue'
import type { SseHandler } from '../bridge/sseEndpoint'
import type { TaskRegistry } from '../tasks/taskRegistry'
import { availableProviders, type ProviderChoice } from '../config'
import { tenantBackendForRequest } from './tenant'
import { appendChatMessage, askFollowup, replyToParked, steerSession } from './sessionActions'
import { cancelSessionAction, createSessionAction } from './sessionLifecycle'

export interface TaskDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
  providers: ProviderChoice[]
}

interface PostBody {
  member: string
  prompt: string
  projectId: string
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
  app.get('/providers', async () => ({
    ok: true,
    default: deps.providers[0]?.name ?? null,
    providers: deps.providers,
  }))

  app.post<{ Body: PostBody }>(
    '/tasks',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['member', 'prompt', 'projectId'],
          properties: {
            member: { type: 'string', minLength: 1 },
            prompt: { type: 'string', minLength: 1, maxLength: 10000 },
            projectId: { type: 'string', minLength: 1, maxLength: 200 },
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
      const { member, prompt, projectId, tweaks } = request.body
      // fast-fail on a pick list mismatch: the UI reads a snapshot, so an
      // unknown provider (stale list, typo, provider removed) must 400 at
      // creation instead of stalling a queued session at run time. With no
      // configured roster there is nothing to validate against — the tweak
      // passes through and the run fails on the provider itself, as before.
      if (
        deps.providers.length > 0 &&
        tweaks?.provider !== undefined &&
        (tweaks.provider.length === 0 || !deps.providers.some((p) => p.name === tweaks.provider))
      ) {
        return reply.code(400).send({ ok: false, error: `unknown provider, choose from ${deps.providers.map((p) => p.name).join(', ')}` })
      }
      const tweakModel = tweaks?.member?.model
      if (tweakModel !== undefined && (typeof tweakModel !== 'string' || tweakModel.trim().length === 0 || tweakModel.length > 200)) {
        return reply.code(400).send({ ok: false, error: 'tweaks.member.model must be a non-empty string up to 200 chars' })
      }
      const result = await createSessionAction(
        { backend: tenantCtx.backend, registry: deps.registry, queue: deps.queue, broadcaster: deps.sse.broadcaster },
        {
          member,
          prompt,
          projectId,
          tenantId,
          ...(tweaks?.provider !== undefined ? { provider: tweaks.provider } : {}),
          ...(tweaks !== undefined ? { tweaks } : {}),
        }
      )
      if (result.code !== 201) return reply.code(result.code).send({ ok: false, error: result.error })
      return reply.code(201).send({ ok: true, session: sessionToWire(result.session) })
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
    const result = await cancelSessionAction(
      { backend: tenantCtx.backend, registry: deps.registry, broadcaster: deps.sse.broadcaster },
      request.params.sessionId
    )
    if (result.code !== 202) {
      return reply.code(result.code).send({ ok: false, error: result.error })
    }
    return reply.code(202).send({
      ok: true,
      status: result.status,
      ...(result.cancel !== undefined ? { cancel: result.cancel } : {}),
      session: sessionToWire(result.session),
    })
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

  // Question about a terminal session: the run is over, so steer, reply
  // and message all 409 there — the question spawns a linked follow-up
  // answered by the same member instead.
  app.post<{ Params: { sessionId: string }; Body: { content: string } }>(
    '/tasks/:sessionId/followup',
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
      const result = await askFollowup(
        { backend, registry: deps.registry, queue: deps.queue, broadcaster: deps.sse.broadcaster },
        { sessionId, tenantId, content: request.body.content }
      )
      if (result.code !== 201) return reply.code(result.code).send({ ok: false, error: result.error })
      const followup = await backend.get(result.followupId)
      if (!followup) return reply.code(404).send({ ok: false, error: 'unknown session' })
      return reply.code(201).send({ ok: true, session: sessionToWire(result.session), followupSession: sessionToWire(followup) })
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