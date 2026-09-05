# Auth API — Specification

**Date:** 2026-09-05
**Status:** Accepted (shipped in PR #185)
**Issue:** #101, #102, #126, #127, #142, #143
**ADR:** [ADR-008: Authentication & Tenancy](../adr/ADR-008-auth-and-tenancy.md)

---

## 1. Overview

Atlaslink implements a dual-auth model:

- **JWT sessions** for dashboard users (human-facing)
- **API keys** for programmatic access (machine-facing)

Both resolve to a **user identity** carrying a **tenant ID**. The legacy shared bearer token (`ATLASLINK_API_TOKEN`) is supported as a fallback.

## 2. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLASLINK_JWT_SECRET` | Yes (for JWT auth) | Secret for HS256 JWT signing. Minimum 32 bytes recommended. |
| `ATLASLINK_API_TOKEN` | No | Legacy shared bearer token. Still works as fallback. |
| `ATLASLINK_SIGNING_SECRET` | No | HMAC-SHA256 secret for webhook signing. |

When neither `ATLASLINK_JWT_SECRET` nor `ATLASLINK_API_TOKEN` is set, the API is unauthenticated on loopback binds and refuses to start on non-loopback binds (fail-closed).

## 3. Authentication Flow

```
Client → Authorization: Bearer <token>
       ↓
  extractBearer()
       ↓
  ┌─ verifyJwt(token) ─── valid? → { userId, tenantId, kind: 'jwt' }
  │
  ├─ hashApiKey(token) + DB lookup ─── found? → { userId, tenantId, kind: 'api_key' }
  │                                      (fire-and-forget touchApiKey)
  │
  ├─ safeEqual(token, ATLASLINK_API_TOKEN) ─── match? → { userId: 'system', tenantId: 'default', kind: 'legacy' }
  │
  └─ 401 unauthorized
```

## 4. Endpoints

### 4.1 Ungated Routes (no auth required)

#### POST /auth/register

Create a new user account and receive a JWT.

**Request Body**
```json
{
  "email": "user@example.com",    // required, valid email format
  "password": "securepass123",     // required, 8-128 characters
  "tenantId": "my-tenant"          // optional, defaults to "default"
}
```

**Responses**
| Status | Body | Description |
|--------|------|-------------|
| 201 | `{ ok: true, token, user: { id, email, tenant_id } }` | Account created |
| 400 | `{ ok: false, error: "invalid email" }` | Email format invalid |
| 409 | `{ ok: false, error: "email already registered" }` | Duplicate email |

**Password Storage:** scrypt (N=16384, r=8, p=1) with random 16-byte salt.

#### POST /auth/login

Authenticate with email and password, receive a JWT.

**Request Body**
```json
{
  "email": "user@example.com",
  "password": "securepass123"
}
```

**Responses**
| Status | Body | Description |
|--------|------|-------------|
| 200 | `{ ok: true, token, user: { id, email, tenant_id } }` | Login successful |
| 401 | `{ ok: false, error: "invalid credentials" }` | Bad email or password |

**Security:** Failed attempts are logged with email/userId for intrusion detection. Same error message for both cases (no user enumeration).

**JWT Payload:**
```json
{
  "sub": "user-id",
  "tenant": "tenant-id",
  "iat": 1788581563,
  "exp": 1789186363
}
```
Expiry: 7 days from creation.

### 4.2 Gated Routes (auth required)

All gated routes require `Authorization: Bearer <jwt_or_api_key>`.

#### POST /auth/keys

Create a new API key.

**Request Body**
```json
{
  "name": "my-app-key"    // required, 1-100 characters
}
```

**Responses**
| Status | Body | Description |
|--------|------|-------------|
| 201 | `{ ok: true, key: "ak_...", id, name, created_at }` | Key created |
| 401 | `{ ok: false, error: "unauthorized" }` | No valid auth |

**Security:** The plaintext key (`ak_...`) is returned only once in the response. It is stored as a SHA-256 hash in the database and cannot be recovered.

#### GET /auth/keys

List all API keys for the authenticated user.

**Responses**
| Status | Body | Description |
|--------|------|-------------|
| 200 | `{ ok: true, keys: [{ id, name, created_at, last_used_at }] }` | Key list |

#### DELETE /auth/keys/:keyId

Revoke an API key. Users can only revoke their own keys.

**Responses**
| Status | Body | Description |
|--------|------|-------------|
| 200 | `{ ok: true }` | Key revoked |
| 404 | `{ ok: false, error: "key not found" }` | Key doesn't exist or belongs to another user |

#### GET /auth/me

Get the current authenticated user's profile.

**Responses**
| Status | Body | Description |
|--------|------|-------------|
| 200 | `{ ok: true, user: { id, email, tenant_id } }` | User profile |
| 401 | `{ ok: false, error: "unauthorized" }` | No valid auth |

## 5. Tenant Isolation

Tenant is derived from the authenticated user's identity (`request.auth.tenantId`). The `x-tenant-id` header is **rejected** with 400 when auth is present — tenants cannot be spoofed.

For legacy unauthenticated access, `x-tenant-id` is still honored (backward compatibility).

## 6. Rate Limiting

| Scope | Limit | Key |
|-------|-------|-----|
| Global | 100 req/min | User ID (or IP if unauthenticated) |
| `/auth/register` | Inherits global | — |
| `/auth/login` | Inherits global | — |

Per-endpoint rate limits on auth routes are recommended for production (see issue #126 follow-up).

## 7. Security Headers

All responses include:
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

## 8. Request Signing

HMAC-SHA256 signing for webhook payloads. See `src/api/signing.ts`.

```typescript
import { signPayload, verifySignature, createSignedWebhook } from './api/signing'

// Sign a payload
const sig = signPayload({ event: 'session.created', sessionId: 'abc' })

// Verify a signature
const valid = verifySignature(payload, signature)

// Create a signed webhook envelope
const webhook = createSignedWebhook({ event: 'session.succeeded' })
// → { payload, signature, algorithm: 'sha256' }
```

Requires `ATLASLINK_SIGNING_SECRET` env var.

## 9. Migration

Database migration v4 (`src/session/migrations.ts`) creates:
- `users` table: id, email (unique), password_hash, tenant_id, timestamps
- `api_keys` table: id, user_id (FK), key_hash, name, tenant_id, timestamps

Existing sessions without a `user_id` belong to the `default` tenant.

## 10. Backward Compatibility

- `ATLASLINK_API_TOKEN` still works as a shared bearer token
- First user registration is open (no admin gate)
- `x-tenant-id` header honored for unauthenticated requests
