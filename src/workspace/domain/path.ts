import { join } from 'node:path'

const SEGMENT = /^[A-Za-z0-9._@+-]+$/

/**
 * Validates one path segment of a workspace binding.
 *
 * @param value - raw tenant or project id supplied by the caller
 * @param label - which binding part failed, used in the error message
 * @returns the segment unchanged when it is safe to join
 * @throws {Error} when the value contains a path separator, is empty, or is
 * a dot-segment (`.` / `..`) that could climb out of the workspace root
 */
function safeSegment(value: string, label: string): string {
  if (!SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(`unsafe workspace ${label}: ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Derives the workspace directory for a project — the binding is never
 * stored: the same tenant + project ids always resolve to the same path
 * under root, and no single id can escape it (ADR-012).
 *
 * @param root - absolute workspace root (e.g. `<dataDir>/workspaces`)
 * @param tenantId - owning tenant; isolates workspaces across tenants
 * @param projectId - project id, e.g. `proj-<uuid>`
 * @returns `<root>/<tenant>/<project>` as a normalized path
 * @throws {Error} when either id is not a safe single path segment
 */
export function workspacePathFor(root: string, tenantId: string, projectId: string): string {
  return join(root, safeSegment(tenantId, 'tenant'), safeSegment(projectId, 'project'))
}
