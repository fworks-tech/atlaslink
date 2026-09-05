import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { Db } from './db'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
      if (err) reject(err)
      else resolve(derived)
    })
  })
}

export interface UserRow {
  id: string
  email: string
  password_hash: string
  tenant_id: string
  created_at: Date
  updated_at: Date
}

export interface ApiKeyRow {
  id: string
  user_id: string
  key_hash: string
  name: string
  tenant_id: string
  created_at: Date
  last_used_at: Date | null
}

export interface NewUser {
  id: string
  email: string
  passwordHash: string
  tenantId: string
}

export interface NewApiKey {
  id: string
  userId: string
  keyHash: string
  name: string
  tenantId: string
}

/**
 * Auth persistence layer — users and API keys live in Postgres behind the Db
 * seam (pglite in CI, pg in prod). All hashes are scrypt; API keys are stored
 * as SHA-256 of the plaintext key, never the plaintext itself.
 */
export class AuthStore {
  constructor(private readonly db: Db) {}

  async createUser(user: NewUser): Promise<UserRow> {
    const now = new Date()
    await this.db.query(
      `INSERT INTO users (id, email, password_hash, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.email, user.passwordHash, user.tenantId, now, now]
    )
    return {
      id: user.id,
      email: user.email,
      password_hash: user.passwordHash,
      tenant_id: user.tenantId,
      created_at: now,
      updated_at: now,
    }
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, email, password_hash, tenant_id, created_at, updated_at
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    )
    return rows[0] ?? null
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, email, password_hash, tenant_id, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    )
    return rows[0] ?? null
  }

  async createApiKey(key: NewApiKey): Promise<ApiKeyRow> {
    const now = new Date()
    await this.db.query(
      `INSERT INTO api_keys (id, user_id, key_hash, name, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [key.id, key.userId, key.keyHash, key.name, key.tenantId, now]
    )
    return {
      id: key.id,
      user_id: key.userId,
      key_hash: key.keyHash,
      name: key.name,
      tenant_id: key.tenantId,
      created_at: now,
      last_used_at: null,
    }
  }

  async findApiKeyByKeyHash(keyHash: string): Promise<ApiKeyRow | null> {
    const { rows } = await this.db.query<ApiKeyRow>(
      `SELECT id, user_id, key_hash, name, tenant_id, created_at, last_used_at
       FROM api_keys WHERE key_hash = $1`,
      [keyHash]
    )
    return rows[0] ?? null
  }

  async touchApiKey(id: string): Promise<void> {
    await this.db.query(`UPDATE api_keys SET last_used_at = $1 WHERE id = $2`, [new Date(), id])
  }

  async listApiKeysForUser(userId: string): Promise<ApiKeyRow[]> {
    const { rows } = await this.db.query<ApiKeyRow>(
      `SELECT id, user_id, key_hash, name, tenant_id, created_at, last_used_at
       FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    )
    return rows
  }

  async deleteApiKey(id: string, userId: string): Promise<boolean> {
    // Use a RETURNING clause so the Db.query wrapper's rows array tells us
    // whether the delete matched — portable across pg and pglite.
    const { rows } = await this.db.query<{ id: string }>(
      `DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    )
    return rows.length > 0
  }
}

export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return scryptAsync(password, salt, KEYLEN).then(
    (derived) => `${salt.toString('hex')}:${derived.toString('hex')}`
  )
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return Promise.resolve(false)
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  return scryptAsync(password, salt, KEYLEN).then(
    (derived) => {
      if (derived.length !== expected.length) return false
      return timingSafeEqual(derived, expected)
    }
  )
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export function generateRandomId(): string {
  return randomBytes(16).toString('hex')
}

export function generateApiKey(): string {
  return `ak_${randomBytes(24).toString('base64url')}`
}
