import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { log } from '../log'
import { hashApiKey } from '../session/authStore'
import { verifyJwt } from '../session/jwt'
import { DEFAULT_TENANT_ID } from '../session/migrations'

export interface AuthContext {
  userId: string
  tenantId: string
  kind: 'jwt' | 'api_key' | 'legacy'
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

/** Constant-time token comparison so the pre-auth gate leaks nothing via timing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    // Avoid length oracle: still invoke timingSafeEqual on equal-length buffers
    // so the early-return timing does not reveal the expected length. Use a
    // dummy of the same shape as `right` when lengths differ.
    const dummy = Buffer.alloc(right.length)
    try {
      timingSafeEqual(dummy, right)
    } catch {
      /* ignore — dummy compare is only for timing */
    }
    return false
  }
  return timingSafeEqual(left, right)
}

/** Hostnames that are loopback-equivalent; anything else is a cross-host bind. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/**
 * Shared bearer check for HTTP and WS ingress. Browsers cannot set headers
 * on a WebSocket upgrade, so the room channel accepts the same bearer as a
 * `?token=` query — compared constant-time either way, and never logged
 * (the reject trail below records the pathname only for exactly this reason).
 * Query bearers are honored ONLY on the room upgrade path (see gate below);
 * every HTTP route stays header-only.
 *
 * The expected bearer is a parameter, not ambient env: callers pass the
 * registration-time token because request-time env is unreliable (test
 * harnesses scope it to boot; only the daemon holds it for life).
 */
export function checkBearer(
  authorization: unknown,
  queryToken: unknown,
  expected: string | undefined = process.env.ATLASLINK_API_TOKEN
): boolean {
  if (!expected) return true
  if (typeof authorization === 'string' && safeEqual(authorization, `Bearer ${expected}`)) return true
  if (typeof queryToken === 'string' && safeEqual(queryToken, expected)) return true
  return false
}

/** Room upgrades are the one path that may carry the bearer in the query. */
const ROOM_UPGRADE_PATTERN = /^\/sessions\/[^/]+\/room$/

function roomUpgradeToken(request: {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  query?: unknown
}): string | undefined {
  const upgrade = request.headers.upgrade
  const header = Array.isArray(upgrade) ? upgrade[0] : upgrade
  if (request.method !== 'GET' || typeof header !== 'string' || header.toLowerCase() !== 'websocket') {
    return undefined
  }
  if (!ROOM_UPGRADE_PATTERN.test(request.url.split('?')[0] ?? '')) return undefined
  const token = (request.query as { token?: unknown } | undefined)?.token
  return typeof token === 'string' ? token : undefined
}

/**
 * Pre-auth baseline for the account-facing surface (m3 spec §7, ADR-006
 * Decision 7). When `ATLASLINK_API_TOKEN` is set, every task-rest route and the
 * per-session event stream require `Authorization: Bearer <token>`; otherwise
 * they are 401. When unset the API is unauthenticated — refusenik for a
 * non-loopback bind (a cost-bearing surface must not go live unauthenticated,
 * fail-closed), else logged once at boot so the operator knows the boundary.
 */
export function registerTokenGate(app: FastifyInstance, opts?: { bindHost?: string }): void {
  const token = process.env.ATLASLINK_API_TOKEN
  const bindHost = opts?.bindHost
  if (!token) {
    if (bindHost !== undefined && !LOOPBACK_HOSTS.has(bindHost.toLowerCase())) {
      throw new Error(
        `refusing to start: ATLASLINK_API_TOKEN must be set when binding ${bindHost} (the M3 task API would be unauthenticated and cost-bearing)`
      )
    }
    log.warn('API is unauthenticated: ATLASLINK_API_TOKEN is unset; do not expose this host beyond loopback')
    return
  }

  app.addHook('preHandler', (request, reply, done) => {
    // HTTP routes stay header-only; a WS room upgrade may carry the same
    // bearer as ?token= (browsers cannot set upgrade headers) — and only there.
    // `token` is the registration-time capture, not request-time env.
    if (checkBearer(request.headers.authorization, roomUpgradeToken(request), token)) {
      done()
      return
    }
    // Security audit trail: every rejection is observable (rate-limited at the
    // source), never the credential itself — the token must not reach the log,
    // so only the pathname is recorded (a WS ?token= query would leak here).
    const pathname = request.url.split('?')[0]
    log.warn('auth rejected', { url: pathname, ip: request.ip, status: 401 })
    reply.code(401).send({ ok: false, error: 'unauthorized' })
  })
}

