# Spec: AWS Deployment (EC2 + RDS + Router)

Tracks #328; decommission tracked separately in #329. Decision record:
ADR-013.

## Problem

Render's free tier gives the daemon an ephemeral filesystem (sessions ride a
bind mount over a disk that resets) and suspends under idle; Oracle is a
manually deployed VM with no CI/CD. Neither offers managed persistence,
secrets, or monitoring, and the DR runbook exists mostly to diagnose the
former's suspensions.

## Proposed Solution

A single EC2 stack runs the containers that already exist locally — daemon,
Cosmo router, Caddy — with Postgres moved to RDS and secrets to SSM.
Deploys are GitHub Actions after green CI on main. Staging is proven on a
dedicated DNS name before production traffic moves.

```
Vercel dashboard ──BFF──▶ https://staging.atlas.flabs.tech (Caddy :443)
                             ├─ /graphql*      → router:3002 (baked config)
                             ├─ /health/ready  → router:3002
                             └─ default        → backend:3000 (daemon)
                                                  └─ ATLASLINK_DATABASE_URL → RDS Postgres
```

### Components

| Piece | Where it lives | Notes |
|---|---|---|
| `Dockerfile` `router` stage | new | Cosmo binary + `router.yaml` + `deploy/aws/router.overrides.yaml` + composed `router-config.json` baked at build (`npm run compose` equivalent, hermetic); `runtime` stays the last stage so `build: .` keeps meaning the daemon (Render parity) |
| `Dockerfile` `runtime` stage | changed | installs `git` — the files subgraph shells out to it and every container image (Render included) has been missing it |
| `docker-compose.aws.yml` | new | overrides Caddy mount, adds `router` service (`build.target: router`); base file untouched (Render keeps working) |
| `deploy/aws/Caddyfile` | new | staging host; `/graphql*` and `/health/ready*` → router, rest → daemon; api host block commented for #329 |
| `deploy/aws/router.overrides.yaml` | new | `listen_addr: 0.0.0.0:3002`, subgraph URLs → `http://backend:3000/v1/graphql/<name>` |
| `.github/workflows/deploy-aws.yml` | new | mirrors `deploy-render.yml` gates; SSH `git pull && docker compose … up -d --build`; polls `/health` build marker; skips silently until secrets exist |
| `docs/runbooks/aws-deploy.md` | new | account, EC2, Docker, RDS, SSM, DNS, first boot, verification, CI secrets |
| `render.yaml`, `deploy-render.yml` | untouched | removed in #329 only after soak |

### Deploy flow

1. Green CI on `main` → `deploy-aws.yml`
2. Runner SSHes to EC2: `git pull --ff-only` + `docker compose -f
   docker-compose.yml -f docker-compose.aws.yml up -d --build`
3. Runner polls `https://staging.atlas.flabs.tech/health` until the
   `"providers":N` build marker matches current build (5 min budget)
4. Failure fails the workflow — stale or suspended services must not read green

## Out of Scope

- CloudWatch logs/alarms, Cognito, S3 archives (future issues, per ADR-013)
- Render/Oracle decommission (#329), production DNS cutover (#329)
- Application code changes beyond what deployment needs (none expected)
- AppSync, ECS/EKS, Lambda in the write path — rejected in ADR-013 or future
- Dashboard changes (stays on Vercel)

## Acceptance Criteria

- [ ] `docker compose -f docker-compose.yml -f docker-compose.aws.yml config` validates
- [ ] Router image builds (`--target router`) and boots with
      `/health/ready` → `OK` on local verification
- [ ] Local federated probe: tokenless query → `401`, same query with
      `Authorization: Bearer` → data across at least two subgraphs in one
      request (the router propagates the caller's credential)
- [ ] Caddy config passes `caddy validate`
- [ ] Staging URL serves: daemon `/health` build marker, one federated query
      on `/graphql` (entity hop), one session run committing to the workspace,
      backend backed by RDS (`ATLASLINK_DATABASE_URL` set)
- [ ] `deploy-aws.yml` goes green on a main push with secrets configured
- [ ] Secrets live in SSM → untracked `.env` on EC2; nothing secret in git

## Testing Strategy

- Local: compose `config` validation, router stage build + boot smoke
  (`/health/ready`), `caddy validate` — all runnable before any AWS resource
- CI: existing gates + workflow lint via Actions parse on push
- Staging (operator, runbook §verify): full loop — createSession via
  `/graphql`, workspace commit check, RDS row visible after restart

## Open Questions

- Post-cutover log shipping (CloudWatch agent vs plain SSH tail) deferred to
  the observability issue — no decision needed to ship this.
- Whether the router image should publish to ECR later (faster deploys than
  rebuilding on the instance) — revisit if instance build time hurts.
