import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ensureWorkspace, commitAll, readAt, diff } from './git'
import { withWorkspaceLock } from './lock'
import { withTimeout } from '../../test/withTimeout'

/** Creates an isolated temporary directory standing in for a workspace root. */
function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'atlaslink-workspace-'))
}

/**
 * Runs a read-only git command in the test repo for assertions.
 *
 * @param repo - repository under test
 * @param args - git arguments, e.g. `['rev-list', '--count', 'HEAD']`
 * @returns trimmed stdout
 */
function sh(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

test('ensureWorkspace is idempotent and leaves exactly one baseline commit', async () => {
  const repo = tempWorkspace()
  try {
    await ensureWorkspace(repo)
    await ensureWorkspace(repo)
    assert.ok(existsSync(join(repo, '.git')))
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '1')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('parallel ensureWorkspace still yields one baseline commit', async () => {
  const repo = tempWorkspace()
  try {
    await Promise.all([ensureWorkspace(repo), ensureWorkspace(repo), ensureWorkspace(repo)])
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '1')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('commitAll records the session trailer and returns the new sha', async () => {
  const repo = tempWorkspace()
  try {
    await ensureWorkspace(repo)
    writeFileSync(join(repo, 'plan.md'), 'v1')
    const sha = await commitAll(repo, { message: 'add plan', sessionId: 'ses-1' })
    assert.match(sh(repo, ['log', '-1', '--format=%B']), /session: ses-1/)
    assert.equal(sh(repo, ['rev-parse', 'HEAD']), sha)
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '2')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('commitAll with no changes returns HEAD unchanged', async () => {
  const repo = tempWorkspace()
  try {
    await ensureWorkspace(repo)
    writeFileSync(join(repo, 'a.txt'), 'v1')
    const first = await commitAll(repo, { message: 'add a', sessionId: 'ses-1' })
    const second = await commitAll(repo, { message: 'nothing changed', sessionId: 'ses-1' })
    assert.equal(second, first)
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '2')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('commitAll rejects blank messages and multiline session ids', async () => {
  const repo = tempWorkspace()
  try {
    await assert.rejects(commitAll(repo, { message: '   ' }), /must not be empty/)
    await assert.rejects(commitAll(repo, { message: 'ok', sessionId: 'ses-1\ninjected: yes' }), /single line/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('readAt pins content to a commit after the tip moves', async () => {
  const repo = tempWorkspace()
  try {
    await ensureWorkspace(repo)
    writeFileSync(join(repo, 'spec.md'), 'v1')
    const sha1 = await commitAll(repo, { message: 'v1', sessionId: 'ses-1' })
    writeFileSync(join(repo, 'spec.md'), 'v2')
    await commitAll(repo, { message: 'v2', sessionId: 'ses-1' })
    assert.equal(await readAt(repo, sha1, 'spec.md'), 'v1')
    assert.equal(await readAt(repo, 'HEAD', 'spec.md'), 'v2')
    assert.equal(await readAt(repo, sha1, 'missing.md'), null)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('readAt and diff refuse unsafe refs and paths', async () => {
  const repo = tempWorkspace()
  try {
    await ensureWorkspace(repo)
    await assert.rejects(readAt(repo, 'HEAD~1..x', 'a.txt'), /unsafe commit ref/)
    await assert.rejects(readAt(repo, 'HEAD', '../escape'), /unsafe repo path/)
    await assert.rejects(readAt(repo, 'HEAD', '/etc/passwd'), /unsafe repo path/)
    await assert.rejects(diff(repo, 'HEAD', 'main:a'), /unsafe commit ref/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('diff shows the change between pinned commits', async () => {
  const repo = tempWorkspace()
  try {
    await ensureWorkspace(repo)
    writeFileSync(join(repo, 'spec.md'), 'v1')
    const sha1 = await commitAll(repo, { message: 'v1', sessionId: 'ses-1' })
    writeFileSync(join(repo, 'spec.md'), 'v2')
    const sha2 = await commitAll(repo, { message: 'v2', sessionId: 'ses-1' })
    assert.match(await diff(repo, sha1, sha2), /\+v2/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('ensure and commit nest inside an outer lock without deadlocking', async () => {
  const repo = tempWorkspace()
  try {
    const sha = await withTimeout(
      withWorkspaceLock(repo, async () => {
        await ensureWorkspace(repo)
        writeFileSync(join(repo, 'batch.txt'), 'batch')
        return await commitAll(repo, { message: 'batch write', sessionId: 'ses-2' })
      }),
      5000
    )
    assert.equal(sh(repo, ['rev-parse', 'HEAD']), sha)
    assert.match(sh(repo, ['log', '-1', '--format=%B']), /session: ses-2/)
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '2')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
