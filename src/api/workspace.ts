import type { FastifyInstance } from 'fastify'
import type { SessionBackend } from '../session/sessionBackend'
import { commitAll, diff, ensureWorkspace, listAt, logCommits, readAt, workspacePathFor } from '../workspace'
import { DEFAULT_TENANT_ID } from '../session/migrations'
import { tenantBackendForRequest } from './tenant'
import { canReadProject, canWriteProject } from './projectAcl'

interface WorkspaceDeps {
  backend: SessionBackend
  workspaceRoot: string
}

const MAX_FILE_BYTES = 256 * 1024
const MAX_DIFF_BYTES = 512 * 1024

/**
 * Workspace REST surface (Phase D): the project git repo as the shared
 * human+agent canvas — file list/read, diffs, history, and attributed
 * commits. Same project ACL as sessions (read for viewers, write for
 * editors/owners); human commits carry a `user:` trailer, agent runs the
 * `session:` trailer via commitAll.
 */
export function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceDeps): void {
  async function repoForProject(
    projectId: string,
    backend: SessionBackend
  ): Promise<{ repo: string } | { code: 404; error: string }> {
    const project = await backend.getProject(projectId)
    if (!project) return { code: 404, error: 'unknown project' }
    // lazy init: auto-created projects (inbox) get a repo on first workspace use
    const repo = workspacePathFor(deps.workspaceRoot, project.tenantId ?? DEFAULT_TENANT_ID, project.id)
    await ensureWorkspace(repo)
    return { repo }
  }

  app.get<{ Params: { projectId: string }; Querystring: { commit?: string } }>(
    '/projects/:projectId/workspace/files',
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      if (!(await canReadProject(tenantCtx.backend, request.params.projectId, request.auth?.userId))) {
        return reply.code(404).send({ ok: false, error: 'unknown project' })
      }
      try {
        const resolved = await repoForProject(request.params.projectId, tenantCtx.backend)
        if ('code' in resolved) return reply.code(resolved.code).send({ ok: false, error: resolved.error })
        const files = await listAt(resolved.repo, request.query.commit ?? 'HEAD')
        return reply.send({ ok: true, files })
      } catch (err) {
        return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : 'workspace read failed' })
      }
    }
  )

  app.get<{ Params: { projectId: string }; Querystring: { path?: string; commit?: string } }>(
    '/projects/:projectId/workspace/file',
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      if (!(await canReadProject(tenantCtx.backend, request.params.projectId, request.auth?.userId))) {
        return reply.code(404).send({ ok: false, error: 'unknown project' })
      }
      if (!request.query.path) return reply.code(400).send({ ok: false, error: 'path is required' })
      try {
        const resolved = await repoForProject(request.params.projectId, tenantCtx.backend)
        if ('code' in resolved) return reply.code(resolved.code).send({ ok: false, error: resolved.error })
        const content = await readAt(resolved.repo, request.query.commit ?? 'HEAD', request.query.path)
        if (content === null) return reply.code(404).send({ ok: false, error: 'unknown file' })
        if (content.length > MAX_FILE_BYTES) return reply.code(413).send({ ok: false, error: 'file too large for inline view' })
        return reply.send({ ok: true, content })
      } catch (err) {
        return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : 'workspace read failed' })
      }
    }
  )

  app.get<{ Params: { projectId: string }; Querystring: { from?: string; to?: string } }>(
    '/projects/:projectId/workspace/diff',
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      if (!(await canReadProject(tenantCtx.backend, request.params.projectId, request.auth?.userId))) {
        return reply.code(404).send({ ok: false, error: 'unknown project' })
      }
      try {
        const resolved = await repoForProject(request.params.projectId, tenantCtx.backend)
        if ('code' in resolved) return reply.code(resolved.code).send({ ok: false, error: resolved.error })
        const text = await diff(resolved.repo, request.query.from ?? 'HEAD~1', request.query.to ?? 'HEAD')
        if (text.length > MAX_DIFF_BYTES) return reply.code(413).send({ ok: false, error: 'diff too large for inline view' })
        return reply.send({ ok: true, diff: text })
      } catch (err) {
        return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : 'workspace diff failed' })
      }
    }
  )

  app.get<{ Params: { projectId: string }; Querystring: { limit?: string } }>(
    '/projects/:projectId/workspace/log',
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      if (!(await canReadProject(tenantCtx.backend, request.params.projectId, request.auth?.userId))) {
        return reply.code(404).send({ ok: false, error: 'unknown project' })
      }
      try {
        const resolved = await repoForProject(request.params.projectId, tenantCtx.backend)
        if ('code' in resolved) return reply.code(resolved.code).send({ ok: false, error: resolved.error })
        const commits = await logCommits(resolved.repo, parseInt(request.query.limit ?? '20', 10) || 20)
        return reply.send({ ok: true, commits })
      } catch (err) {
        return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : 'workspace log failed' })
      }
    }
  )

  app.post<{ Params: { projectId: string }; Body: { message?: string; sessionId?: string } }>(
    '/projects/:projectId/workspace/commit',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 2000 },
            sessionId: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      if (!(await canReadProject(tenantCtx.backend, request.params.projectId, request.auth?.userId))) {
        return reply.code(404).send({ ok: false, error: 'unknown project' })
      }
      if (!(await canWriteProject(tenantCtx.backend, request.params.projectId, request.auth?.userId))) {
        return reply.code(403).send({ ok: false, error: 'viewer cannot commit' })
      }
      try {
        const resolved = await repoForProject(request.params.projectId, tenantCtx.backend)
        if ('code' in resolved) return reply.code(resolved.code).send({ ok: false, error: resolved.error })
        // human commits carry the user trailer; agent runs pass sessionId
        const userId = request.auth?.userId
        const text = request.body.message ?? ''
        if (!text.trim()) return reply.code(400).send({ ok: false, error: 'message must not be blank' })
        const message = userId ? `${text}\n\nuser: ${userId}` : text
        const sha = await commitAll(resolved.repo, {
          message,
          ...(request.body.sessionId !== undefined ? { sessionId: request.body.sessionId } : {}),
        })
        return reply.code(201).send({ ok: true, sha })
      } catch (err) {
        return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : 'workspace commit failed' })
      }
    }
  )
}
