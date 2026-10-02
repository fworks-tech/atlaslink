import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { workspacePathFor } from './path'

test('workspacePathFor is deterministic under the root', () => {
  const a = workspacePathFor('/data/workspaces', 'default', 'proj-1')
  assert.equal(a, workspacePathFor('/data/workspaces', 'default', 'proj-1'))
  assert.equal(a, join('/data/workspaces', 'default', 'proj-1'))
})

test('workspacePathFor isolates tenants sharing a project id', () => {
  assert.notEqual(workspacePathFor('/w', 'tenant-a', 'proj-1'), workspacePathFor('/w', 'tenant-b', 'proj-1'))
})

test('workspacePathFor rejects ids that could escape the root', () => {
  const bad = ['..', '.', '', 'a/b', 'a\\b', 'a/../b', 'seg ment']
  for (const value of bad) {
    assert.throws(() => workspacePathFor('/w', value, 'proj-1'), /unsafe workspace tenant/, `tenant ${JSON.stringify(value)}`)
    assert.throws(() => workspacePathFor('/w', 'default', value), /unsafe workspace project/, `project ${JSON.stringify(value)}`)
  }
})
