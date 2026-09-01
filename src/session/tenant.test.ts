import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TENANT_ID, TENANT_ID_HEADER, isValidTenantId, resolveTenantId, requireValidTenantId } from './tenant'

test('isValidTenantId accepts safe ids', () => {
  assert.equal(isValidTenantId('default'), true)
  assert.equal(isValidTenantId('tenant-a'), true)
  assert.equal(isValidTenantId('Tenant_123'), true)
  assert.equal(isValidTenantId('a'), true)
})

test('isValidTenantId rejects unsafe ids', () => {
  assert.equal(isValidTenantId(''), false)
  assert.equal(isValidTenantId('a/b'), false)
  assert.equal(isValidTenantId('a b'), false)
  assert.equal(isValidTenantId('a'.repeat(65)), false)
})

test('resolveTenantId returns default when header missing', () => {
  assert.equal(resolveTenantId({}), DEFAULT_TENANT_ID)
  assert.equal(resolveTenantId({ [TENANT_ID_HEADER]: undefined }), DEFAULT_TENANT_ID)
})

test('resolveTenantId uses header when valid', () => {
  assert.equal(resolveTenantId({ [TENANT_ID_HEADER]: 'tenant-b' }), 'tenant-b')
  assert.equal(resolveTenantId({ 'x-tenant-id': 'tenant-b' }), 'tenant-b')
})

test('resolveTenantId falls back to default on invalid header', () => {
  assert.equal(resolveTenantId({ [TENANT_ID_HEADER]: 'bad/id' }), DEFAULT_TENANT_ID)
  assert.equal(resolveTenantId({ [TENANT_ID_HEADER]: '' }), DEFAULT_TENANT_ID)
})

test('requireValidTenantId returns null on invalid header', () => {
  assert.equal(requireValidTenantId({ [TENANT_ID_HEADER]: 'bad/id' }), null)
  assert.equal(requireValidTenantId({ [TENANT_ID_HEADER]: 'bad id' }), null)
  assert.equal(requireValidTenantId({}), DEFAULT_TENANT_ID)
})
