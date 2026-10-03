import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GraphQLError, parse } from 'graphql'
import { buildSubgraphSchema } from '@apollo/subgraph'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { SessionBackend } from '../../session/sessionBackend'
import { tenantBackendForRequest } from '../../api/tenant'
import { workspacePathFor, ensureWorkspace, commitAll, readAt, listAt, diff } from '../../workspace'
import { registerSubgraph } from '../executor'

const typeDefs = parse(readFileSync(join(import.meta.dirname, 'schema.graphql'), 'utf8'))

export interface FilesSubgraphDeps {
  backend: SessionBackend
  /** Absolute workspace root (server passes `<dataDir>/workspaces`). */
  workspaceRoot: string
}

interface FilesContext {
  tenantId: string
  backend: SessionBackend
  tenantError: string | null
  workspaceRoot: string
}

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
 * Workspace input errors (unsafe refs/paths/ids, blank messages) are client
 * faults → 400; anything else (git binary, disk) is infra → 500.
 */
function gitError(err: unknown): GraphQLError {
  const message = err instanceof Error ? err.message : String(err)
  const isInput = /^unsafe |^commit message must not be empty|^sessionId must be a single line/.test(message)
  return new GraphQLError(message, { extensions: { code: isInput ? '400' : '500' } })
}

function repoFor(ctx: FilesContext, projectId: string): string {
  try {
    return workspacePathFor(ctx.workspaceRoot, ctx.tenantId, projectId)
  } catch (err) {
    throw gitError(err)
  }
}

const resolvers = {
  Query: {
    files: async (_: unknown, args: { projectId: string; commit: string }, ctx: FilesContext) => {
      const c = take(ctx)
      const repo = repoFor(c, args.projectId)
      try {
        await ensureWorkspace(repo)
        return await listAt(repo, args.commit)
      } catch (err) {
        throw gitError(err)
      }
    },
    file: async (_: unknown, args: { projectId: string; path: string; commit: string }, ctx: FilesContext) => {
      const c = take(ctx)
      const repo = repoFor(c, args.projectId)
      try {
        await ensureWorkspace(repo)
        return await readAt(repo, args.commit, args.path)
      } catch (err) {
        throw gitError(err)
      }
    },
    fileDiff: async (_: unknown, args: { projectId: string; from: string; to: string }, ctx: FilesContext) => {
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
    commitFiles: async (_: unknown, args: { projectId: string; message: string; sessionId: string }, ctx: FilesContext) => {
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

export function registerFilesSubgraph(app: FastifyInstance, deps: FilesSubgraphDeps): void {
  const schema = buildSubgraphSchema([{ typeDefs, resolvers }])
  registerSubgraph(app, 'files', schema, (request) => makeContext(request, deps))
}
