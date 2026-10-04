import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
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
 * Reports whether a path is a safe repository-relative file path — the rule
 * shared by read/revision validation and by the executor's parse of untrusted
 * session output before any write reaches the workspace.
 *
 * @param path - candidate path inside the workspace
 * @returns true when the path is non-empty, relative, and free of
 * `.`/`..`/empty segments, backslashes, or `.git` segments (writing git
 * metadata would let untrusted output register hooks)
 */
export function isSafeRepoPath(path: string): boolean {
  const segments = path.split('/')
  return (
    Boolean(path) &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !segments.some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git')
  )
}

/**
 * Reports whether a path looks like credentials — refusing the write keeps
 * secrets out of the workspace's immutable history, where ADR-012 forbids
 * the destructive scrub that would otherwise be needed.
 *
 * @param path - candidate workspace-relative path
 * @returns true for dotenv files, private keys, and ssh material
 */
function isSecretShapedPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.pem')) return true
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(base)) return true
  return path.split('/').some((s) => s.toLowerCase() === '.ssh')
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
  if (!isSafeRepoPath(path)) throw new Error(`unsafe repo path: ${JSON.stringify(path)}`)
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
/** Credential patterns seeded as the workspace's .gitignore — keeps secrets out of every commit path (#301 review). */
const GITIGNORE_SEED = ['.env', '.env.*', '*.pem', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*', '.ssh/', ''].join('\n')

export async function ensureWorkspace(repo: string): Promise<void> {
  await withWorkspaceLock(repo, async () => {
    mkdirSync(repo, { recursive: true })
    if (!existsSync(join(repo, '.git'))) await git(repo, ['init'])
    const gitignore = join(repo, '.gitignore')
    if (!existsSync(gitignore)) writeFileSync(gitignore, GITIGNORE_SEED, 'utf8')
    if (await hasHead(repo)) return
    await git(repo, ['add', '.gitignore'])
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
 * Applies a session's file writes as one locked batch: every file lands in
 * the working tree and the whole batch becomes a single commit carrying the
 * `session: <id>` attribution trailer, so git history and the session event
 * log join on the same id (ADR-012). Reentrant over {@link commitAll}'s own
 * lock acquisition.
 *
 * @param repo - absolute workspace path (derive via `workspacePathFor`)
 * @param writes - files to create or overwrite; repository-relative paths
 * @param opts - commit `message` and optional `sessionId` attribution trailer
 * @returns the new commit sha; the current HEAD sha when nothing changed
 * @throws {Error} when the batch is empty, a path fails `safeRepoPath`, or
 * git fails (message/sessionId rules are {@link commitAll}'s)
 */
export async function applySessionWrite(
  repo: string,
  writes: { path: string; content: string }[],
  opts: { message: string; sessionId?: string }
): Promise<string> {
  if (writes.length === 0) throw new Error('applySessionWrite requires at least one write')
  for (const write of writes) {
    safeRepoPath(write.path)
    if (isSecretShapedPath(write.path)) {
      throw new Error(`refusing credential-shaped path: ${JSON.stringify(write.path)}`)
    }
  }
  return await withWorkspaceLock(repo, async () => {
    await ensureWorkspace(repo)
    const root = realpathSync(repo)
    for (const write of writes) {
      const target = join(repo, write.path)
      const parent = dirname(target)
      mkdirSync(parent, { recursive: true })
      // mkdir traverses a symlinked directory component, so re-resolve the
      // parent after creation and refuse anything that left the workspace
      const resolvedParent = realpathSync(parent)
      if (resolvedParent !== root && !resolvedParent.startsWith(root + sep)) {
        throw new Error(`refusing to write outside the workspace: ${JSON.stringify(write.path)}`)
      }
      // lstat, not existsSync: a broken symlink must still be detected
      const stat = lstatSync(target, { throwIfNoEntry: false })
      if (stat?.isSymbolicLink()) {
        throw new Error(`refusing to write through symlink: ${JSON.stringify(write.path)}`)
      }
      writeFileSync(target, write.content, 'utf8')
    }
    return await commitAll(repo, opts)
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
 * that commit (callers on new read surfaces run `ensureWorkspace` first, so
 * infra faults throw there instead of surfacing here)
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
 * Lists every tracked file at a pinned commit — the read twin of {@link readAt}
 * for the files subgraph's list surface. Paths come back verbatim (newline-
 * separated; git cannot store newlines in names).
 *
 * @param repo - absolute workspace path
 * @param commit - `HEAD` or a plain hex sha (validated, see `safeRev`)
 * @returns repository-relative paths at that commit, empty for an empty tree
 * @throws {Error} when `commit` fails validation before git runs, or git fails
 */
export async function listAt(repo: string, commit: string): Promise<string[]> {
  safeRev(commit)
  const out = await git(repo, ['ls-tree', '-r', '--name-only', commit], { raw: true })
  return out.split('\n').filter((line) => line.length > 0)
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
