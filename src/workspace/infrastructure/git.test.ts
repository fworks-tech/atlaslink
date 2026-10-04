import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ensureWorkspace, commitAll, readAt, listAt, diff, applySessionWrite, isSafeRepoPath } from './git'
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

test('listAt enumerates tracked files at a pinned commit and refuses unsafe refs', async () => {
  const repo = tempWorkspace()
  try {
    await ensureWorkspace(repo)
    assert.deepEqual(await listAt(repo, 'HEAD'), ['.gitignore'])

    writeFileSync(join(repo, 'spec.md'), 'v1')
    writeFileSync(join(repo, 'notes.txt'), 'n')
    const sha = await commitAll(repo, { message: 'add files', sessionId: 'ses-1' })
    assert.deepEqual(await listAt(repo, 'HEAD'), ['.gitignore', 'notes.txt', 'spec.md'])
    assert.deepEqual(await listAt(repo, sha), ['.gitignore', 'notes.txt', 'spec.md'])

    await assert.rejects(listAt(repo, 'HEAD~1'), /unsafe commit ref/)
    await assert.rejects(listAt(repo, '--all'), /unsafe commit ref/)
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

test('applySessionWrite writes files, commits once with the session trailer, and returns the sha', async () => {
  const repo = tempWorkspace()
  try {
    const sha = await applySessionWrite(
      repo,
      [
        { path: 'code-review.md', content: '# Review\n\nverdict' },
        { path: 'nested/report.txt', content: 'second file' },
      ],
      { message: 'apply 2 file(s) from the-reviewer', sessionId: 'ses-w1' }
    )
    assert.equal(readFileSync(join(repo, 'code-review.md'), 'utf8'), '# Review\n\nverdict')
    assert.equal(readFileSync(join(repo, 'nested/report.txt'), 'utf8'), 'second file')
    assert.match(sh(repo, ['log', '-1', '--format=%B']), /session: ses-w1/)
    assert.equal(sh(repo, ['rev-parse', 'HEAD']), sha)
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '2')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('applySessionWrite updates an existing file in a single follow-up commit', async () => {
  const repo = tempWorkspace()
  try {
    await applySessionWrite(repo, [{ path: 'plan.md', content: 'v1' }], { message: 'first', sessionId: 'ses-a' })
    const sha = await applySessionWrite(repo, [{ path: 'plan.md', content: 'v2' }], { message: 'second', sessionId: 'ses-b' })
    assert.equal(readFileSync(join(repo, 'plan.md'), 'utf8'), 'v2')
    assert.match(sh(repo, ['log', '-1', '--format=%B']), /session: ses-b/)
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '3')
    assert.equal(sh(repo, ['rev-parse', 'HEAD']), sha)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('applySessionWrite rejects unsafe paths and empty write batches', async () => {
  const repo = tempWorkspace()
  try {
    await assert.rejects(
      applySessionWrite(repo, [{ path: '../escape.txt', content: 'x' }], { message: 'bad' }),
      /unsafe repo path/
    )
    await assert.rejects(applySessionWrite(repo, [], { message: 'empty' }), /at least one write/)
    assert.equal(existsSync(join(repo, '.git')), false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('applySessionWrite refuses .git paths and writes through symlinks', async () => {
  const repo = tempWorkspace()
  try {
    await assert.rejects(
      applySessionWrite(repo, [{ path: '.git/hooks/pre-commit', content: 'x' }], { message: 'bad' }),
      /unsafe repo path/
    )
    assert.equal(isSafeRepoPath('.git/config'), false)
    assert.equal(isSafeRepoPath('docs/.gitlab-ci.yml'), true)
    await ensureWorkspace(repo)
    const outside = tempWorkspace()
    try {
      symlinkSync(join(outside, 'target.md'), join(repo, 'link.md'))
      await assert.rejects(
        applySessionWrite(repo, [{ path: 'link.md', content: 'hijack' }], { message: 'bad' }),
        /symlink/
      )
      assert.equal(existsSync(join(outside, 'target.md')), false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('applySessionWrite refuses symlinked parent directories and .GIT casing', async () => {
  const repo = tempWorkspace()
  const outside = tempWorkspace()
  try {
    await ensureWorkspace(repo)
    symlinkSync(outside, join(repo, 'docs'), 'junction')
    await assert.rejects(
      applySessionWrite(repo, [{ path: 'docs/report.md', content: 'escape' }], { message: 'bad' }),
      /outside the workspace/
    )
    assert.equal(existsSync(join(outside, 'report.md')), false)
    assert.equal(isSafeRepoPath('.GIT/config'), false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('applySessionWrite refuses credential-shaped paths and .gitignore keeps secrets out of history', async () => {
  const repo = tempWorkspace()
  try {
    await assert.rejects(
      applySessionWrite(repo, [{ path: '.env', content: 'KEY=1' }], { message: 'bad' }),
      /credential-shaped/
    )
    await assert.rejects(
      applySessionWrite(repo, [{ path: 'keys/id_ed25519.pub', content: 'x' }], { message: 'bad' }),
      /credential-shaped/
    )
    await ensureWorkspace(repo)
    writeFileSync(join(repo, '.env'), 'KEY=1')
    await commitAll(repo, { message: 'stray dirt', sessionId: 'ses-s' })
    assert.deepEqual(await listAt(repo, 'HEAD'), ['.gitignore'])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
