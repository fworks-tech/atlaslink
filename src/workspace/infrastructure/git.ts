import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { withWorkspaceLock } from './lock'

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 10 * 1024 * 1024

const IDENTITY_FLAGS = ['-c', 'user.name=atlaslink', '-c', 'user.email=atlaslink@localhost']
const COMMIT_REV = /^(HEAD|[0-9a-f]{7,40})$/i

interface GitOptions {
  /** Append fixed committer identity flags so commits never depend on ambient git config. */
  identity?: boolean
  /** Return stdout verbatim (needed for file content and diffs) instead of trimmed. */
  raw?: boolean
}

/**
 * Runs one git subcommand against a repository via argv array — never a
 * shell — so no argument can be reinterpreted as a shell metacharacter.
 *
 * @param repo - repository path passed to `git -C`
 * @param args - subcommand and its arguments, e.g. `['commit', '-m', msg]`
 * @param opts - see {@link GitOptions}
 * @returns stdout, trimmed unless `opts.raw` is set
 * @throws {Error} carrying git's stderr on any non-zero exit, or when the
 * `git` binary is not installed (ENOENT)
 */
async function git(repo: string, args: string[], opts: GitOptions = {}): Promise<string> {
  const flags = opts.identity ? IDENTITY_FLAGS : []
  const { stdout } = await execFileAsync('git', ['-C', repo, ...flags, ...args], { maxBuffer: MAX_BUFFER })
  return opts.raw ? stdout : stdout.trim()
}

/**
 * Validates a repository-relative path before it is interpolated into a
 * `git show <rev>:<path>` revision string.
 *
 * @param path - candidate path inside the workspace
 * @returns the path unchanged when it cannot escape the repository
 * @throws {Error} when the path is empty, absolute, Windows-qualified, or
 * contains `.`/`..`/empty segments
 */
function safeRepoPath(path: string): string {
  const segments = path.split('/')
  if (!path || path.startsWith('/') || path.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`unsafe repo path: ${JSON.stringify(path)}`)
  }
  return path
}

/**
 * Validates a revision argument before it reaches git's revision parser,
 * keeping `rev` free of range/option syntax (`~`, `..`, `-`, refspecs).
 *
 * @param rev - candidate revision: `HEAD` or a 7-40 character hex sha
 * @returns the revision unchanged when safe
 * @throws {Error} when the value is not a plain commit reference
 */
function safeRev(rev: string): string {
  if (!COMMIT_REV.test(rev)) throw new Error(`unsafe commit ref: ${JSON.stringify(rev)}`)
  return rev
}

/**
 * Reports whether HEAD resolves — i.e. the repository has at least one
 * commit (false on a freshly initialized, still-unborn branch).
 *
 * @param repo - repository to probe
 * @returns `true` when `git rev-parse --verify HEAD` succeeds
 */
async function hasHead(repo: string): Promise<boolean> {
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/**
 * Idempotent: creates the directory, initializes the repository, and records
 * one empty baseline commit so HEAD is always readable. Lazy by design —
 * called on first use, not at project creation, so auto-created projects
 * (inbox) never spawn repositories they do not use.
 *
 * @param repo - absolute workspace path (derive via `workspacePathFor`)
 * @returns resolves once the repository exists with a readable HEAD
 * @throws whatever git reports if init or the baseline commit fails
 */
export async function ensureWorkspace(repo: string): Promise<void> {
  await withWorkspaceLock(repo, async () => {
    mkdirSync(repo, { recursive: true })
    if (!existsSync(join(repo, '.git'))) await git(repo, ['init'])
    if (await hasHead(repo)) return
    await git(repo, ['commit', '--allow-empty', '-m', 'chore: initialize workspace'], { identity: true })
  })
}

/**
 * Commits everything currently written in the workspace as one change,
 * attributed via a `session: <id>` trailer so git history and the session
 * event log join on the same id (ADR-012). Runs under the per-workspace
 * lock and initializes the repository first if needed.
 *
 * @param repo - absolute workspace path (derive via `workspacePathFor`)
 * @param opts - commit intent: `message` (subject/body) and optional
 * `sessionId` attribution trailer
 * @returns the new commit sha; the current HEAD sha when nothing changed
 * @throws {Error} when the message is blank or `sessionId` contains a
 * newline (trailer injection); git errors propagate for init/commit failures
 */
export async function commitAll(repo: string, opts: { message: string; sessionId?: string }): Promise<string> {
  if (!opts.message.trim()) throw new Error('commit message must not be empty')
  if (opts.sessionId && /[\r\n]/.test(opts.sessionId)) throw new Error('sessionId must be a single line')
  return await withWorkspaceLock(repo, async () => {
    await ensureWorkspace(repo)
    await git(repo, ['add', '-A'])
    if (!(await git(repo, ['status', '--porcelain']))) return await git(repo, ['rev-parse', 'HEAD'])
    const message = opts.sessionId ? `${opts.message}\n\nsession: ${opts.sessionId}` : opts.message
    await git(repo, ['commit', '-m', message], { identity: true })
    return await git(repo, ['rev-parse', 'HEAD'])
  })
}

/**
 * Reads file content exactly as it exists at a pinned commit, independent
 * of what later writes did to the working tree.
 *
 * @param repo - absolute workspace path
 * @param commit - `HEAD` or a plain hex sha (validated, see `safeRev`)
 * @param path - repository-relative path (validated, see `safeRepoPath`)
 * @returns the blob content verbatim, or `null` when the path is absent at
 * that commit (also `null` on other git failures — callers on new read
 * surfaces should distinguish infra errors, see #296)
 * @throws {Error} when `commit` or `path` fail validation before git runs
 */
export async function readAt(repo: string, commit: string, path: string): Promise<string | null> {
  safeRev(commit)
  const rel = safeRepoPath(path)
  try {
    return await git(repo, ['show', `${commit}:${rel}`], { raw: true })
  } catch {
    return null
  }
}

/**
 * Produces the text diff between two revisions — the review artifact a
 * human or harness reads to judge what a session changed.
 *
 * @param repo - absolute workspace path
 * @param from - base revision (`HEAD` or hex sha, validated)
 * @param to - target revision (`HEAD` or hex sha, validated)
 * @returns unified diff text, verbatim from git
 * @throws {Error} when either revision fails validation, or git itself fails
 * (e.g. unknown sha)
 */
export async function diff(repo: string, from: string, to: string): Promise<string> {
  safeRev(from)
  safeRev(to)
  return await git(repo, ['diff', from, to], { raw: true })
}
