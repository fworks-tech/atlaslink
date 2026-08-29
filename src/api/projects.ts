import type { FastifyInstance } from 'fastify'
import type { SessionBackend } from '../session/sessionBackend'
import { randomUUID } from 'node:crypto'

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
      const { name } = request.body
      const id = `proj-${randomUUID()}`
      const project = await deps.backend.createProject(id, name)
      return reply.code(201).send({ ok: true, project })
    }
  )

  app.get('/projects', async (_request, reply) => {
    const projects = await deps.backend.listProjects()
    return reply.send({ ok: true, projects })
  })

  app.get<{ Params: { projectId: string } }>('/projects/:projectId', async (request, reply) => {
    const project = await deps.backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    return reply.send({ ok: true, project })
  })
}
