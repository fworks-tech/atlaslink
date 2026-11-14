import { createHash, randomBytes } from 'node:crypto'
import type { SessionBackend } from '../session/sessionBackend'
import type { ProjectRole } from '../session/types'

export const PROJECT_ROLES: ProjectRole[] = ['owner', 'editor', 'viewer']

export function isProjectRole(value: unknown): value is ProjectRole {
  return value === 'owner' || value === 'editor' || value === 'viewer'
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Read access: legacy (zero members) is tenant-wide; else membership required. */
export async function canReadProject(backend: SessionBackend, projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return true
  const members = await backend.listProjectMembers(projectId)
  if (members.length === 0) return true
  return members.some((m) => m.userId === userId)
}

/** Write access: legacy is tenant-wide; else owner/editor only (viewer read-only). */
export async function canWriteProject(backend: SessionBackend, projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return true
  const members = await backend.listProjectMembers(projectId)
  if (members.length === 0) return true
  return members.some((m) => m.userId === userId && (m.role === 'owner' || m.role === 'editor'))
}

/** Owner-only member management, with legacy claim: zero members → self-claim allowed. */
export async function canManageMembers(backend: SessionBackend, projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return true
  const members = await backend.listProjectMembers(projectId)
  if (members.length === 0) return true
  return members.some((m) => m.userId === userId && m.role === 'owner')
}
