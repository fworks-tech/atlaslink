import type { FastifyInstance } from 'fastify'
import type { SessionBackend } from '../session/sessionBackend'
import { randomUUID } from 'node:crypto'
import { backendForTenant } from '../session/backendFactory'
import { requireValidTenantId, resolveTenantId } from '../session/tenant'

function tenantBackendForRequest(request: { headers: Record<string, string | string[] | undefined> }, base: SessionBackend): SessionBackend {
  const tenantId = resolveTenantId(request.headers as Record<string, string | string[] | undefined>)
  return backendForTenant(base, tenantId)
}

function rejectInvalidTenant(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const v = requireValidTenantId(request.headers as Record<string, string | string[] | undefined>)
  return v === null ? 'invalid tenant id' : null
}

interface ProjectDeps {
  backend: SessionBackend
}

/**
 * The M4 Project API routes: create, list, and read projects. Projects are
 * workspace containers for sessions. The routes are token-gated via the
 * pre-auth hook installed in `server.ts` on the gated scope.
 */
export function registerProjectRoutes(app: FastifyInstance, deps: ProjectDeps): void {
  app.post<{ Body: { name: string } }>(
    '/projects',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const bad = rejectInvalidTenant(request)
      if (bad) return reply.code(400).send({ ok: false, error: bad })
      const backend = tenantBackendForRequest(request, deps.backend)
      const { name } = request.body
      const id = `proj-${randomUUID()}`
      const project = await backend.createProject(id, name)
      return reply.code(201).send({ ok: true, project })
    }
  )

  app.get('/projects', async (request, reply) => {
    const bad = rejectInvalidTenant(request)
    if (bad) return reply.code(400).send({ ok: false, error: bad })
    const backend = tenantBackendForRequest(request, deps.backend)
    const projects = await backend.listProjects()
    return reply.send({ ok: true, projects })
  })

  app.get<{ Params: { projectId: string } }>('/projects/:projectId', async (request, reply) => {
    const bad = rejectInvalidTenant(request)
    if (bad) return reply.code(400).send({ ok: false, error: bad })
    const backend = tenantBackendForRequest(request, deps.backend)
    const project = await backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    return reply.send({ ok: true, project })
  })

  app.delete<{ Params: { projectId: string } }>(
    '/projects/:projectId',
    async (request, reply) => {
      const bad = rejectInvalidTenant(request)
      if (bad) return reply.code(400).send({ ok: false, error: bad })
      const backend = tenantBackendForRequest(request, deps.backend)
      const deleted = await backend.deleteProject(request.params.projectId)
      if (!deleted) return reply.code(404).send({ ok: false, error: 'unknown project' })
      return reply.send({ ok: true })
    }
  )
}
