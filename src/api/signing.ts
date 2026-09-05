import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC-SHA256 request signing for API integrity. Used to sign outgoing
 * webhook payloads (session events → external systems) and verify incoming
 * signed requests from trusted sources.
 *
 * The signing secret is `ATLASLINK_SIGNING_SECRET`. When unset, signing
 * operations throw and verification returns false (fail-closed).
 */

function getSecret(): string {
  const secret = process.env.ATLASLINK_SIGNING_SECRET
  if (!secret) throw new Error('ATLASLINK_SIGNING_SECRET is not set')
  return secret
}

/**
 * Sign a payload with HMAC-SHA256. Returns the hex-encoded signature.
 */
export function signPayload(payload: string | object): string {
  const secret = getSecret()
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return createHmac('sha256', secret).update(data).digest('hex')
}

/**
 * Verify an HMAC-SHA256 signature against a payload. Constant-time comparison.
 */
export function verifySignature(payload: string | object, signature: string): boolean {
  const secret = process.env.ATLASLINK_SIGNING_SECRET
  if (!secret) return false
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const expected = createHmac('sha256', secret).update(data).digest('hex')
  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(sigBuf, expectedBuf)
}

/**
 * Create a signed webhook envelope. The signature covers the entire payload
 * so the recipient can verify integrity and authenticity.
 */
export function createSignedWebhook(payload: object): {
  payload: object
  signature: string
  algorithm: string
} {
  return {
    payload,
    signature: signPayload(payload),
    algorithm: 'sha256',
  }
}
