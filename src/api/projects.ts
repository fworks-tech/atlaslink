import type { FastifyInstance } from 'fastify'
import type { SessionBackend } from '../session/sessionBackend'
import type { AuthStore } from '../session/authStore'
import { randomBytes, randomUUID } from 'node:crypto'
import { isUniqueViolation } from '../session/db'
import { tenantBackendForRequest } from './tenant'
import { canManageMembers, canReadProject, canWriteProject, generateInviteToken, hashInviteToken, isProjectRole } from './projectAcl'

interface ProjectDeps {
  backend: SessionBackend
  /** Optional: when present, member writes verify the user exists. */
  authStore?: AuthStore | null
}

/**
 * The M4 Project API + A4 ACL routes: create, list, read, member management,
 * invite links. Projects are workspace containers for sessions. The routes are
 * token-gated via the pre-auth hook installed in `server.ts` on the gated scope.
 * Unauthenticated (dev) callers bypass ACL; authenticated callers are scoped
 * per project, legacy ownerless projects stay tenant-wide until claimed.
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
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const { name } = request.body
      const id = `proj-${randomUUID()}`
      const project = await tenantCtx.backend.createProject(id, name)
      // first creator becomes owner automatically (A4); dev callers have no identity
      if (request.auth?.userId) {
        await tenantCtx.backend.setProjectMember(id, request.auth.userId, 'owner')
      }
      return reply.code(201).send({ ok: true, project })
    }
  )

  app.get('/projects', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const projects = await tenantCtx.backend.listProjects()
    const userId = request.auth?.userId
    if (!userId) return reply.send({ ok: true, projects })
    // selective sharing: invited-only projects hide from non-members (404 on read,
    // filtered here); legacy ownerless projects stay visible until claimed
    const visible: typeof projects = []
    for (const p of projects) {
      if (await canReadProject(tenantCtx.backend, p.id, userId)) visible.push(p)
    }
    return reply.send({ ok: true, projects: visible })
  })

  app.get<{ Params: { projectId: string } }>('/projects/:projectId', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const project = await tenantCtx.backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    if (!(await canReadProject(tenantCtx.backend, project.id, request.auth?.userId))) {
      return reply.code(404).send({ ok: false, error: 'unknown project' })
    }
    return reply.send({ ok: true, project })
  })

  app.delete<{ Params: { projectId: string } }>(
    '/projects/:projectId',
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const project = await tenantCtx.backend.getProject(request.params.projectId)
      if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
      if (!(await canReadProject(tenantCtx.backend, project.id, request.auth?.userId))) {
        return reply.code(404).send({ ok: false, error: 'unknown project' })
      }
      if (!(await canManageMembers(tenantCtx.backend, project.id, request.auth?.userId))) {
        return reply.code(403).send({ ok: false, error: 'only owners delete project' })
      }
      const deleted = await tenantCtx.backend.deleteProject(request.params.projectId)
      if (!deleted) return reply.code(404).send({ ok: false, error: 'unknown project' })
      return reply.send({ ok: true })
    }
  )

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/members', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const project = await tenantCtx.backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    if (!(await canReadProject(tenantCtx.backend, project.id, request.auth?.userId))) {
      return reply.code(404).send({ ok: false, error: 'unknown project' })
    }
    const members = await tenantCtx.backend.listProjectMembers(project.id)
    return reply.send({ ok: true, members })
  })

  app.put<{ Params: { projectId: string }; Body: { userId?: string; role?: string } }>(
    '/projects/:projectId/members',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['userId', 'role'],
          properties: {
            userId: { type: 'string', minLength: 1, maxLength: 200 },
            role: { type: 'string', enum: ['owner', 'editor', 'viewer'] },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const project = await tenantCtx.backend.getProject(request.params.projectId)
      if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
      if (!(await canReadProject(tenantCtx.backend, project.id, request.auth?.userId))) {
        return reply.code(404).send({ ok: false, error: 'unknown project' })
      }
      const { userId, role } = request.body
      if (!isProjectRole(role)) return reply.code(400).send({ ok: false, error: 'invalid role' })
      // legacy claim: zero members → any tenant member can claim owner on themselves
      const members = await tenantCtx.backend.listProjectMembers(project.id)
      const isLegacyClaim = members.length === 0 && request.auth?.userId === userId && role === 'owner'
      if (!isLegacyClaim && !(await canManageMembers(tenantCtx.backend, project.id, request.auth?.userId))) {
        const self = request.auth?.userId ? await tenantCtx.backend.getProjectMember(project.id, request.auth.userId) : null
        if (!self) return reply.code(404).send({ ok: false, error: 'unknown project' })
        return reply.code(403).send({ ok: false, error: 'only owners manage members' })
      }
      // ghost users can never act, so adding one risks an unmanageable project
      if (deps.authStore && !isLegacyClaim) {
        const exists = await deps.authStore.findUserById(userId!)
        if (!exists) return reply.code(404).send({ ok: false, error: 'unknown user' })
      }
      // guarded write: refuses (and rolls back) when it would strand the
      // project without an owner — atomic, no check-then-write race
      const result = await tenantCtx.backend.setProjectMemberGuarded(project.id, userId!, role)
      if ('error' in result) {
        return reply.code(400).send({ ok: false, error: 'project must keep at least one owner' })
      }
      return reply.send({ ok: true, member: result.member })
    }
  )

  app.post<{ Params: { projectId: string }; Body: { role?: string; expiresInHours?: number } }>(
    '/projects/:projectId/invites',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            role: { type: 'string', enum: ['owner', 'editor', 'viewer'] },
            expiresInHours: { type: 'number', minimum: 1, maximum: 168 },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const project = await tenantCtx.backend.getProject(request.params.projectId)
      if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
      if (!(await canReadProject(tenantCtx.backend, project.id, request.auth?.userId))) {
        return reply.code(404).send({ ok: false, error: 'unknown project' })
      }
      if (!(await canWriteProject(tenantCtx.backend, project.id, request.auth?.userId))) {
        return reply.code(403).send({ ok: false, error: 'viewer cannot invite' })
      }
      const role = request.body.role ?? 'editor'
      if (!isProjectRole(role)) return reply.code(400).send({ ok: false, error: 'invalid role' })
      // editor → owner via a self-dealt link is privilege escalation: only
      // owners mint owner invites
      if (role === 'owner' && !(await canManageMembers(tenantCtx.backend, project.id, request.auth?.userId))) {
        return reply.code(403).send({ ok: false, error: 'only owners invite owners' })
      }
      const token = generateInviteToken()
      const hours = request.body.expiresInHours ?? 24
      // invite ids are 8 random bytes: retry once on the rare PK collision
      let invite = null
      for (let attempt = 0; attempt < 2 && !invite; attempt += 1) {
        try {
          invite = await tenantCtx.backend.createProjectInvite({
            id: `inv-${randomBytes(8).toString('hex')}`,
            projectId: project.id,
            role,
            tokenHash: hashInviteToken(token),
            expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
            createdBy: request.auth?.userId ?? '',
          })
        } catch (err) {
          if (!isUniqueViolation(err) || attempt > 0) throw err
        }
      }
      if (!invite) throw new Error('invite id collision; retry the request')
      // single display of the plaintext token — stored only as a hash
      return reply.code(201).send({ ok: true, invite: { id: invite.id, projectId: invite.projectId, role: invite.role, expiresAt: invite.expiresAt }, token })
    }
  )

  app.post<{ Params: { token: string } }>('/invites/:token/accept', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    if (!request.auth?.userId) return reply.code(401).send({ ok: false, error: 'unauthorized' })
    // atomic single-use consume: exactly one of two concurrent accepts wins
    const accepted = await tenantCtx.backend.acceptProjectInvite(hashInviteToken(request.params.token), request.auth.userId)
    if (!accepted) return reply.code(404).send({ ok: false, error: 'unknown or expired invite' })
    const project = await tenantCtx.backend.getProject(accepted.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown or expired invite' })
    const member = await tenantCtx.backend.getProjectMember(accepted.projectId, request.auth.userId)
    return reply.send({ ok: true, project, member })
  })

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/invites', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const project = await tenantCtx.backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    if (!(await canReadProject(tenantCtx.backend, project.id, request.auth?.userId))) {
      return reply.code(404).send({ ok: false, error: 'unknown project' })
    }
    if (!(await canManageMembers(tenantCtx.backend, project.id, request.auth?.userId))) {
      return reply.code(403).send({ ok: false, error: 'only owners list invites' })
    }
    const invites = await tenantCtx.backend.listProjectInvites(project.id)
    // token hashes stay server-side: only metadata leaves, the secret was
    // shown once at creation
    return reply.send({
      ok: true,
      invites: invites.map((i) => ({ id: i.id, projectId: i.projectId, role: i.role, expiresAt: i.expiresAt, createdBy: i.createdBy })),
    })
  })

  app.delete<{ Params: { projectId: string; inviteId: string } }>('/projects/:projectId/invites/:inviteId', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const project = await tenantCtx.backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    if (!(await canReadProject(tenantCtx.backend, project.id, request.auth?.userId))) {
      return reply.code(404).send({ ok: false, error: 'unknown project' })
    }
    if (!(await canManageMembers(tenantCtx.backend, project.id, request.auth?.userId))) {
      return reply.code(403).send({ ok: false, error: 'only owners revoke invites' })
    }
    const deleted = await tenantCtx.backend.deleteProjectInvite(request.params.inviteId, project.id)
    if (!deleted) return reply.code(404).send({ ok: false, error: 'unknown invite' })
    return reply.send({ ok: true })
  })

  app.delete<{ Params: { projectId: string; userId: string } }>('/projects/:projectId/members/:userId', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const project = await tenantCtx.backend.getProject(request.params.projectId)
    if (!project) return reply.code(404).send({ ok: false, error: 'unknown project' })
    if (!(await canReadProject(tenantCtx.backend, project.id, request.auth?.userId))) {
      return reply.code(404).send({ ok: false, error: 'unknown project' })
    }
    if (!(await canManageMembers(tenantCtx.backend, project.id, request.auth?.userId))) {
      return reply.code(403).send({ ok: false, error: 'only owners manage members' })
    }
    const target = await tenantCtx.backend.getProjectMember(project.id, request.params.userId)
    if (!target) return reply.code(404).send({ ok: false, error: 'unknown member' })
    if (target.role === 'owner') {
      const members = await tenantCtx.backend.listProjectMembers(project.id)
      if (!members.some((m) => m.role === 'owner' && m.userId !== target.userId)) {
        return reply.code(400).send({ ok: false, error: 'project must keep at least one owner' })
      }
    }
    await tenantCtx.backend.removeProjectMember(project.id, target.userId)
    return reply.send({ ok: true })
  })
}
