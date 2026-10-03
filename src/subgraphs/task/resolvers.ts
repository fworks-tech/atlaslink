import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GraphQLError, parse, type ValueNode } from 'graphql'
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

const typeDefs = parse(readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8'))

export interface TaskSubgraphDeps {
  backend: SessionBackend
  registry: TaskRegistry
  queue: SessionQueue
  sse: SseHandler
  providers: ProviderChoice[]
}

interface TaskContext {
  tenantId: string
  backend: SessionBackend
  tenantError: string | null
  deps: TaskSubgraphDeps
}

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

function taskFromAggregate(a: AggregateSession): Record<string, unknown> {
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

const resolvers = {
  JSON: {
    serialize: (value: unknown): unknown => value,
    parseValue: (value: unknown): unknown => value,
    parseLiteral: literalValue,
  },
  Query: {
    task: async (_: unknown, args: { id: string }, ctx: TaskContext) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.id)
      return aggregate ? taskFromAggregate(aggregate) : null
    },
    tasks: async (
      _: unknown,
      args: { projectId?: string | null; status?: string | null; since?: string | null; limit: number; offset: number },
      ctx: TaskContext
    ) => {
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
    createTask: async (
      _: unknown,
      args: {
        member: string
        prompt: string
        projectId: string
        tweaks?: { provider?: string | null; member?: Record<string, unknown> | null; team?: Record<string, unknown> | null } | null
      },
      ctx: TaskContext
    ) => {
      const c = take(ctx)
      validateTaskInput(args.projectId, args.prompt)
      type BuiltTweaks = { provider?: string; member?: Record<string, unknown>; team?: unknown }
      const tweaks: BuiltTweaks | undefined = args.tweaks
        ? {
            ...(args.tweaks.provider != null ? { provider: args.tweaks.provider } : {}),
            ...(args.tweaks.member != null ? { member: args.tweaks.member } : {}),
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
    saveDiagram: async (
      _: unknown,
      args: { sessionId: string; diagram: { nodes: unknown[]; edges: unknown[]; mode: string } },
      ctx: TaskContext
    ) => {
      const c = take(ctx)
      const aggregate = await c.backend.get(args.sessionId)
      if (!aggregate) throw new GraphQLError('unknown session', { extensions: { code: '404' } })
      // ephemeral: frontend localStorage is truth for drag positions; the echo
      // stays unpersisted until diagram moves to an event-sourced overlay
      return { diagram: args.diagram, persisted: false }
    },
  },
  Task: {
    __resolveReference: async (ref: { id: string }, ctx: TaskContext) => {
      const aggregate = await take(ctx).backend.get(ref.id)
      return aggregate ? taskFromAggregate(aggregate) : null
    },
  },
}

export function registerTaskSubgraph(app: FastifyInstance, deps: TaskSubgraphDeps): void {
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }])
  registerSubgraph(app, 'task', schema, (request) => makeContext(request, deps))
}
