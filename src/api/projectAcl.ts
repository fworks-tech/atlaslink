import { createHash, randomBytes } from 'node:crypto'
import type { SessionBackend } from '../session/sessionBackend'
import type { ProjectRole } from '../session/types'

export function isProjectRole(value: unknown): value is ProjectRole {
  return value === 'owner' || value === 'editor' || value === 'viewer'
}

/** Read access: legacy (zero members) is tenant-wide; else membership required. */
export async function canReadProject(backend: SessionBackend, projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return true
  if (await backend.getProjectMember(projectId, userId)) return true
  // Single-row miss: legacy project (zero members) or non-member. One list
  // distinguishes them; empty means tenant-wide legacy.
  return (await backend.listProjectMembers(projectId)).length === 0
}

/** Write access: legacy is tenant-wide; else owner/editor only (viewer read-only). */
export async function canWriteProject(backend: SessionBackend, projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return true
  const self = await backend.getProjectMember(projectId, userId)
  if (self) return self.role === 'owner' || self.role === 'editor'
  return (await backend.listProjectMembers(projectId)).length === 0
}

/** Owner-only member management, with legacy claim: zero members → self-claim allowed. */
export async function canManageMembers(backend: SessionBackend, projectId: string, userId?: string): Promise<boolean> {
  if (!userId) return true
  const self = await backend.getProjectMember(projectId, userId)
  if (self) return self.role === 'owner'
  return (await backend.listProjectMembers(projectId)).length === 0
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}
