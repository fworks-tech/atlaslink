import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GraphQLError, GraphQLScalarType, parse, type ValueNode } from 'graphql'
import { buildSubgraphSchema } from '@apollo/subgraph'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { SessionBackend, SessionFilter } from '../../session/sessionBackend'
import type { Session as AggregateSession } from '../../session/types'
import type { ProviderChoice } from '../../config'
import type { TaskRegistry } from '../../tasks/taskRegistry'
import type { SessionQueue } from '../../bridge/SessionQueue'
import type { SseHandler } from '../../bridge/sseEndpoint'
import { tenantBackendForRequest } from '../../api/tenant'
import { createSessionAction, validateCreateEdge } from '../../api/sessionLifecycle'
import { registerSubgraph } from '../executor'
import type { Resolvers, Task as GraphTask } from './graphql'

const typeDefs = parse(readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8'))

/** Server wiring the task subgraph needs — stores, queue, SSE, provider chain. */
export interface TaskSubgraphDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
  providers: ProviderChoice[]
}

/** Per-request resolver context: validated tenant, scoped backend, subgraph deps. */
export interface TaskContext {
  tenantId: string
  backend: SessionBackend
  tenantError: string | null
  deps: TaskSubgraphDeps
}

/**
 * Builds the per-request context by resolving the tenant from headers and
 * pairing it with the scoped backend plus subgraph deps.
 *
 * @param request - inbound graph request carrying optional tenant headers
 * @param deps - server wiring injected at registration
 * @returns the context every task resolver receives
 */
function makeContext(request: FastifyRequest, deps: TaskSubgraphDeps): TaskContext {
  const tenantCtx = tenantBackendForRequest(request, deps.backend)
  return {
    tenantId: tenantCtx.tenantId ?? '',
    backend: tenantCtx.backend,
    tenantError: tenantCtx.error,
    deps,
  }
}

/** Per-resolver tenant gate — the REST edge answers the same error with 400. */
function take(ctx: TaskContext): TaskContext {
  if (ctx.tenantError) throw new GraphQLError(ctx.tenantError, { extensions: { code: '400' } })
  return ctx
}

/**
 * Projects the domain session aggregate onto the GraphQL `Task` shape — the
 * generated type checks every field against schema.graphql; a task's
 * `session` back-reference stays a key-only stub for the entity hop.
 *
 * @param a - domain aggregate from the session backend
 * @returns the graph-shaped task
 */
function taskFromAggregate(a: AggregateSession): GraphTask {
  return {
    id: a.sessionId,
    status: a.status,
    projectId: a.projectId ?? null,
    member: a.task.member,
    prompt: a.task.prompt,
    tweaks: a.tweaks ?? null,
    createdAt: a.createdAt ?? null,
    finishedAt: a.finishedAt ?? null,
    error: a.error ?? null,
    replyCount: a.replyCount,
    session: { id: a.sessionId },
  }
}

/**
 * Turns a GraphQL AST literal into the plain value the JSON scalar holds,
 * rejecting variable references that carry no literal data.
 *
 * @param node - AST value node from a literal argument
 * @returns the decoded JavaScript value
 * @throws {GraphQLError} for variables or any other non-literal node
 */
function literalValue(node: ValueNode): unknown {
  switch (node.kind) {
    case 'StringValue':
    case 'BooleanValue':
      return node.value
    case 'IntValue':
    case 'FloatValue':
      return Number(node.value)
    case 'NullValue':
      return null
    case 'ListValue':
      return node.values.map(literalValue)
    case 'ObjectValue':
      return Object.fromEntries(node.fields.map((f) => [f.name.value, literalValue(f.value)]))
    default:
      throw new GraphQLError('unsupported literal in JSON scalar')
  }
}

/** The POST /tasks JSON-schema bounds (project/prompt) as graph-throwing checks. */
function validateTaskInput(projectId: string, prompt: string): void {
  if (!projectId.trim()) throw new GraphQLError('projectId must not be blank', { extensions: { code: '400' } })
  if (projectId.length > 200) throw new GraphQLError('projectId must be at most 200 characters', { extensions: { code: '400' } })
  if (prompt.length > 10000) throw new GraphQLError('prompt must be at most 10000 characters', { extensions: { code: '400' } })
}

