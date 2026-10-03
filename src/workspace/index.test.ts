import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as workspace from './index'

test('workspace module exposes only the safe surface', () => {
  assert.deepEqual(Object.keys(workspace).sort(), [
    'commitAll',
    'diff',
    'ensureWorkspace',
    'readAt',
    'withWorkspaceLock',
    'workspacePathFor',
  ])
})
