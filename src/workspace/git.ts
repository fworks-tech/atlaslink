import { execFile } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 10 * 1024 * 1024

const IDENTITY_FLAGS = ['-c', 'user.name=atlaslink', '-c', 'user.email=atlaslink@localhost']
const COMMIT_REV = /^(HEAD|[0-9a-f]{7,40})$/i
const LOCKS = new Map<string, Promise<void>>()
const HELD = new AsyncLocalStorage<Set<string>>()

interface GitOptions {
  identity?: boolean
  raw?: boolean
}

async function git(repo: string, args: string[], opts: GitOptions = {}): Promise<string> {
  const flags = opts.identity ? IDENTITY_FLAGS : []
  const { stdout } = await execFileAsync('git', ['-C', repo, ...flags, ...args], { maxBuffer: MAX_BUFFER })
  return opts.raw ? stdout : stdout.trim()
}

function safeRepoPath(path: string): string {
  const segments = path.split('/')
  if (!path || path.startsWith('/') || path.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`unsafe repo path: ${JSON.stringify(path)}`)
  }
  return path
}

function safeRev(rev: string): string {
  if (!COMMIT_REV.test(rev)) throw new Error(`unsafe commit ref: ${JSON.stringify(rev)}`)
  return rev
}

async function hasHead(repo: string): Promise<boolean> {
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/**
 * Serializes writers per workspace, reentrantly: the lock is keyed by the
 * resolved path and tracked in async context, so ensure/commit nested inside
 * an outer locked batch do not deadlock on their own lock.
 * ponytail: per-process lock — cross-process lock if a second writer process ever exists
 */
export async function withWorkspaceLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(repo)
  const outer = HELD.getStore()
  if (outer?.has(key)) return await fn()
  const prev = LOCKS.get(key) ?? Promise.resolve()
  return await HELD.run(new Set([...(outer ?? []), key]), async () => {
    const next = prev.then(() => fn())
    const tail = next.then(
      () => undefined,
      () => undefined
    )
    LOCKS.set(key, tail)
    tail.then(() => {
      if (LOCKS.get(key) === tail) LOCKS.delete(key)
    })
    return await next
  })
}

/**
 * Idempotent: creates the directory, initializes the repository, and records
 * one empty baseline commit so HEAD is always readable. Lazy by design —
 * called on first use, not at project creation, so auto-created projects
 * (inbox) never spawn repositories they do not use.
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
 * event log join on the same id (ADR-012). Returns the new commit sha;
 * returns HEAD unchanged when there is nothing to commit.
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

/** Reads file content at a pinned commit; null when the path is absent there. */
export async function readAt(repo: string, commit: string, path: string): Promise<string | null> {
  safeRev(commit)
  const rel = safeRepoPath(path)
  try {
    return await git(repo, ['show', `${commit}:${rel}`], { raw: true })
  } catch {
    return null
  }
}

/** Text diff between two commits (either may be HEAD). */
export async function diff(repo: string, from: string, to: string): Promise<string> {
  safeRev(from)
  safeRev(to)
  return await git(repo, ['diff', from, to], { raw: true })
}
