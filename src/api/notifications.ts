import type { FastifyInstance } from 'fastify'
import type { SessionBackend } from '../session/sessionBackend'
import type { SseHandler } from '../bridge/sseEndpoint'
import { tenantBackendForRequest } from './tenant'

interface NotificationDeps {
  backend: SessionBackend
  sse: SseHandler
}

const MAX_LIST_LIMIT = 100

/**
 * In-app notification surface (Phase B, #175/#176): per-user bells for
 * @mentions, thread replies, and agent approval asks. Auth is mandatory —
 * bells belong to a user, and the dev token gate carries no identity.
 * Cross-user reads report 404 (no oracle), matching project ACL.
 */
export function registerNotificationRoutes(app: FastifyInstance, deps: NotificationDeps): void {
  app.get<{
    Querystring: { unreadOnly?: string; limit?: string; offset?: string }
  }>('/notifications', async (request, reply) => {
    if (!request.auth?.userId) return reply.code(401).send({ ok: false, error: 'unauthorized' })
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const userId = request.auth.userId
    const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10) || 50, 1), MAX_LIST_LIMIT)
    const offset = Math.max(parseInt(request.query.offset ?? '0', 10) || 0, 0)
    const unreadOnly = request.query.unreadOnly === 'true' || request.query.unreadOnly === '1'
    const { notifications, total } = await tenantCtx.backend.listNotifications(userId, { unreadOnly, limit, offset })
    const [unreadCount, unreadBySession] = await Promise.all([
      tenantCtx.backend.countUnread(userId),
      tenantCtx.backend.countUnreadBySession(userId),
    ])
    return reply.send({ ok: true, notifications, total, unreadCount, unreadBySession, limit, offset })
  })

  app.put<{ Params: { id: string } }>('/notifications/:id/read', async (request, reply) => {
    if (!request.auth?.userId) return reply.code(401).send({ ok: false, error: 'unauthorized' })
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    const read = await tenantCtx.backend.markNotificationRead(request.params.id, request.auth.userId)
    if (!read) return reply.code(404).send({ ok: false, error: 'unknown notification' })
    return reply.send({ ok: true })
  })

  // Per-user live bells: same SSE wire, filtered to this user's envelopes.
  app.get('/notifications/stream', (request, reply) => {
    if (!request.auth?.userId) return reply.code(401).send({ ok: false, error: 'unauthorized' })
    const tenantCtx = tenantBackendForRequest(request, deps.backend)
    if (tenantCtx.error) return reply.code(400).send({ ok: false, error: tenantCtx.error })
    reply.hijack()
    deps.sse.handleForUser(request.raw, reply.raw, tenantCtx.tenantId!, request.auth.userId)
  })
}
