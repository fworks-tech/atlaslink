import { join } from 'node:path'

const SEGMENT = /^[A-Za-z0-9._@+-]+$/

function safeSegment(value: string, label: string): string {
  if (!SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(`unsafe workspace ${label}: ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * The workspace binding is derived, never stored: the same tenant + project
 * ids always resolve to the same directory under root, and no single id can
 * contain a path separator or dot-segment to climb out of it (ADR-012).
 */
export function workspacePathFor(root: string, tenantId: string, projectId: string): string {
  return join(root, safeSegment(tenantId, 'tenant'), safeSegment(projectId, 'project'))
}
