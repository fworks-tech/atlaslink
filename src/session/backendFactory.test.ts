import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRollbackTarget } from './backendFactory'

function envWith(patch: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return env as NodeJS.ProcessEnv
}

test('resolveRollbackTarget: absent or empty means no rollback', () => {
  assert.equal(resolveRollbackTarget(envWith({ SESSION_MIGRATE_DOWN_TO: undefined })), undefined)
  assert.equal(resolveRollbackTarget(envWith({ SESSION_MIGRATE_DOWN_TO: '' })), undefined)
})

test('resolveRollbackTarget: accepts a non-negative integer', () => {
  assert.equal(resolveRollbackTarget(envWith({ SESSION_MIGRATE_DOWN_TO: '3' })), 3)
  assert.equal(resolveRollbackTarget(envWith({ SESSION_MIGRATE_DOWN_TO: '0' })), 0)
})

test('resolveRollbackTarget: rejects non-integer input', () => {
  assert.throws(() => resolveRollbackTarget(envWith({ SESSION_MIGRATE_DOWN_TO: 'abc' })), /non-negative integer/)
  assert.throws(() => resolveRollbackTarget(envWith({ SESSION_MIGRATE_DOWN_TO: '2.5' })), /non-negative integer/)
  assert.throws(() => resolveRollbackTarget(envWith({ SESSION_MIGRATE_DOWN_TO: '-1' })), /non-negative integer/)
})

test('resolveRollbackTarget: refuses production rollback without the second key', () => {
  const prod = envWith({ NODE_ENV: 'production', SESSION_MIGRATE_DOWN_TO: '3', SESSION_MIGRATE_ALLOW_DOWN: undefined })
  assert.throws(() => resolveRollbackTarget(prod), /refusing schema rollback in production/)
  const allowed = envWith({ NODE_ENV: 'production', SESSION_MIGRATE_DOWN_TO: '3', SESSION_MIGRATE_ALLOW_DOWN: '1' })
  assert.equal(resolveRollbackTarget(allowed), 3)
})
