import type { FastifyInstance } from 'fastify'
import { getMemberNames } from 'agenthood'
import { isKnownMember } from '../members'
import type { SessionBackend } from '../session/sessionBackend'
import { isUniqueViolation } from '../session/db'
import { tenantBackendForRequest } from './tenant'

interface AgentDeps {
  backend: SessionBackend
}

const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/
const MAX_PERSONA_LENGTH = 4000
const MAX_FIELD_LENGTH = 200

/**
 * Tenant-owned custom agents (Phase C): persona overlays executed as a
 * built-in base member. Creation bakes the persona into the session prompt;
 * the run maps the custom name back to its base member, so sessions, costs,
 * and threads keep the custom identity while the agenthood runtime only ever
 * sees canonical members. Deleting an agent fails its queued sessions loudly
 * at run start (unknown member); in-flight runs already resolved their base
 * member and keep working.
 */
export function registerAgentRoutes(app: FastifyInstance, deps: AgentDeps): void {
  app.get('/agents', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const agents = await tenantCtx.backend.listAgents()
    return reply.send({ ok: true, builtIn: getMemberNames(), agents })
  })

  app.get<{ Params: { name: string } }>('/agents/:name', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const agent = await tenantCtx.backend.getAgent(request.params.name)
    if (!agent) return reply.code(404).send({ ok: false, error: 'unknown agent' })
    return reply.send({ ok: true, agent })
  })

  app.post<{
    Body: { name?: string; displayName?: string; persona?: string; baseMember?: string; provider?: string; model?: string }
  }>(
    '/agents',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'persona', 'baseMember'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 64 },
            displayName: { type: 'string', minLength: 1, maxLength: 200 },
            persona: { type: 'string', minLength: 1, maxLength: MAX_PERSONA_LENGTH },
            baseMember: { type: 'string', minLength: 1, maxLength: 200 },
            provider: { type: 'string', minLength: 1, maxLength: MAX_FIELD_LENGTH },
            model: { type: 'string', minLength: 1, maxLength: MAX_FIELD_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const { name, displayName, persona, baseMember, provider, model } = request.body
      if (!NAME_PATTERN.test(name!)) {
        return reply.code(400).send({ ok: false, error: 'name must be lowercase alphanumeric with dashes' })
      }
      if (!isKnownMember(baseMember!)) {
        return reply.code(400).send({ ok: false, error: `unknown base member '${baseMember}'` })
      }
      // alias names count as shadows: a custom `the-builder` would win over
      // the runtime's legacy alias resolution for every legacy caller.
      if (isKnownMember(name!)) {
        return reply.code(409).send({ ok: false, error: `name '${name}' shadows a built-in member` })
      }
      try {
        const agent = await tenantCtx.backend.createAgent({
          name: name!,
          ...(displayName !== undefined ? { displayName } : {}),
          persona: persona!,
          baseMember: baseMember!,
          ...(provider !== undefined ? { provider } : {}),
          ...(model !== undefined ? { model } : {}),
        })
        return reply.code(201).send({ ok: true, agent })
      } catch (err) {
        if (isUniqueViolation(err) || (err instanceof Error && err.message.includes('already exists'))) {
          return reply.code(409).send({ ok: false, error: `agent '${name}' already exists` })
        }
        throw err
      }
    }
  )

  app.put<{
    Params: { name: string }
    Body: { displayName?: string; persona?: string; baseMember?: string; provider?: string; model?: string }
  }>(
    '/agents/:name',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 200 },
            persona: { type: 'string', minLength: 1, maxLength: MAX_PERSONA_LENGTH },
            baseMember: { type: 'string', minLength: 1, maxLength: 200 },
            provider: { type: 'string', minLength: 1, maxLength: MAX_FIELD_LENGTH },
            model: { type: 'string', minLength: 1, maxLength: MAX_FIELD_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantCtx = tenantBackendForRequest(request, deps.backend)
      if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
      const { baseMember } = request.body
      if (baseMember !== undefined && !isKnownMember(baseMember)) {
        return reply.code(400).send({ ok: false, error: `unknown base member '${baseMember}'` })
      }
      const agent = await tenantCtx.backend.updateAgent(request.params.name, request.body)
      if (!agent) return reply.code(404).send({ ok: false, error: 'unknown agent' })
      return reply.send({ ok: true, agent })
    }
  )

  app.delete<{ Params: { name: string } }>('/agents/:name', async (request, reply) => {
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const deleted = await tenantCtx.backend.deleteAgent(request.params.name)
    if (!deleted) return reply.code(404).send({ ok: false, error: 'unknown agent' })
    return reply.send({ ok: true })
  })
}
