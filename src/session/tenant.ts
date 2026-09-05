import { DEFAULT_TENANT_ID } from './migrations'

export { DEFAULT_TENANT_ID }

export const TENANT_ID_HEADER = 'x-tenant-id'

const TENANT_ID_PATTERN = /^[a-z0-9_-]{1,64}$/i

export function isValidTenantId(value: string): boolean {
  return TENANT_ID_PATTERN.test(value)
}

/**
 * Resolve tenant from auth context first, then fall back to header for
 * backward compatibility. When auth is present (ADR-008), the header is
 * rejected with 400 if present — tenant must come from identity, not client
 * claim. This closes the advisory-TODO at the bottom of this file.
 */
export function resolveTenantIdFromAuth(
  authTenantId: string | undefined,
  headers: Record<string, string | string[] | undefined>
): { tenantId: string; error: string | null } {
  if (authTenantId) {
    // Auth is present — tenant comes from identity. Reject client-supplied
    // tenant header to prevent tenant injection.
    const raw = headers[TENANT_ID_HEADER] ?? headers[TENANT_ID_HEADER.toLowerCase()]
    if (raw !== undefined) {
      return { tenantId: authTenantId, error: 'tenant header is not accepted when authenticated — remove x-tenant-id' }
    }
    return { tenantId: authTenantId, error: null }
  }

  // No auth — fall back to header (legacy behavior).
  const raw = headers[TENANT_ID_HEADER] ?? headers[TENANT_ID_HEADER.toLowerCase()]
  if (raw === undefined) return { tenantId: DEFAULT_TENANT_ID, error: null }
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return { tenantId: DEFAULT_TENANT_ID, error: null }
  const trimmed = value.trim()
  if (trimmed === '') return { tenantId: DEFAULT_TENANT_ID, error: null }
  if (!isValidTenantId(trimmed)) return { tenantId: DEFAULT_TENANT_ID, error: 'invalid tenant id' }
  return { tenantId: trimmed, error: null }
}

/** @deprecated Use resolveTenantIdFromAuth when auth context is available. */
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

/** @deprecated Use resolveTenantIdFromAuth when auth context is available. */
export function requireValidTenantId(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers[TENANT_ID_HEADER] ?? headers[TENANT_ID_HEADER.toLowerCase()]
  if (raw === undefined) return DEFAULT_TENANT_ID
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return DEFAULT_TENANT_ID
  return isValidTenantId(trimmed) ? trimmed : null
}

export const INVALID_TENANT_ERROR = 'invalid tenant id'
