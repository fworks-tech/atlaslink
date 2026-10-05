# ADR-013: AWS as the deployment target

**Date:** 2026-10-03
**Status:** Accepted

## Context

Production has run on two free tiers chosen for cost, not design: Render
(`render.yaml`, Docker web service) whose filesystem is ephemeral across
deploys — sessions depend on a bind mount over a disk that resets — and whose
free instances suspend, and Oracle Cloud Always Free (`docs/tasks/deploy-oracle-free-tier.md`),
a manually operated VM with SSH-driven deploys and no CI/CD. Neither offers
managed persistence, secrets management, or first-class monitoring. The
operator also wants the deployment itself to be portfolio-relevant (AWS +
GraphQL), and the DR runbook has grown into a diagnosis guide for Render
suspensions.

## Decision

Move hosting to the AWS 12-month free tier, in verified phases (#328, then
#329 to decommission):

- **EC2 t4g.micro** (ARM, 750h/mo free) runs the existing compose stack:
  daemon (backend), Cosmo router, and Caddy — the same containers as local.
- **RDS PostgreSQL db.t3.micro** (750h/mo free) becomes the session/event
  store via `ATLASLINK_DATABASE_URL`, exercising the Postgres backend path
  already standardised in ADR-006/ADR-010 instead of ephemeral SQLite.
- **SSM Parameter Store** holds secrets; the EC2 instance profile pulls them
  into an untracked `.env` on first boot.
- **The router ships as a Dockerfile stage** (`target: router`): the Cosmo
  binary, `router.yaml`, the AWS overrides, and the composed execution config
  are all baked at image build — the deploy needs no host Node, no control
  plane, and no extra registry.
- **GitHub Actions (`deploy-aws.yml`)** deploys after green CI on main over
  SSH: `git pull && docker compose up -d --build`, then polls the staging
  `/health` build marker before going green.
- Staging (`staging.atlas.flabs.tech`) is verified first; production DNS
  flips only after soak, then Render and the Oracle docs are removed (#329).
- The dashboard stays on Vercel — AWS + Vercel hybrid is the intended shape.

## Alternatives Considered

| Option | Pros | Cons | Why Rejected |
|--------|------|------|--------------|
| Keep Render (add disk) | Zero work | Persistent disks cost, still no SSM/managed DB, instance suspends | The problem, not a fix |
| Keep Oracle, add CI/CD | Always-free budget is richer | Manual VM remains a snowflake; no managed services story | Portfolio goal wants AWS anyway |
| ECS Fargate | "Real" AWS container story | Fargate is outside the free tier — a bill from day one | Violates the free-tier constraint |
| EKS | Kubernetes résumé line | No free tier, heavy operations for a two-person system | Scale the problem does not have |
| AppSync as the GraphQL edge | Managed GraphQL, subscriptions | Does not speak Apollo federation; would fork the graph layer in two | Federation (ADR-011) is the product; router stays the edge |
| S3 as workspace storage | Managed, durable | Loses git history, diffs, attribution, `session:` trailers (ADR-012) | Git is the source of truth; S3 is a future *archive* of it |

## Consequences

- One cloud, one deploy path, managed Postgres — the DR runbook collapses to
  EC2 rebuild + RDS restore.
- The free-tier clock (12 months) starts at account creation; after it, the
  honest cost is low single digits/month (t3.micro class + db.t3.micro).
- Docker images build on ARM — the base image is multi-arch, so this is
  transparent until an arch-specific native dependency appears.
- Secrets move out of repo-generated env vars into SSM, tightening ADR-008's
  production posture.
- Future phases are unblocked without re-deciding the target: CloudWatch
  observability, Cognito auth, S3 workspace archives, and event-driven
  consumers (Lambda on session/file events, e.g. dataset exports for #306).

## References

- Issues #328 (migration), #329 (decommission)
- ADR-006 (Fastify/Postgres), ADR-010 (backend standardisation),
  ADR-011 (federation), ADR-012 (git-backed workspace), ADR-008 (auth/tenancy)
- `docs/spec/aws-deployment.md`, `docs/runbooks/aws-deploy.md`
