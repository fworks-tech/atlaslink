import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthStore, generateApiKey, generateRandomId, hashApiKey, hashPassword, verifyPassword } from '../session/authStore'
import { createToken, signJwt, verifyJwt } from '../session/jwt'
import { runMigrations } from '../session/migrations'
import { PgliteDb } from '../session/db'

async function createTestStore(): Promise<{ store: AuthStore; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'atlaslink-auth-'))
  const pg = new PGlite(dir)
  const db = new PgliteDb(pg)
  await runMigrations(db)
  return {
    store: new AuthStore(db),
    cleanup: async () => {
      await pg.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('hashPassword and verifyPassword — round-trip', async () => {
  const password = 'correct-horse-battery-staple'
  const hash = await hashPassword(password)
  assert.notEqual(hash, password)
  assert.ok(await verifyPassword(password, hash))
  assert.equal(await verifyPassword('wrong-password', hash), false)
})

test('hashPassword — different salts for same password', async () => {
  const hash1 = await hashPassword('same-password')
  const hash2 = await hashPassword('same-password')
  assert.notEqual(hash1, hash2)
})

test('AuthStore.createUser — stores user and retrieves by email', async () => {
  const { store, cleanup } = await createTestStore()
  try {
    const passwordHash = await hashPassword('password123')
    await store.createUser({
      id: generateRandomId(),
      email: 'test@example.com',
      passwordHash,
      tenantId: 'test-tenant',
    })

    const user = await store.findUserByEmail('test@example.com')
    assert.ok(user)
    assert.equal(user!.email, 'test@example.com')
    assert.equal(user!.tenant_id, 'test-tenant')
    assert.equal(user!.password_hash, passwordHash)
  } finally {
    cleanup()
  }
})

test('AuthStore.findUserByEmail — case insensitive lookup', async () => {
  const { store, cleanup } = await createTestStore()
  try {
    await store.createUser({
      id: generateRandomId(),
      email: 'CaseTest@Example.com',
      passwordHash: await hashPassword('password123'),
      tenantId: 'default',
    })

    const user = await store.findUserByEmail('casetest@example.com')
    assert.ok(user)
    assert.equal(user!.email, 'CaseTest@Example.com')
  } finally {
    cleanup()
  }
})

test('AuthStore.findUserByEmail — returns null for unknown email', async () => {
  const { store, cleanup } = await createTestStore()
  try {
    const user = await store.findUserByEmail('nonexistent@example.com')
    assert.equal(user, null)
  } finally {
    cleanup()
  }
})

test('AuthStore.createApiKey — stores key and retrieves by hash', async () => {
  const { store, cleanup } = await createTestStore()
  try {
    const userId = generateRandomId()
    const plaintext = generateApiKey()
    const keyHash = hashApiKey(plaintext)

    await store.createUser({
      id: userId,
      email: 'keyuser@example.com',
      passwordHash: await hashPassword('password123'),
      tenantId: 'default',
    })

    await store.createApiKey({
      id: generateRandomId(),
      userId,
      keyHash,
      name: 'test-key',
      tenantId: 'default',
    })

    const found = await store.findApiKeyByKeyHash(keyHash)
    assert.ok(found)
    assert.equal(found!.user_id, userId)
    assert.equal(found!.name, 'test-key')
  } finally {
    cleanup()
  }
})

test('AuthStore.listApiKeysForUser — returns all keys for user', async () => {
  const { store, cleanup } = await createTestStore()
  try {
    const userId = generateRandomId()
    await store.createUser({
      id: userId,
      email: 'listkeys@example.com',
      passwordHash: await hashPassword('password123'),
      tenantId: 'default',
    })

    await store.createApiKey({
      id: generateRandomId(),
      userId,
      keyHash: hashApiKey(generateApiKey()),
      name: 'key-1',
      tenantId: 'default',
    })
    await store.createApiKey({
      id: generateRandomId(),
      userId,
      keyHash: hashApiKey(generateApiKey()),
      name: 'key-2',
      tenantId: 'default',
    })

    const keys = await store.listApiKeysForUser(userId)
    assert.equal(keys.length, 2)
    assert.deepEqual(keys.map((k) => k.name).sort(), ['key-1', 'key-2'])
  } finally {
    cleanup()
  }
})

test('AuthStore.deleteApiKey — removes key and prevents cross-user deletion', async () => {
  const { store, cleanup } = await createTestStore()
  try {
    const user1Id = generateRandomId()
    const user2Id = generateRandomId()
    await store.createUser({
      id: user1Id,
      email: 'user1@example.com',
      passwordHash: await hashPassword('password123'),
      tenantId: 'default',
    })
    await store.createUser({
      id: user2Id,
      email: 'user2@example.com',
      passwordHash: await hashPassword('password123'),
      tenantId: 'default',
    })

    const keyId = generateRandomId()
    await store.createApiKey({
      id: keyId,
      userId: user1Id,
      keyHash: hashApiKey(generateApiKey()),
      name: 'user1-key',
      tenantId: 'default',
    })

    const crossDelete = await store.deleteApiKey(keyId, user2Id)
    assert.equal(crossDelete, false)

    const ownDelete = await store.deleteApiKey(keyId, user1Id)
    assert.equal(ownDelete, true)

    const keys = await store.listApiKeysForUser(user1Id)
    assert.equal(keys.length, 0)
  } finally {
    cleanup()
  }
})

test('signJwt and verifyJwt — round-trip with valid claims', () => {
  const previousSecret = process.env.ATLASLINK_JWT_SECRET
  process.env.ATLASLINK_JWT_SECRET = 'test-secret-key-that-is-32-bytes!!'
  try {
    const claims = { sub: 'user-123', tenant: 'tenant-456', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }
    const token = signJwt(claims)
    assert.ok(token)
    assert.equal(token.split('.').length, 3)

    const decoded = verifyJwt(token)
    assert.ok(decoded)
    assert.equal(decoded!.sub, 'user-123')
    assert.equal(decoded!.tenant, 'tenant-456')
  } finally {
    if (previousSecret === undefined) delete process.env.ATLASLINK_JWT_SECRET
    else process.env.ATLASLINK_JWT_SECRET = previousSecret
  }
})

test('verifyJwt — rejects expired token', () => {
  const previousSecret = process.env.ATLASLINK_JWT_SECRET
  process.env.ATLASLINK_JWT_SECRET = 'test-secret-key-that-is-32-bytes!!'
  try {
    const claims = { sub: 'user-123', tenant: 'tenant-456', iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 }
    const token = signJwt(claims)
    const decoded = verifyJwt(token)
    assert.equal(decoded, null)
  } finally {
    if (previousSecret === undefined) delete process.env.ATLASLINK_JWT_SECRET
    else process.env.ATLASLINK_JWT_SECRET = previousSecret
  }
})

test('verifyJwt — rejects tampered signature', () => {
  const previousSecret = process.env.ATLASLINK_JWT_SECRET
  process.env.ATLASLINK_JWT_SECRET = 'test-secret-key-that-is-32-bytes!!'
  try {
    const claims = { sub: 'user-123', tenant: 'tenant-456', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }
    const token = signJwt(claims)
    const parts = token.split('.')
    parts[2] = parts[2].slice(0, -4) + 'AAAA'
    const tampered = parts.join('.')
    const decoded = verifyJwt(tampered)
    assert.equal(decoded, null)
  } finally {
    if (previousSecret === undefined) delete process.env.ATLASLINK_JWT_SECRET
    else process.env.ATLASLINK_JWT_SECRET = previousSecret
  }
})

test('createToken — produces valid JWT with 7-day expiry', () => {
  const previousSecret = process.env.ATLASLINK_JWT_SECRET
  process.env.ATLASLINK_JWT_SECRET = 'test-secret-key-that-is-32-bytes!!'
  try {
    const token = createToken('user-abc', 'tenant-xyz')
    const decoded = verifyJwt(token)
    assert.ok(decoded)
    assert.equal(decoded!.sub, 'user-abc')
    assert.equal(decoded!.tenant, 'tenant-xyz')

    const expectedExpiry = decoded!.iat + 7 * 24 * 60 * 60
    assert.equal(decoded!.exp, expectedExpiry)
  } finally {
    if (previousSecret === undefined) delete process.env.ATLASLINK_JWT_SECRET
    else process.env.ATLASLINK_JWT_SECRET = previousSecret
  }
})

test('hashApiKey — deterministic SHA-256', () => {
  const key = 'ak_test123456'
  const hash1 = hashApiKey(key)
  const hash2 = hashApiKey(key)
  assert.equal(hash1, hash2)
  assert.equal(hash1.length, 64)
})

test('generateApiKey — produces unique keys with ak_ prefix', () => {
  const key1 = generateApiKey()
  const key2 = generateApiKey()
  assert.ok(key1.startsWith('ak_'))
  assert.ok(key2.startsWith('ak_'))
  assert.notEqual(key1, key2)
})
