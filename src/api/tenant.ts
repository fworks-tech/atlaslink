import type { SessionBackend } from '../session/sessionBackend'
import { backendForTenant } from '../session/backendFactory'
import { INVALID_TENANT_ERROR, resolveTenantIdFromAuth } from '../session/tenant'

export { INVALID_TENANT_ERROR }

export function tenantBackendForRequest(
  request: { headers: Record<string, string | string[] | undefined>; auth?: { tenantId: string } },
  base: SessionBackend
): { backend: SessionBackend; error: string | null; tenantId?: string } {
  const { tenantId, error } = resolveTenantIdFromAuth(request.auth?.tenantId, request.headers)
  if (error) return { backend: base, error }
  return { backend: backendForTenant(base, tenantId), error: null, tenantId }
}
