import {
  applySessionWrite,
  commitAll,
  isSafeRepoPath,
  workspacePathFor,
} from '../workspace'

/** Fence opener a session uses to hand one file to the executor (#301). */
const FENCE_OPEN = /^(`{3,})atlaslink:write path=(.*)$/

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
 * (ADR-012: the executor is the writer, under the workspace lock).
 *
 * CommonMark-consistent: the closer is the opener's backtick run alone, so
 * content may embed deeper fences (wrap in four backticks when the file
 * itself contains ```); CRLF output is tolerated; an unclosed fence is
 * dropped and rescanned so later fences are never swallowed; fences with
 * unsafe paths (absolute, `..`, `.git`, backslashes) are dropped whole.
 *
 * @param output - final session output (untrusted model text)
 * @returns every well-formed write, in document order; empty when none
 */
export function parseWorkspaceWrites(output: string): WorkspaceWrite[] {
  const lines = output.split(/\r?\n/)
  const writes: WorkspaceWrite[] = []
  let i = 0
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i])
    if (!open) {
      i++
      continue
    }
    const closer = '`'.repeat(open[1].length)
    const path = open[2].trim()
    const content: string[] = []
    let j = i + 1
    // stop at the closer or at another opener: a block that never closed must
    // not swallow the fences after it (they rescan as fresh blocks below)
    while (j < lines.length && lines[j] !== closer && !FENCE_OPEN.test(lines[j])) {
      content.push(lines[j])
      j++
    }
    const closed = j < lines.length && lines[j] === closer
    if (closed && isSafeRepoPath(path)) writes.push({ path, content: content.join('\n') })
    i = closed ? j + 1 : i + 1
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
