import type { FastifyInstance } from 'fastify'
import { log } from '../log'
import {
  AuthStore,
  generateApiKey,
  generateRandomId,
  hashApiKey,
  hashPassword,
  verifyPassword,
} from '../session/authStore'
import { createToken } from '../session/jwt'
import { DEFAULT_TENANT_ID } from '../session/migrations'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

interface RegisterBody {
  email?: string
  password?: string
  tenantId?: string
}

interface LoginBody {
  email?: string
  password?: string
}

interface RotateKeyBody {
  name?: string
}

/**
 * Auth routes — register, login, API key management. Mounted at /auth.
 * These routes are intentionally NOT behind the auth gate (you cannot
 * authenticate to register or login).
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  authStore: AuthStore
): void {
  app.post<{ Body: RegisterBody }>(
    '/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 254 },
            password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 128 },
            tenantId: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password, tenantId } = request.body

      if (!email || !EMAIL_PATTERN.test(email)) {
        return reply.code(400).send({ ok: false, error: 'invalid email' })
      }

      const existing = await authStore.findUserByEmail(email)
      if (existing) {
        return reply.code(409).send({ ok: false, error: 'email already registered' })
      }

      const passwordHash = await hashPassword(password!)
      const user = await authStore.createUser({
        id: generateRandomId(),
        email: email.toLowerCase(),
        passwordHash,
        tenantId: tenantId ?? DEFAULT_TENANT_ID,
      })

      const token = createToken(user.id, user.tenant_id)
      log.info('user registered', { userId: user.id, email: user.email })

      return reply.code(201).send({
        ok: true,
        token,
        user: { id: user.id, email: user.email, tenant_id: user.tenant_id },
      })
    }
  )

  app.post<{ Body: LoginBody }>(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 254 },
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body

      const user = await authStore.findUserByEmail(email!.toLowerCase())
      if (!user) {
        return reply.code(401).send({ ok: false, error: 'invalid credentials' })
      }

      const valid = await verifyPassword(password!, user.password_hash)
      if (!valid) {
        return reply.code(401).send({ ok: false, error: 'invalid credentials' })
      }

      const token = createToken(user.id, user.tenant_id)
      log.info('user logged in', { userId: user.id })

      return reply.send({
        ok: true,
        token,
        user: { id: user.id, email: user.email, tenant_id: user.tenant_id },
      })
    }
  )

  app.post<{ Body: RotateKeyBody }>(
    '/auth/keys',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth
      if (!auth) {
        return reply.code(401).send({ ok: false, error: 'unauthorized' })
      }

      const plaintext = generateApiKey()
      const keyHash = hashApiKey(plaintext)
      const apiKey = await authStore.createApiKey({
        id: generateRandomId(),
        userId: auth.userId,
        keyHash,
        name: request.body.name ?? 'API key',
        tenantId: auth.tenantId,
      })

      log.info('api key created', { userId: auth.userId, keyId: apiKey.id })

      return reply.code(201).send({
        ok: true,
        key: plaintext,
        id: apiKey.id,
        name: apiKey.name,
        created_at: apiKey.created_at,
      })
    }
  )

  app.get(
    '/auth/keys',
    async (request, reply) => {
      const auth = request.auth
      if (!auth) {
        return reply.code(401).send({ ok: false, error: 'unauthorized' })
      }

      const keys = await authStore.listApiKeysForUser(auth.userId)
      return reply.send({
        ok: true,
        keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          created_at: k.created_at,
          last_used_at: k.last_used_at,
        })),
      })
    }
  )

  app.delete<{ Params: { keyId: string } }>(
    '/auth/keys/:keyId',
    async (request, reply) => {
      const auth = request.auth
      if (!auth) {
        return reply.code(401).send({ ok: false, error: 'unauthorized' })
      }

      const deleted = await authStore.deleteApiKey(request.params.keyId, auth.userId)
      if (!deleted) {
        return reply.code(404).send({ ok: false, error: 'key not found' })
      }

      log.info('api key revoked', { userId: auth.userId, keyId: request.params.keyId })
      return reply.send({ ok: true })
    }
  )

  app.get(
    '/auth/me',
    async (request, reply) => {
      const auth = request.auth
      if (!auth) {
        return reply.code(401).send({ ok: false, error: 'unauthorized' })
      }

      const user = await authStore.findUserById(auth.userId)
      if (!user) {
        return reply.code(404).send({ ok: false, error: 'user not found' })
      }

      return reply.send({
        ok: true,
        user: { id: user.id, email: user.email, tenant_id: user.tenant_id },
      })
    }
  )
}