/**
 * Extracts the bearer token from the Authorization header. Returns null if
 * the header is missing or not a Bearer scheme.
 */
function extractBearer(request: FastifyRequest): string | null {
  const auth = request.headers.authorization
  if (typeof auth !== 'string') return null
  if (!auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

/**
 * Resolves auth context from a bearer token. Tries JWT first, then API key
 * lookup, then legacy shared token. Returns null if no valid auth is found.
 *
 * The auth store is passed in so the gate can be wired to the same Db-backed
 * store the rest of the server uses (test harnesses can inject a fresh store).
 */
export async function resolveAuth(
  token: string,
  authStore: {
    findApiKeyByKeyHash: (hash: string) => Promise<{ id: string; user_id: string; tenant_id: string } | null>
    touchApiKey: (id: string) => Promise<void>
  }
): Promise<AuthContext | null> {
  const claims = verifyJwt(token)
  if (claims) {
    return { userId: claims.sub, tenantId: claims.tenant, kind: 'jwt' }
  }

  const keyHash = hashApiKey(token)
  const apiKey = await authStore.findApiKeyByKeyHash(keyHash)
  if (apiKey) {
    // Fire-and-forget — do not block the request on the update.
    authStore.touchApiKey(apiKey.id).catch(() => {})
    return { userId: apiKey.user_id, tenantId: apiKey.tenant_id, kind: 'api_key' }
  }

  const legacyToken = process.env.ATLASLINK_API_TOKEN
  if (legacyToken && safeEqual(token, legacyToken)) {
    return { userId: 'system', tenantId: DEFAULT_TENANT_ID, kind: 'legacy' }
  }

  return null
}

/**
 * New auth gate that supports JWT sessions, API keys, and the legacy shared
 * bearer token. Replaces `registerTokenGate` for deployments that have
 * migrated to per-user auth (ADR-008).
 *
 * When neither `ATLASLINK_JWT_SECRET` nor `ATLASLINK_API_TOKEN` is set, the
 * gate is a no-op on loopback binds and refuses to start on non-loopback
 * (fail-closed, same as the legacy gate).
 */
export function registerAuthGate(
  app: FastifyInstance,
  authStore: {
    findApiKeyByKeyHash: (hash: string) => Promise<{ id: string; user_id: string; tenant_id: string } | null>
    touchApiKey: (id: string) => Promise<void>
  },
  opts?: { bindHost?: string }
): void {
  const jwtSecret = process.env.ATLASLINK_JWT_SECRET
  const legacyToken = process.env.ATLASLINK_API_TOKEN
  const bindHost = opts?.bindHost

  if (!jwtSecret && !legacyToken) {
    if (bindHost !== undefined && !LOOPBACK_HOSTS.has(bindHost.toLowerCase())) {
      throw new Error(
        `refusing to start: ATLASLINK_JWT_SECRET or ATLASLINK_API_TOKEN must be set when binding ${bindHost}`
      )
    }
    log.warn('API is unauthenticated: neither ATLASLINK_JWT_SECRET nor ATLASLINK_API_TOKEN is set')
    return
  }

  app.addHook('preHandler', async (request, reply) => {
    const token = extractBearer(request)
    if (!token) {
      // WS room upgrade may carry the bearer as ?token=
      const roomToken = roomUpgradeToken(request)
      if (roomToken) {
        const ctx = await resolveAuth(roomToken, authStore)
        if (ctx) {
          request.auth = ctx
          return
        }
      }
      const pathname = request.url.split('?')[0]
      log.warn('auth rejected', { url: pathname, ip: request.ip, status: 401 })
      reply.code(401).send({ ok: false, error: 'unauthorized' })
      return
    }

    const ctx = await resolveAuth(token, authStore)
    if (ctx) {
      request.auth = ctx
      return
    }

    const pathname = request.url.split('?')[0]
    log.warn('auth rejected', { url: pathname, ip: request.ip, status: 401 })
    reply.code(401).send({ ok: false, error: 'unauthorized' })
  })
}