import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GraphQLError, parse } from 'graphql'
import { buildSubgraphSchema } from '@apollo/subgraph'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { SessionBackend, SessionFilter } from '../../session/sessionBackend'
import type { Session as AggregateSession } from '../../session/types'
import type { TaskRegistry } from '../../tasks/taskRegistry'
import type { SessionQueue } from '../../bridge/SessionQueue'
import type { SseHandler } from '../../bridge/sseEndpoint'
import type { EventLogStore, StoredEnvelope } from '../../bridge/EventLogStore'
import { tenantBackendForRequest } from '../../api/tenant'
import type { IngressDeps, ActionResult, FollowupResult, ReplyResult, SteerResult } from '../../api/sessionActions'
import { appendChatMessage, askFollowup, replyToParked, steerSession } from '../../api/sessionActions'
import { cancelSessionAction, createSessionAction } from '../../api/sessionLifecycle'
import { roomFilter, type RoomMember } from '../../api/room'
import { registerSubgraph } from '../executor'

const typeDefs = parse(readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8'))

export interface SessionSubgraphDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
  eventLog: EventLogStore
  rosterOf: (sessionId: string) => RoomMember[]
}

interface SessionContext {
  tenantId: string
  backend: SessionBackend
  tenantError: string | null
  ingress: IngressDeps
  eventLog: EventLogStore
  rosterOf: (sessionId: string) => RoomMember[]
}

function makeContext(request: FastifyRequest, deps: SessionSubgraphDeps): SessionContext {
  const tenantCtx = tenantBackendForRequest(request, deps.backend)
  return {
    tenantId: tenantCtx.tenantId ?? '',
    backend: tenantCtx.backend,
    tenantError: tenantCtx.error,
    ingress: { backend: tenantCtx.backend, registry: deps.registry, queue: deps.queue, broadcaster: deps.sse.broadcaster },
    eventLog: deps.eventLog,
    rosterOf: deps.rosterOf,
  }
}

/** Per-resolver tenant gate — the REST edge answers the same error with 400. */
function take(ctx: SessionContext): SessionContext {
  if (ctx.tenantError) throw new GraphQLError(ctx.tenantError, { extensions: { code: '400' } })
  return ctx
}

function mapSession(session: AggregateSession): Record<string, unknown> {
  return {
    id: session.sessionId,
    correlationId: session.correlationId,
    status: session.status,
    version: session.version,
    projectId: session.projectId ?? null,
    tenantId: session.tenantId ?? null,
    createdAt: session.createdAt ?? null,
    startedAt: session.startedAt ?? null,
    finishedAt: session.finishedAt ?? null,
    member: session.task.member,
    prompt: session.task.prompt,
    output: session.output ?? null,
    error: session.error ?? null,
    durationMs: session.durationMs ?? null,
    interaction: session.interaction,
    nextStep: session.nextStep
      ? {
          awaitingInput: session.nextStep.awaiting_input,
          prompt: session.nextStep.prompt ?? null,
          member: session.nextStep.member ?? null,
        }
      : null,
    question: session.question ? { question: session.question.question, context: session.question.context ?? null } : null,
    resumeOf: session.resumeOf ?? null,
    replyCount: session.replyCount,
  }
}

function unwrap(result: ActionResult | FollowupResult | ReplyResult | SteerResult): Record<string, unknown> {
  if (result.code === 201) return mapSession(result.session)
  throw new GraphQLError(result.error, { extensions: { code: String(result.code) } })
}

function mapEnvelope(stored: StoredEnvelope): Record<string, unknown> {
  const env = stored.envelope as Record<string, unknown>
  const str = (key: string): string | null => (typeof env[key] === 'string' ? (env[key] as string) : null)
  return {
    eventId: stored.eventId,
    type: env.type,
    at: str('at'),
    sessionId: str('sessionId'),
    correlationId: str('correlationId'),
    member: str('member'),
    prompt: str('prompt'),
    message: str('message'),
    error: str('error'),
  }
}

