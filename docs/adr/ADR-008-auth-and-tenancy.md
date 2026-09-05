# ADR-008: Authentication & Tenancy

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** atlaslink team
- **Supersedes:** Advisory tenant scoping (`src/session/tenant.ts` TODO)
- **Related:** ADR-006 (Fastify HTTP + Postgres), #101, #102, #126, #143

## Context

Atlaslink currently authenticates all requests with a single shared bearer token
(`ATLASLINK_API_TOKEN`). There are no user accounts, no per-user identity, and
tenant scoping is advisory — any client can claim any tenant via the
`x-tenant-id` header. This is insufficient for multi-user deployment where:

- Different users must not access each other's sessions or projects
- Per-user rate limiting is needed to prevent abuse
- API key rotation is needed for programmatic access
- Audit trails must attribute actions to specific users

## Decision

Implement a dual-auth model:

1. **JWT sessions** for dashboard users (human-facing, cookie/header based)
2. **API keys** for programmatic access (machine-facing, bearer token)

Both auth methods resolve to a **user identity** that carries a **tenant ID**.
Tenant is no longer client-supplied — it is bound to the user record and
enforced at the data-access boundary.

### User Model

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### API Key Model

```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);
```

### Password Hashing

`node:crypto.scrypt` — no external dependency. Salt per hash, 64-byte output,
N=16384, r=8, p=1 (OWASP recommendation for scrypt).

### JWT

HS256 with `ATLASLINK_JWT_SECRET` env var (32+ bytes). Payload: `{ sub: userId, tenant: tenantId, iat, exp }`. 7-day expiry. No external dependency — HMAC via `node:crypto.createHmac`.

### Auth Middleware

`registerAuthGate()` replaces `registerTokenGate()`:

- Extract bearer from `Authorization` header
- Try JWT verification first → extract `{ userId, tenantId }`
- Fall back to API key lookup → extract `{ userId, tenantId }`
- Set `request.auth = { userId, tenantId, kind: 'jwt' | 'key' }`
- Fail-closed: no valid auth → 401

### Tenant Enforcement

All data access goes through `tenantBackendForRequest()` which reads
`request.auth.tenantId`. The `x-tenant-id` header is rejected with 400 if
present (deprecated, no longer trusted).

### Backward Compatibility

- `ATLASLINK_API_TOKEN` still works as a fallback for existing deployments
- First user registration is open (no admin gate) for initial setup
- Existing sessions without `user_id` are owned by `DEFAULT_TENANT_ID`

## Consequences

- **Positive:** Per-user isolation, audit trail attribution, per-user rate limits, API key rotation
- **Positive:** No new dependencies (scrypt + HMAC are in `node:crypto`)
- **Negative:** Migration required for existing deployments (add `users` table, migrate sessions)
- **Negative:** JWT secret management (`ATLASLINK_JWT_SECRET` must be set and rotated)

## Migration Path

1. Deploy schema migration (v4: users + api_keys tables)
2. Set `ATLASLINK_JWT_SECRET` env var
3. Register first admin user via `POST /auth/register`
4. Existing bearer token continues to work as API key equivalent
5. Remove `ATLASLINK_API_TOKEN` fallback in a future release