/** The JSON scalar as a real instance — the generated `Resolvers` type demands one. */
const jsonScalar = new GraphQLScalarType({
  name: 'JSON',
  serialize: (value: unknown): unknown => value,
  parseValue: (value: unknown): unknown => value,
  parseLiteral: literalValue,
})

/** Schema-derived resolver map — types generated from schema.graphql (#324). */
const resolvers: Resolvers = {
  JSON: jsonScalar,
  Query: {
    task: async (_parent, args, ctx) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.id)
      return aggregate ? taskFromAggregate(aggregate) : null
    },
    tasks: async (_parent, args, ctx) => {
      const c = take(ctx)
      if (args.since != null && Number.isNaN(Date.parse(args.since))) {
        throw new GraphQLError('since must be an ISO-8601 date-time', { extensions: { code: '400' } })
      }
      if (args.limit < 1 || args.limit > 500) {
        throw new GraphQLError('limit must be between 1 and 500', { extensions: { code: '400' } })
      }
      if (args.offset < 0) {
        throw new GraphQLError('offset must not be negative', { extensions: { code: '400' } })
      }
      const filter: SessionFilter = {
        projectId: args.projectId ?? undefined,
        tenantId: c.tenantId,
        status: (args.status as SessionFilter['status']) ?? undefined,
        since: args.since ?? undefined,
        limit: args.limit,
        offset: args.offset,
      }
      const { sessions, total } = await c.backend.list(filter)
      return { tasks: sessions.map(taskFromAggregate), total, limit: filter.limit, offset: filter.offset }
    },
  },
  Mutation: {
    createTask: async (_parent, args, ctx) => {
      const c = take(ctx)
      validateTaskInput(args.projectId, args.prompt)
      type BuiltTweaks = { provider?: string; member?: Record<string, unknown>; team?: unknown }
      const tweaks: BuiltTweaks | undefined = args.tweaks
        ? {
            ...(args.tweaks.provider != null ? { provider: args.tweaks.provider } : {}),
            // the JSON scalar types member as unknown; the domain edge expects an object
            ...(args.tweaks.member != null ? { member: args.tweaks.member as Record<string, unknown> } : {}),
            ...(args.tweaks.team != null ? { team: args.tweaks.team } : {}),
          }
        : undefined
      const edgeError = validateCreateEdge(c.deps.providers, tweaks)
      if (edgeError !== null) throw new GraphQLError(edgeError, { extensions: { code: '400' } })
      const result = await createSessionAction(
        { backend: c.backend, registry: c.deps.registry, queue: c.deps.queue, broadcaster: c.deps.sse.broadcaster },
        {
          member: args.member,
          prompt: args.prompt,
          projectId: args.projectId,
          tenantId: c.tenantId,
          ...(tweaks?.provider !== undefined ? { provider: tweaks.provider } : {}),
          ...(tweaks !== undefined ? { tweaks } : {}),
        }
      )
      if (result.code !== 201) throw new GraphQLError(result.error, { extensions: { code: String(result.code) } })
      return taskFromAggregate(result.session)
    },
    saveDiagram: async (_parent, args, ctx) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.sessionId)
      if (!aggregate) throw new GraphQLError('unknown session', { extensions: { code: '404' } })
      // ephemeral: frontend localStorage is truth for drag positions; the echo
      // stays unpersisted until diagram moves to an event-sourced overlay
      return { diagram: args.diagram, persisted: false }
    },
  },
  Task: {
    __resolveReference: async (ref, ctx) => {
      const aggregate = await take(ctx).backend.get(ref.id)
      return aggregate ? taskFromAggregate(aggregate) : null
    },
  },
}

/**
 * Mounts the task subgraph on `/v1/graphql/task` behind the shared
 * executor envelope (HTTP 200 with a GraphQL body).
 *
 * @param app - Fastify instance that owns the `/v1` scope
 * @param deps - stores, queue, SSE and provider wiring from the server
 */
export function registerTaskSubgraph(app: FastifyInstance, deps: TaskSubgraphDeps): void {
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }])
  registerSubgraph(app, 'task', schema, (request) => makeContext(request, deps))
}
