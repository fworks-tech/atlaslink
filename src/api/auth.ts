import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { log } from '../log'

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
 */
export function checkBearer(authorization: unknown, queryToken: unknown): boolean {
  const token = process.env.ATLASLINK_API_TOKEN
  if (!token) return true
  if (typeof authorization === 'string' && safeEqual(authorization, `Bearer ${token}`)) return true
  if (typeof queryToken === 'string' && safeEqual(queryToken, token)) return true
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
    if (checkBearer(request.headers.authorization, roomUpgradeToken(request))) {
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