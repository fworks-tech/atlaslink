import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GraphQLError, parse } from 'graphql'
import { buildSubgraphSchema } from '@apollo/subgraph'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { SessionBackend } from '../../session/sessionBackend'
import { tenantBackendForRequest } from '../../api/tenant'
import { workspacePathFor, ensureWorkspace, commitAll, readAt, listAt, diff } from '../../workspace'
import { registerSubgraph } from '../executor'
import type { Resolvers } from './graphql'

const typeDefs = parse(readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8'))

/** Wiring the files subgraph needs from the server — session store for attribution plus the workspace root. */
export interface FilesSubgraphDeps {
  backend: SessionBackend
  /** Absolute workspace root (server passes `<dataDir>/workspaces`). */
  workspaceRoot: string
}

/** Per-request resolver context: tenant identity after validation, backend scoped to it, workspace root. */
export interface FilesContext {
  tenantId: string
  backend: SessionBackend
  tenantError: string | null
  workspaceRoot: string
}

/**
 * Builds the per-request context by resolving the tenant from headers
 * (or falling back to the default tenant) and pairing it with the
 * tenant-scoped backend.
 *
 * @param request - inbound graph request carrying optional tenant headers
 * @param deps - server wiring injected at registration
 * @returns the context every files resolver receives
 */
function makeContext(request: FastifyRequest, deps: FilesSubgraphDeps): FilesContext {
  const tenantCtx = tenantBackendForRequest(request, deps.backend)
  return {
    tenantId: tenantCtx.tenantId ?? '',
    backend: tenantCtx.backend,
    tenantError: tenantCtx.error,
    workspaceRoot: deps.workspaceRoot,
  }
}

/** Per-resolver tenant gate — the REST edge answers the same error with 400. */
function take(ctx: FilesContext): FilesContext {
  if (ctx.tenantError) throw new GraphQLError(ctx.tenantError, { extensions: { code: '400' } })
  return ctx
}

/**
 * Maps a workspace or input failure onto the graph error envelope: client
 * faults (unsafe refs/paths/ids, blank messages) answer 400, anything else
 * (git binary, disk) is infra and answers 500.
 *
 * @param err - error thrown by the workspace layer or path resolution
 * @returns a GraphQLError carrying the numeric status code in extensions
 */
function gitError(err: unknown): GraphQLError {
  const message = err instanceof Error ? err.message : String(err)
  const isInput = /^unsafe |^commit message must not be empty|^sessionId must be a single line/.test(message)
  return new GraphQLError(message, { extensions: { code: isInput ? '400' : '500' } })
}

/**
 * Resolves the on-disk repository for a project through the tenant-derived
 * path — raw input never reaches the filesystem.
 *
 * @param ctx - validated per-request context
 * @param projectId - project segment (validated inside `workspacePathFor`)
 * @returns absolute path of the project's git workspace
 * @throws {GraphQLError} 400 when the project id is unsafe for a path
 */
function repoFor(ctx: FilesContext, projectId: string): string {
  try {
    return workspacePathFor(ctx.workspaceRoot, ctx.tenantId, projectId)
  } catch (err) {
    throw gitError(err)
  }
}

/** Schema-derived resolver map — types generated from schema.graphql (#324). */
const resolvers: Resolvers = {
  Query: {
    files: async (_parent, args, ctx) => {
      const c = take(ctx)
      const repo = repoFor(c, args.projectId)
      try {
        await ensureWorkspace(repo)
        return await listAt(repo, args.commit)
      } catch (err) {
        throw gitError(err)
      }
    },
    file: async (_parent, args, ctx) => {
      const c = take(ctx)
      const repo = repoFor(c, args.projectId)
      try {
        await ensureWorkspace(repo)
        return await readAt(repo, args.commit, args.path)
      } catch (err) {
        throw gitError(err)
      }
    },
    fileDiff: async (_parent, args, ctx) => {
      const c = take(ctx)
      const repo = repoFor(c, args.projectId)
      try {
        await ensureWorkspace(repo)
        return await diff(repo, args.from, args.to)
      } catch (err) {
        throw gitError(err)
      }
    },
  },
  Mutation: {
    commitFiles: async (_parent, args, ctx) => {
      const c = take(ctx)
      const repo = repoFor(c, args.projectId)
      // input faults answer before the store is touched (mirrors commitAll's own checks)
      if (!args.message.trim()) throw new GraphQLError('commit message must not be empty', { extensions: { code: '400' } })
      if (/[\r\n]/.test(args.sessionId)) throw new GraphQLError('sessionId must be a single line', { extensions: { code: '400' } })
      const session = await c.backend.get(args.sessionId)
      if (!session) throw new GraphQLError('unknown session', { extensions: { code: '404' } })
      try {
        return await commitAll(repo, { message: args.message, sessionId: args.sessionId })
      } catch (err) {
        throw gitError(err)
      }
    },
  },
}

/**
 * Mounts the files subgraph on `/v1/graphql/files` behind the shared
 * executor envelope (HTTP 200 with a GraphQL body).
 *
 * @param app - Fastify instance that owns the `/v1` scope
 * @param deps - session backend and workspace root from the server
 */
export function registerFilesSubgraph(app: FastifyInstance, deps: FilesSubgraphDeps): void {
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }])
  registerSubgraph(app, 'files', schema, (request) => makeContext(request, deps))
}