const resolvers = {
  Query: {
    session: async (_: unknown, args: { id: string }, ctx: SessionContext) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.id)
      return aggregate ? mapSession(aggregate) : null
    },
    sessions: async (
      _: unknown,
      args: { projectId?: string | null; status?: string | null; limit: number; offset: number },
      ctx: SessionContext
    ) => {
      const c = take(ctx)
      const { sessions, total } = await c.backend.list({
        ...(args.projectId != null ? { projectId: args.projectId } : {}),
        ...(args.status != null ? { status: args.status as SessionFilter['status'] } : {}),
        tenantId: c.tenantId,
        limit: args.limit,
        offset: args.offset,
      })
      return { sessions: sessions.map(mapSession), total }
    },
    sessionEvents: async (_: unknown, args: { sessionId: string; limit: number }, ctx: SessionContext) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.sessionId)
      if (!aggregate) throw new GraphQLError('unknown session', { extensions: { code: '404' } })
      // slice(-0) would be slice(0): an explicit zero means none, and the
      // cap keeps one query from replaying an unbounded log into memory
      const limit = Math.min(Math.max(args.limit, 0), 1000)
      if (limit === 0) return []
      return c.eventLog
        .replay(-1)
        .filter(({ envelope }) => roomFilter(envelope, args.sessionId, aggregate.correlationId))
        .slice(-limit)
        .map(mapEnvelope)
    },
    roomMembers: async (_: unknown, args: { sessionId: string }, ctx: SessionContext) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.sessionId)
      if (!aggregate || aggregate.tenantId !== c.tenantId) {
        throw new GraphQLError('unknown session', { extensions: { code: '404' } })
      }
      return c.rosterOf(args.sessionId)
    },
  },
  Mutation: {
    createSession: async (
      _: unknown,
      args: { member: string; prompt: string; projectId?: string | null },
      ctx: SessionContext
    ) => {
      const c = take(ctx)
      const result = await createSessionAction(c.ingress, {
        member: args.member,
        prompt: args.prompt,
        tenantId: c.tenantId,
        ...(args.projectId != null ? { projectId: args.projectId } : {}),
      })
      return unwrap(result)
    },
    cancelSession: async (_: unknown, args: { id: string }, ctx: SessionContext) => {
      const c = take(ctx)
      const result = await cancelSessionAction(
        { backend: c.ingress.backend, registry: c.ingress.registry, broadcaster: c.ingress.broadcaster },
        args.id
      )
      if (result.code !== 202) throw new GraphQLError(result.error, { extensions: { code: String(result.code) } })
      return mapSession(result.session)
    },
    appendMessage: async (_: unknown, args: { sessionId: string; content: string }, ctx: SessionContext) =>
      unwrap(await appendChatMessage(take(ctx).ingress, args.sessionId, args.content)),
    askFollowup: async (_: unknown, args: { sessionId: string; question: string }, ctx: SessionContext) => {
      const c = take(ctx)
      return unwrap(await askFollowup(c.ingress, { sessionId: args.sessionId, tenantId: c.tenantId, content: args.question }))
    },
    steerSession: async (_: unknown, args: { sessionId: string; content: string }, ctx: SessionContext) =>
      unwrap(await steerSession(take(ctx).ingress, args.sessionId, args.content)),
    replyToParked: async (_: unknown, args: { sessionId: string; reply: string }, ctx: SessionContext) => {
      const c = take(ctx)
      return unwrap(await replyToParked(c.ingress, args.sessionId, c.tenantId, args.reply))
    },
  },
  Session: {
    __resolveReference: async (ref: { id: string }, ctx: SessionContext) => {
      const aggregate = await take(ctx).backend.get(ref.id)
      return aggregate ? mapSession(aggregate) : null
    },
  },
}

export function registerSessionSubgraph(app: FastifyInstance, deps: SessionSubgraphDeps): void {
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }])
  registerSubgraph(app, 'session', schema, (request) => makeContext(request, deps))
}
