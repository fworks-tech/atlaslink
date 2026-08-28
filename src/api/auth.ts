import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { log } from '../log'

/** Constant-time token comparison so the pre-auth gate leaks nothing via timing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Pre-auth baseline for the account-facing surface (m3 spec §7, ADR-006
 * Decision 7). When `ATLASLINK_API_TOKEN` is set, every task-rest route and the
 * per-session event stream require `Authorization: Bearer <token>`; otherwise
 * they are 401. When unset the API is unauthenticated — logged once at boot so
 * the operator knows not to expose it cross-host (loopback remains the default).
 */
export function registerTokenGate(app: FastifyInstance): void {
  const token = process.env.ATLASLINK_API_TOKEN
  if (!token) {
    log.warn('API is unauthenticated: ATLASLINK_API_TOKEN is unset; do not expose this host beyond loopback')
    return
  }

  app.addHook('preHandler', (request, reply, done) => {
    const header = request.headers.authorization
    if (typeof header === 'string' && safeEqual(header, `Bearer ${token}`)) {
      done()
      return
    }
    reply.code(401).send({ ok: false, error: 'unauthorized' })
  })
}