import { DEFAULT_TENANT_ID } from './migrations'

export { DEFAULT_TENANT_ID }

export const TENANT_ID_HEADER = 'x-tenant-id'

const TENANT_ID_PATTERN = /^[a-z0-9_-]{1,64}$/i

export function isValidTenantId(value: string): boolean {
  return TENANT_ID_PATTERN.test(value)
}

export function resolveTenantId(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers[TENANT_ID_HEADER] ?? headers[TENANT_ID_HEADER.toLowerCase()]
  if (raw === undefined) return DEFAULT_TENANT_ID
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return DEFAULT_TENANT_ID
  const trimmed = value.trim()
  if (trimmed === '') return DEFAULT_TENANT_ID
  if (!isValidTenantId(trimmed)) return DEFAULT_TENANT_ID
  return trimmed
}

export function requireValidTenantId(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers[TENANT_ID_HEADER] ?? headers[TENANT_ID_HEADER.toLowerCase()]
  if (raw === undefined) return DEFAULT_TENANT_ID
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return DEFAULT_TENANT_ID
  return isValidTenantId(trimmed) ? trimmed : null
}
