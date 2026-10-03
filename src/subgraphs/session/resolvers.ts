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
import type { Resolvers, Session as GraphSession, Envelope as GraphEnvelope } from './graphql'

const typeDefs = parse(readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8'))

/** Server wiring the session subgraph needs — stores, queue, SSE, roster. */
export interface SessionSubgraphDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
  eventLog: EventLogStore
  rosterOf: (sessionId: string) => RoomMember[]
}

/** Per-request resolver context: validated tenant, scoped backend, ingress deps and event log. */
export interface SessionContext {
  tenantId: string
  backend: SessionBackend
  tenantError: string | null
  ingress: IngressDeps
  eventLog: EventLogStore
  rosterOf: (sessionId: string) => RoomMember[]
}

/**
 * Builds the per-request context by resolving the tenant from headers and
 * pairing it with the scoped backend, ingress wiring and roster lookup.
 *
 * @param request - inbound graph request carrying optional tenant headers
 * @param deps - server wiring injected at registration
 * @returns the context every session resolver receives
 */
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

/**
 * Projects the domain session aggregate onto the GraphQL `Session` shape —
 * the generated type checks every field against schema.graphql.
 *
 * @param session - domain aggregate from the session backend
 * @returns the graph-shaped session
 */
function mapSession(session: AggregateSession): GraphSession {
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

/**
 * Converts an action result into its session shape or throws the mapped
 * graph error with the REST-equivalent status code in extensions.
 *
 * @param result - outcome of a session action (create, cancel, steer, ...)
 * @returns the mapped session
 * @throws {GraphQLError} with the numeric status code when the action failed
 */
function unwrap(result: ActionResult | FollowupResult | ReplyResult | SteerResult): GraphSession {
  if (result.code === 201) return mapSession(result.session)
  throw new GraphQLError(result.error, { extensions: { code: String(result.code) } })
}

/**
 * Projects a stored event envelope onto the GraphQL `Envelope` shape,
 * reading only the string fields the schema exposes.
 *
 * @param stored - envelope as replayed from the event log
 * @returns the graph-shaped envelope
 */
function mapEnvelope(stored: StoredEnvelope): GraphEnvelope {
  const env = stored.envelope as Record<string, unknown>
  const str = (key: string): string | null => (typeof env[key] === 'string' ? (env[key] as string) : null)
  return {
    eventId: stored.eventId,
    // stored envelopes are loose JSON; the schema demands a type string
    type: env.type as string,
    at: str('at'),
    sessionId: str('sessionId'),
    correlationId: str('correlationId'),
    member: str('member'),
    prompt: str('prompt'),
    message: str('message'),
    error: str('error'),
  }
}

/** Schema-derived resolver map — types generated from schema.graphql (#324). */
const resolvers: Resolvers = {
  Query: {
    session: async (_parent, args, ctx) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.id)
      return aggregate ? mapSession(aggregate) : null
    },
    sessions: async (_parent, args, ctx) => {
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
    sessionEvents: async (_parent, args, ctx) => {
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
    roomMembers: async (_parent, args, ctx) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.sessionId)
      if (!aggregate || aggregate.tenantId !== c.tenantId) {
        throw new GraphQLError('unknown session', { extensions: { code: '404' } })
      }
      return c.rosterOf(args.sessionId)
    },
  },
  Mutation: {
    createSession: async (_parent, args, ctx) => {
      const c = take(ctx)
      const result = await createSessionAction(c.ingress, {
        member: args.member,
        prompt: args.prompt,
        tenantId: c.tenantId,
        ...(args.projectId != null ? { projectId: args.projectId } : {}),
      })
      return unwrap(result)
    },
    cancelSession: async (_parent, args, ctx) => {
      const c = take(ctx)
      const result = await cancelSessionAction(
        { backend: c.ingress.backend, registry: c.ingress.registry, broadcaster: c.ingress.broadcaster },
        args.id
      )
      if (result.code !== 202) throw new GraphQLError(result.error, { extensions: { code: String(result.code) } })
      return mapSession(result.session)
    },
    appendMessage: async (_parent, args, ctx) =>
      unwrap(await appendChatMessage(take(ctx).ingress, args.sessionId, args.content)),
    askFollowup: async (_parent, args, ctx) => {
      const c = take(ctx)
      return unwrap(await askFollowup(c.ingress, { sessionId: args.sessionId, tenantId: c.tenantId, content: args.question }))
    },
    steerSession: async (_parent, args, ctx) =>
      unwrap(await steerSession(take(ctx).ingress, args.sessionId, args.content)),
    replyToParked: async (_parent, args, ctx) => {
      const c = take(ctx)
      return unwrap(await replyToParked(c.ingress, args.sessionId, c.tenantId, args.reply))
    },
  },
  Session: {
    __resolveReference: async (ref, ctx) => {
      const aggregate = await take(ctx).backend.get(ref.id)
      return aggregate ? mapSession(aggregate) : null
    },
  },
}

/**
 * Mounts the session subgraph on `/v1/graphql/session` behind the shared
 * executor envelope (HTTP 200 with a GraphQL body).
 *
 * @param app - Fastify instance that owns the `/v1` scope
 * @param deps - stores, queue, SSE and roster wiring from the server
 */
export function registerSessionSubgraph(app: FastifyInstance, deps: SessionSubgraphDeps): void {
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }])
  registerSubgraph(app, 'session', schema, (request) => makeContext(request, deps))
}
