import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signPayload, verifySignature, createSignedWebhook } from './signing'

const SECRET = 'test-signing-secret-that-is-32-bytes!'

test('signPayload — produces hex-encoded HMAC-SHA256', () => {
  const previous = process.env.ATLASLINK_SIGNING_SECRET
  process.env.ATLASLINK_SIGNING_SECRET = SECRET
  try {
    const sig = signPayload('hello world')
    assert.equal(sig.length, 64)
    assert.match(sig, /^[0-9a-f]+$/)
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_SIGNING_SECRET
    else process.env.ATLASLINK_SIGNING_SECRET = previous
  }
})

test('signPayload — string and object produce same signature for same data', () => {
  const previous = process.env.ATLASLINK_SIGNING_SECRET
  process.env.ATLASLINK_SIGNING_SECRET = SECRET
  try {
    const sig1 = signPayload('{"event":"test"}')
    const sig2 = signPayload({ event: 'test' })
    assert.equal(sig1, sig2)
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_SIGNING_SECRET
    else process.env.ATLASLINK_SIGNING_SECRET = previous
  }
})

test('verifySignature — returns true for valid signature', () => {
  const previous = process.env.ATLASLINK_SIGNING_SECRET
  process.env.ATLASLINK_SIGNING_SECRET = SECRET
  try {
    const payload = { event: 'session.created', sessionId: 'abc' }
    const sig = signPayload(payload)
    assert.equal(verifySignature(payload, sig), true)
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_SIGNING_SECRET
    else process.env.ATLASLINK_SIGNING_SECRET = previous
  }
})

test('verifySignature — returns false for invalid signature', () => {
  const previous = process.env.ATLASLINK_SIGNING_SECRET
  process.env.ATLASLINK_SIGNING_SECRET = SECRET
  try {
    const payload = { event: 'session.created' }
    assert.equal(verifySignature(payload, 'invalidsignature'), false)
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_SIGNING_SECRET
    else process.env.ATLASLINK_SIGNING_SECRET = previous
  }
})

test('verifySignature — returns false when secret is unset', () => {
  const previous = process.env.ATLASLINK_SIGNING_SECRET
  delete process.env.ATLASLINK_SIGNING_SECRET
  try {
    assert.equal(verifySignature('test', 'any'), false)
  } finally {
    if (previous !== undefined) process.env.ATLASLINK_SIGNING_SECRET = previous
  }
})

test('verifySignature — detects tampered payload', () => {
  const previous = process.env.ATLASLINK_SIGNING_SECRET
  process.env.ATLASLINK_SIGNING_SECRET = SECRET
  try {
    const payload = { event: 'session.created', data: 'original' }
    const sig = signPayload(payload)
    const tampered = { event: 'session.created', data: 'tampered' }
    assert.equal(verifySignature(tampered, sig), false)
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_SIGNING_SECRET
    else process.env.ATLASLINK_SIGNING_SECRET = previous
  }
})

test('createSignedWebhook — returns payload with signature and algorithm', () => {
  const previous = process.env.ATLASLINK_SIGNING_SECRET
  process.env.ATLASLINK_SIGNING_SECRET = SECRET
  try {
    const payload = { event: 'session.succeeded', sessionId: 'xyz' }
    const webhook = createSignedWebhook(payload)
    assert.deepEqual(webhook.payload, payload)
    assert.equal(webhook.algorithm, 'sha256')
    assert.equal(webhook.signature.length, 64)
    assert.equal(verifySignature(payload, webhook.signature), true)
  } finally {
    if (previous === undefined) delete process.env.ATLASLINK_SIGNING_SECRET
    else process.env.ATLASLINK_SIGNING_SECRET = previous
  }
})

test('signPayload — throws when secret is unset', () => {
  const previous = process.env.ATLASLINK_SIGNING_SECRET
  delete process.env.ATLASLINK_SIGNING_SECRET
  try {
    assert.throws(() => signPayload('test'), /ATLASLINK_SIGNING_SECRET is not set/)
  } finally {
    if (previous !== undefined) process.env.ATLASLINK_SIGNING_SECRET = previous
  }
})
