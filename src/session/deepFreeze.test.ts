import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deepFreeze } from './deepFreeze'

test('deepFreeze freezes a plain object and its nested children', () => {
  const obj = { a: { b: 1 }, arr: [1, { c: 2 }] }
  const frozen = deepFreeze(obj)
  assert.ok(Object.isFrozen(frozen))
  assert.ok(Object.isFrozen(frozen.a))
  assert.ok(Object.isFrozen(frozen.arr))
  assert.ok(Object.isFrozen((frozen.arr as unknown[])[1] as object))
  assert.equal(frozen, obj)
})

test('deepFreeze handles null, undefined, and primitives', () => {
  assert.equal(deepFreeze(null as unknown as object), null)
  assert.equal(deepFreeze(undefined as unknown as object), undefined)
  assert.equal(deepFreeze(42 as unknown as object), 42)
  assert.equal(deepFreeze('x' as unknown as object), 'x')
})

test('deepFreeze handles circular references without throwing', () => {
  const obj: Record<string, unknown> = { a: 1 }
  obj.self = obj
  assert.doesNotThrow(() => deepFreeze(obj))
  assert.ok(Object.isFrozen(obj))
  assert.ok(Object.isFrozen(obj.self as object))
})

test('deepFreeze does not recurse into already-seen graphs', () => {
  const shared = { v: 1 }
  const root = { left: shared, right: shared }
  const frozen = deepFreeze(root)
  assert.ok(Object.isFrozen(frozen.left))
  assert.ok(Object.isFrozen(frozen.right))
  assert.equal(frozen.left, frozen.right)
})

test('deepFreeze on an already-frozen object is idempotent', () => {
  const obj = Object.freeze({ a: { b: 1 } })
  const frozen = deepFreeze(obj)
  assert.ok(Object.isFrozen(frozen))
})

test('deepFreeze only freezes own properties (prototype-pollution safe)', () => {
  const proto = { polluted: { x: 1 } }
  const obj = Object.create(proto) as Record<string, unknown>
  obj.own = { y: 1 }
  const frozen = deepFreeze(obj)
  assert.ok(Object.isFrozen(frozen))
  assert.ok(Object.isFrozen(frozen.own as object))
  assert.equal(Object.isFrozen(proto.polluted), false)
})
