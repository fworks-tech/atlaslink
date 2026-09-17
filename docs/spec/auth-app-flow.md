# Auth-Gated App Flow + Landing Page — Specification

**Date:** 2026-09-17
**Status:** Accepted
**Input:** user direction 2026-09-17 (projects belong to users; `/` becomes a landing page; app at `/atlas`; "My Atlas" entry point)
**Reference:** agenthood-site landing (c:\github\agenthood-site)

---

## 1. Problem

Every dashboard visitor rides the BFF-injected shared token: everyone lands in the
`default` tenant and sees every session, projects are global, and the sidebar renders
for anonymous visitors. Sessions can be created without a project, so they pile up
unassigned. There is no marketing surface for visitors and no account surface at all,
even though the daemon has had complete JWT auth + tenant scoping since ADR-008.

## 2. Decisions (user-confirmed 2026-09-17)

| Decision | Choice |
|---|---|
| App route | `/` becomes the landing page; the app moves to `/atlas` |
| Anonymous access | Public demo: `/atlas` works without an account on the shared tenant, with a "sign in to keep your sessions" banner; signing in upgrades the tenant |
| Sessions ↔ projects | Every session belongs to a project; a per-user default project ("inbox") is auto-created at registration; the composer requires a project |
| Landing scope | Mirror agenthood-site's structure with Atlaslink copy |

## 3. Phases (stacked branches)

### Phase 1 — `feat/auth-session` (dashboard auth plumbing, no routing change)

The daemon needs nothing; everything is dashboard-side.

- `dashboard/src/lib/auth.ts`: JWT storage (localStorage `atlaslink:auth:jwt`,
  corruption-tolerant like `uiPrefs.ts`), decode payload (sub/tenant/email claims
  without verification — server verifies), `saveAuth/clearAuth/loadAuth`.
- `fetchJSON` attaches `Authorization: Bearer <jwt>` when present (browser header
  wins over the BFF's legacy-token fallback — the BFF already forwards it, `route.ts:44-45`).
- `/login` route: register + login forms (email/password) posting to `/api/auth/register`
  / `/api/auth/login`, storing the returned JWT, redirecting to `/atlas`.
- Header: "My Atlas" button (anonymous → `/login`, authenticated → `/atlas` showing
  the email + sign-out). Sign-out clears storage.
- `useAuth` hook: react state synced to the stored JWT (decode sub/email).

**Acceptance criteria**
- [ ] Register creates a user, stores a JWT, header shows the email
- [ ] Login with the same credentials works; wrong password surfaces a form error
- [ ] `fetchJSON` sends the browser bearer on every call when logged in; requests
      then resolve into the user's tenant (empty first — their own sessions)
- [ ] Sign-out clears the JWT; anonymous calls fall back to the shared token
- [ ] Invalid/expired JWT: any 401 clears storage and the UI returns to demo mode

### Phase 2 — `feat/landing-page` (landing + app move)

- `/` → landing page adapted from agenthood-site: hero, stats band, preview band
  (live-demo CTAs), members grid, how-it-works, final CTA — Atlaslink copy:
  "Atlas holds the sky of sessions", members of the Agenthood society, live-diagram
  proof point. Reuse `FadeIn`; no new deps.
- App moves to `/atlas` (HomeClient becomes `atlas/page.tsx` content); `/?session=…`
  legacy links 301-redirect to `/atlas?session=…` preserving the query; `/s/[token]`
  untouched.
- "My Atlas" header button on the landing page too.
- The last-session auto-restore keeps working under `/atlas`.

**Acceptance criteria**
- [ ] `/` renders the landing page; hero CTA → `/atlas` (or `/login` when demo intent)
- [ ] Old `/?session=X` links land on `/atlas?session=X`
- [ ] `/atlas` is the current HomeClient experience; tests re-pointed
- [ ] Landing is a server component with client islands only where needed

### Phase 3 — `feat/sessions-in-projects` (daemon + composer)

- Daemon: registration auto-creates the user's default project (id `proj-inbox-<user>`
  or ULID, name "inbox", tenant = user tenant).
- `POST /v1/tasks`: `projectId` becomes **required** (400 when absent; validated
  non-empty ≤200 chars).
- Composer: project select always visible (no "no project" option), defaults to
  inbox for logged-in users; sidebar loses the "unassigned" group.
- Migration/compat: existing no-project sessions stay readable (share links, history);
  only *new* creation requires a project.

**Acceptance criteria**
- [ ] Registration yields a project "inbox" in the user's tenant
- [ ] `POST /v1/tasks` without projectId → 400 with the error envelope
- [ ] Composer cannot submit without a project; tests updated

## 4. Out of Scope

- OAuth/social login (email+password only, matching daemon capability)
- Password reset / email verification (no mailer in the daemon)
- API-key management UI (endpoints exist; separate issue)
- Migrating the existing `default`-tenant sessions to real users

## 5. Testing Strategy

- Phase 1: vitest unit tests for `lib/auth.ts` storage round-trip/decode; component
  tests for the login forms (success/error paths); wiring tests for header identity.
- Phase 2: landing page render snapshot-lite tests (sections present, CTAs link
  correctly); redirect test for legacy `/?session=`.
- Phase 3: daemon tests for required projectId + inbox auto-creation (extend
  `backendContract`/authRoutes tests); composer tests updated.
- Full gates per repo AGENTS.md before each merge.

## 6. Open Questions (deferred)

- Rate limiting on register/login (daemon has a root rate limit; rely on it first).
- Password recovery (no mailer) — file an issue when needed.
- Whether the demo tenant should get a distinct display label ("demo") in the UI —
  deferred to Phase 2 polish.
