import type { SessionBackend } from '../session/sessionBackend'
import { backendForTenant } from '../session/backendFactory'
import { INVALID_TENANT_ERROR, requireValidTenantId } from '../session/tenant'

export { INVALID_TENANT_ERROR }

export function tenantBackendForRequest(
  request: { headers: Record<string, string | string[] | undefined> },
  base: SessionBackend
): { backend: SessionBackend; error: string | null; tenantId?: string } {
  const tenantId = requireValidTenantId(request.headers as Record<string, string | string[] | undefined>)
  if (tenantId === null) return { backend: base, error: INVALID_TENANT_ERROR }
  return { backend: backendForTenant(base, tenantId), error: null, tenantId }
}

export function rejectInvalidTenant(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const v = requireValidTenantId(request.headers as Record<string, string | string[] | undefined>)
  return v === null ? INVALID_TENANT_ERROR : null
}
