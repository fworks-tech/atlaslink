import { randomUUID } from 'node:crypto'
import type { SessionBackend } from '../session/sessionBackend'
import type { Session as AggregateSession, NotificationKind } from '../session/types'
import type { BridgeEnvelope } from '../bridge/EventLogStore'
import { canReadProject } from './projectAcl'

/** Mention → user-id resolution, tenant-scoped by the caller. Best-effort: unknown mentions are dropped, never errors. */
export interface MentionDirectory {
  resolveUserId(tenantId: string, mention: string): Promise<string | null>
}

/** Distinct human authors already present in a session's interaction. */
export function threadParticipantIds(session: AggregateSession, exclude?: string): string[] {
  const ids: string[] = []
  for (const turn of session.interaction) {
    const author = turn.authorId
    if (typeof author === 'string' && author.length > 0 && author !== exclude && !ids.includes(author)) {
      ids.push(author)
    }
  }
  return ids
}

/**
 * Best-effort notification fan-out after a committed chat/approval write.
 * The chat commit is truth; a notification failure only loses a bell badge,
 * so every row write and emit is guarded and the call never rejects.
 */
export async function fanoutNotifications(
  deps: { backend: SessionBackend; broadcaster: { emit: (envelope: BridgeEnvelope) => void } },
  args: { session: AggregateSession; userIds: Map<string, NotificationKind>; excerpt: string }
): Promise<void> {
  const tenantId = args.session.tenantId
  for (const [userId, kind] of args.userIds) {
    try {
      // selective sharing extends to bells: a mentioned non-member gets
      // nothing (and learns nothing — the 404 rule already hides the session)
      if (args.session.projectId && !(await canReadProject(deps.backend, args.session.projectId, userId))) continue
      const notification = await deps.backend.createNotification({
        id: `notif-${randomUUID()}`,
        userId,
        sessionId: args.session.sessionId,
        kind,
        excerpt: args.excerpt,
      })
      try {
        // ephemeral like typing: no eventId, so it never disturbs Last-Event-ID resume
        deps.broadcaster.emit({
          type: 'notification.created',
          notification,
          userId,
          ...(tenantId !== undefined ? { tenantId } : {}),
        })
      } catch {
        // row persisted; live delivery is a bonus
      }
    } catch {
      // best-effort; the chat commit already succeeded
    }
  }
}

/** Recipients for a chat message: resolved mentions (kind mention) + thread participants on parentId replies. */
export async function recipientsForMessage(
  backend: SessionBackend,
  session: AggregateSession,
  opts: { authorId?: string; mentions?: string[]; parentId?: string; directory?: MentionDirectory }
): Promise<Map<string, NotificationKind>> {
  const recipients = new Map<string, NotificationKind>()
  if (opts.mentions !== undefined && opts.directory !== undefined) {
    const tenantId = session.tenantId
    for (const mention of opts.mentions) {
      if (tenantId === undefined) break
      const userId = await opts.directory.resolveUserId(tenantId, mention).catch(() => null)
      if (userId === null || userId === opts.authorId || recipients.has(userId)) continue
      recipients.set(userId, 'mention')
    }
  }
  if (opts.parentId !== undefined) {
    for (const id of threadParticipantIds(session, opts.authorId)) {
      if (!recipients.has(id)) recipients.set(id, 'reply')
    }
  }
  return recipients
}
