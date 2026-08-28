import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { log } from '../log'

/** Constant-time token comparison so the pre-auth gate leaks nothing via timing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Hostnames that are loopback-equivalent; anything else is a cross-host bind. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

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
    const header = request.headers.authorization
    if (typeof header === 'string' && safeEqual(header, `Bearer ${token}`)) {
      done()
      return
    }
    // Security audit trail: every rejection is observable (rate-limited at the
    // source), never the header itself — the token must not reach the log.
    log.warn('auth rejected', { url: request.url, ip: request.ip, status: 401 })
    reply.code(401).send({ ok: false, error: 'unauthorized' })
  })
}