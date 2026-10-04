import {
  applySessionWrite,
  commitAll,
  isSafeRepoPath,
  workspacePathFor,
} from '../workspace'

/** Opening fence a session uses to hand one file to the executor (#301). */
const FENCE_OPEN = '```atlaslink:write path='

/** One file the session asks the executor to persist in its workspace. */
export interface WorkspaceWrite {
  /** Repository-relative path inside the session's project workspace. */
  path: string
  /** Verbatim file body between the fences. */
  content: string
}

/**
 * Extracts `atlaslink:write` fenced blocks from a session's output — the
 * channel members use to deliver files without touching disk themselves
 * (ADR-012: the executor is the writer, under the workspace lock). Fences
 * with unsafe paths or no closing fence are dropped, never partially applied.
 *
 * @param output - final session output (untrusted model text)
 * @returns every well-formed write, in document order; empty when none
 */
export function parseWorkspaceWrites(output: string): WorkspaceWrite[] {
  const writes: WorkspaceWrite[] = []
  const lines = output.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(FENCE_OPEN)) continue
    const path = lines[i].slice(FENCE_OPEN.length).trim()
    const content: string[] = []
    let closed = false
    for (i++; i < lines.length; i++) {
      if (lines[i] === '```') {
        closed = true
        break
      }
      content.push(lines[i])
    }
    if (closed && isSafeRepoPath(path)) writes.push({ path, content: content.join('\n') })
  }
  return writes
}

/**
 * Pins the workspace to the run's outcome after every terminal session:
 * fenced writes are applied as one attributed commit, and stray working-tree
 * dirt (e.g. a member's direct tool write) is committed the same way, so a
 * failed run stays traceable to an exact commit (ADR-012, #301). Sessions
 * without a project binding have no workspace and are skipped.
 *
 * @param params - workspace root, tenant/project binding, run identity and output
 * @returns the commit sha, or `undefined` when the session has no project
 * @throws whatever the workspace lock/git layer reports (callers log and continue)
 */
export async function finalizeWorkspace(params: {
  workspaceRoot: string
  tenantId: string
  projectId: string | undefined
  sessionId: string
  status: string
  member: string
  output: string | undefined
}): Promise<string | undefined> {
  if (params.projectId === undefined) return undefined
  const repo = workspacePathFor(params.workspaceRoot, params.tenantId, params.projectId)
  const writes = parseWorkspaceWrites(params.output ?? '')
  const intent =
    writes.length > 0
      ? `apply ${writes.length} file write(s) from ${params.member}`
      : `checkpoint ${params.member} run (${params.status})`
  if (writes.length > 0) return await applySessionWrite(repo, writes, { message: intent, sessionId: params.sessionId })
  return await commitAll(repo, { message: intent, sessionId: params.sessionId })
}
