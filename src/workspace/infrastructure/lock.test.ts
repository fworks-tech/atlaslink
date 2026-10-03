import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withWorkspaceLock } from './lock'
import { withTimeout } from '../../test/withTimeout'

const KEY_A = '/tmp/atlaslink-lock-a'
const KEY_B = '/tmp/atlaslink-lock-b'

/**
 * Builds a lock-step callback that records `name:start`, pauses, then
 * records `name:end` — interleaving of these markers proves serialization.
 *
 * @param order - shared marker array the callback appends to
 * @param name - unique marker prefix for this writer
 * @returns an async callback suitable for {@link withWorkspaceLock}
 */
const step = (order: string[], name: string) => async () => {
  order.push(`${name}:start`)
  await new Promise((resolve) => setTimeout(resolve, 30))
  order.push(`${name}:end`)
}

test('withWorkspaceLock serializes writers per key', async () => {
  const order: string[] = []
  await Promise.all([
    withTimeout(withWorkspaceLock(KEY_A, step(order, 'a')), 5000),
    withTimeout(withWorkspaceLock(KEY_A, step(order, 'b')), 5000),
  ])
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end'])
})

test('withWorkspaceLock does not serialize across different keys', async () => {
  const order: string[] = []
  await Promise.all([
    withTimeout(withWorkspaceLock(KEY_A, step(order, 'a')), 5000),
    withTimeout(withWorkspaceLock(KEY_B, step(order, 'b')), 5000),
  ])
  assert.deepEqual(order.slice(0, 2), ['a:start', 'b:start'])
})

test('nested locks on the same key do not deadlock', async () => {
  const result = await withTimeout(
    withWorkspaceLock(KEY_A, async () => {
      return await withWorkspaceLock(KEY_A, async () => 'reentered')
    }),
    5000
  )
  assert.equal(result, 'reentered')
})
