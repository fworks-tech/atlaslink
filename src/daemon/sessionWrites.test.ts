import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseWorkspaceWrites, finalizeWorkspace } from './sessionWrites'
import { workspacePathFor } from '../workspace'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'atlaslink-session-writes-'))
}

function sh(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

test('parseWorkspaceWrites extracts one fenced write with verbatim content', () => {
  const output = [
    'Resumo: revisei o módulo.',
    '```atlaslink:write path=code-review.md',
    '# Review',
    '',
    'verdict: merge after fixes',
    '```',
    'Fim.',
  ].join('\n')
  assert.deepEqual(parseWorkspaceWrites(output), [{ path: 'code-review.md', content: '# Review\n\nverdict: merge after fixes' }])
})

test('parseWorkspaceWrites extracts multiple fences and ignores prose fences', () => {
  const output = [
    '```ts',
    'const x = 1',
    '```',
    '```atlaslink:write path=a.md',
    'A',
    '```',
    '```atlaslink:write path=docs/b.md',
    'B',
    '```',
  ].join('\n')
  assert.deepEqual(parseWorkspaceWrites(output), [
    { path: 'a.md', content: 'A' },
    { path: 'docs/b.md', content: 'B' },
  ])
})

test('parseWorkspaceWrites skips unsafe paths and unclosed fences', () => {
  const output = [
    '```atlaslink:write path=../escape.md',
    'nope',
    '```',
    '```atlaslink:write path=/absolute.md',
    'nope',
    '```',
    '```atlaslink:write path=ok.md',
    'kept',
  ].join('\n')
  assert.deepEqual(parseWorkspaceWrites(output), [])
})

test('parseWorkspaceWrites returns an empty list without fences', () => {
  assert.deepEqual(parseWorkspaceWrites('plain prose\n```json\n{}\n```'), [])
  assert.deepEqual(parseWorkspaceWrites(''), [])
})

test('finalizeWorkspace applies fenced writes as one attributed commit', async () => {
  const root = tempRoot()
  try {
    const output = '```atlaslink:write path=code-review.md\n# Review\n```'
    const sha = await finalizeWorkspace({
      workspaceRoot: root,
      tenantId: 'default',
      projectId: 'proj',
      sessionId: 'ses-f1',
      status: 'succeeded',
      member: 'the-reviewer',
      output,
    })
    const repo = workspacePathFor(root, 'default', 'proj')
    assert.equal(readFileSync(join(repo, 'code-review.md'), 'utf8'), '# Review')
    assert.match(sh(repo, ['log', '-1', '--format=%B']), /session: ses-f1/)
    assert.equal(sh(repo, ['rev-parse', 'HEAD']), sha)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('finalizeWorkspace commits stray workspace dirt when the output has no fences', async () => {
  const root = tempRoot()
  try {
    const repo = workspacePathFor(root, 'default', 'proj')
    const boot = await finalizeWorkspace({
      workspaceRoot: root,
      tenantId: 'default',
      projectId: 'proj',
      sessionId: 'ses-boot',
      status: 'succeeded',
      member: 'the-builder',
      output: 'no fences here',
    })
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '1')
    writeFileSync(join(repo, 'stray.txt'), 'dirt')
    const sha = await finalizeWorkspace({
      workspaceRoot: root,
      tenantId: 'default',
      projectId: 'proj',
      sessionId: 'ses-d2',
      status: 'failed',
      member: 'the-builder',
      output: undefined,
    })
    assert.equal(sh(repo, ['rev-list', '--count', 'HEAD']), '2')
    assert.match(sh(repo, ['log', '-1', '--format=%B']), /session: ses-d2/)
    assert.equal(sh(repo, ['rev-parse', 'HEAD']), sha)
    assert.ok(boot && boot.length > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('finalizeWorkspace is a no-op without a project binding', async () => {
  const root = tempRoot()
  try {
    const sha = await finalizeWorkspace({
      workspaceRoot: root,
      tenantId: 'default',
      projectId: undefined,
      sessionId: 'ses-x',
      status: 'succeeded',
      member: 'the-builder',
      output: '```atlaslink:write path=ignored.md\nx\n```',
    })
    assert.equal(sha, undefined)
    assert.equal(existsSync(join(root, 'default')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseWorkspaceWrites rejects .git segments and accepts CRLF output', () => {
  const output = [
    '```atlaslink:write path=.git/hooks/pre-commit',
    'malicious',
    '```',
    '```atlaslink:write path=ok.md',
    'crlf body',
    '```',
  ].join('\r\n')
  assert.deepEqual(parseWorkspaceWrites(output), [{ path: 'ok.md', content: 'crlf body' }])
})

test('parseWorkspaceWrites keeps later fences when an earlier block is unclosed', () => {
  const output = [
    '```atlaslink:write path=broken.md',
    'no closing fence here',
    '```atlaslink:write path=good.md',
    'landed',
    '```',
  ].join('\n')
  assert.deepEqual(parseWorkspaceWrites(output), [{ path: 'good.md', content: 'landed' }])
})

test('parseWorkspaceWrites supports deeper backticks so content may embed fences', () => {
  const output = [
    '````atlaslink:write path=review.md',
    '# Review',
    '```ts',
    'const x = 1',
    '```',
    '````',
  ].join('\n')
  assert.deepEqual(parseWorkspaceWrites(output), [
    { path: 'review.md', content: '# Review\n```ts\nconst x = 1\n```' },
  ])
})
