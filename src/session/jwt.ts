import { createHmac, timingSafeEqual } from 'node:crypto'

export interface JwtClaims {
  sub: string
  tenant: string
  iat: number
  exp: number
}

const JWT_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64urlJson(value: unknown): string {
  return base64url(JSON.stringify(value))
}

function base64urlDecode(input: string): Buffer {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), '=')
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Minimal HS256 JWT implementation — no external dependency. Used for
 * dashboard session tokens. The signing secret is `ATLASLINK_JWT_SECRET`.
 */
export function signJwt(claims: JwtClaims): string {
  const secret = process.env.ATLASLINK_JWT_SECRET
  if (!secret) throw new Error('ATLASLINK_JWT_SECRET is not set')

  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' })
  const payload = base64urlJson(claims)
  const signingInput = `${header}.${payload}`
  const signature = base64url(
    createHmac('sha256', secret).update(signingInput).digest()
  )
  return `${signingInput}.${signature}`
}

export function verifyJwt(token: string): JwtClaims | null {
  const secret = process.env.ATLASLINK_JWT_SECRET
  if (!secret) throw new Error('ATLASLINK_JWT_SECRET is not set')

  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  const expectedSig = base64url(
    createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  )

  const sigBuf = base64urlDecode(signature)
  const expectedBuf = base64urlDecode(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }

  let headerObj: { alg?: string }
  try {
    headerObj = JSON.parse(base64urlDecode(header).toString('utf8'))
  } catch {
    return null
  }
  if (headerObj.alg !== 'HS256') return null

  let claims: JwtClaims
  try {
    claims = JSON.parse(base64urlDecode(payload).toString('utf8'))
  } catch {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (claims.exp && claims.exp < now) return null

  return claims
}

export function createToken(userId: string, tenantId: string): string {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({
    sub: userId,
    tenant: tenantId,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  })
}
