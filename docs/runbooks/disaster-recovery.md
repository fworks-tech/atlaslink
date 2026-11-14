# Disaster Recovery Plan

**Date:** 2026-11-14
**Status:** Active
**Owner:** Atlaslink Team

---

## Overview

Recovery procedures for the AWS stack that serves
[atlas.flabs.tech](https://atlas.flabs.tech). Render and Oracle are retired;
this runbook covers EC2 + RDS + Vercel only.

## Architecture

```
Browser ─▶ https://atlas.flabs.tech        (Vercel, Next.js + BFF /api/*)
               │  injects ATLASLINK_API_TOKEN server-side
               ▼
           https://api.atlas.flabs.tech    (Caddy on EC2, Let's Encrypt)
               │
               ▼
           backend:3000 (Fastify)  ──▶  RDS Postgres 16
               │                         atlaslink.cqz4ocg6of03.us-east-1.rds.amazonaws.com
               └──▶ docker volume atlaslink-data (/app/data, NDJSON event log)
```

| Component | Reality |
|---|---|
| EC2 | `t4g.micro`, `us-east-1d`, `i-06f5ce7c361a2e8b1`, Elastic IP `100.58.138.196` |
| Host names | `api.atlas.flabs.tech` and `staging.atlas.flabs.tech` — same stack, same store, same Caddy site block |
| RDS | `db.t3.micro`, Postgres 16.15, 20 GB, **single AZ**, automated backups retained **1 day** |
| Secrets | SSM `/atlaslink/{OPENCODE_API_KEY,ATLASLINK_API_TOKEN,ATLASLINK_JWT_SECRET,ATLASLINK_DATABASE_URL}` |
| Dashboard | Vercel project `atlaslink-dashboard` (Hobby) |
| Event log | Docker volume, not backed up — sessions in RDS are the source of truth |

## Targets

| Metric | Value | Why |
|---|---|---|
| RPO | 24 h | RDS keeps 1 day of automated backups (free tier cap) |
| RTO | ~1 h | restore snapshot + recreate backend |

Anything older than 24 h is unrecoverable from AWS alone. Take a manual
snapshot before any migration or destructive maintenance:
`aws rds create-db-snapshot --db-instance-identifier atlaslink --db-snapshot-identifier atlaslink-pre-<change>-$(date +%Y%m%d)`.

## Access

```bash
aws ssm start-session --target i-06f5ce7c361a2e8b1   # or: ssh -i atlaslink.pem ubuntu@100.58.138.196
cd ~/atlaslink
docker compose -f docker-compose.yml -f docker-compose.aws.yml ps
```

## Scenario 1 — Backend down or serving a stale build

**Symptoms:** `https://api.atlas.flabs.tech/health` non-200, 5xx from the BFF,
`providers` missing, or `/health` answering with an old `"providers"` count.

```bash
cd ~/atlaslink
docker compose -f docker-compose.yml -f docker-compose.aws.yml logs --tail=100 backend
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build backend
```

If `/health` is fine but routes 404, Caddy is serving an old inode after
`git pull` — recreate it:

```bash
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --force-recreate caddy
```

Verify: `/health` → `"providers"` >= 1, `/health/ready` → `OK`, and a tokenless
subgraph query → `401`:

```bash
curl -fsS https://api.atlas.flabs.tech/health
curl -fsS https://api.atlas.flabs.tech/health/ready
curl -sS -X POST https://api.atlas.flabs.tech/graphql \
  -H 'content-type: application/json' -d '{"query":"{ sessions { total } }"}'
```

## Scenario 2 — Database lost or corrupted

RDS automated backups keep 1 day. Restore into a **new** instance rather than
overwriting the broken one:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier atlaslink \
  --target-db-instance-identifier atlaslink-restored \
  --db-instance-class db.t3.micro \
  --db-subnet-group-name atlaslink-db-subnets \
  --vpc-security-group-ids sg-019cea876264ae2b9 \
  --restore-time "$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%SZ)"
```

The subnet group and security group are not optional: without them the restore
lands in the default ones and the EC2 host cannot reach port 5432. The restored
instance keeps the source master password.

Then, on the EC2 host, repoint the stack at the restored endpoint:

1. Update `/atlaslink/ATLASLINK_DATABASE_URL` in SSM (keep `?sslmode=verify-full`
   and the same user/password).
2. Copy the new value into `~/atlaslink/.env` — §5 writes the parameter and §6
   shows the loop that assembles the file.
3. `docker compose ... up -d --force-recreate backend`.
4. Verify counts:
   `select (select count(*) from users), (select count(*) from sessions), (select count(*) from projects);`

Sessions and API keys are in RDS; the NDJSON event log volume is not restored —
the dashboard rebuilds session state from Postgres, so history survives with
gaps in per-event detail.

**Deleted a single row?** Restore the snapshot into `atlaslink-restored`, copy
the rows out with `psql`, and insert them back; do not point the app at the
restored instance for a one-row fix.

## Scenario 3 — DNS record missing

Observed once on `atlas.flabs.tech` (2026-11-13): the record vanished and the
dashboard returned 5xx while the API stayed healthy. Nothing monitors it yet.

The zone runs on **Vercel DNS** (`ns1.vercel-dns.com`) — there is no Route 53
zone for `flabs.tech`. Recreate the records in Vercel → Domains → `flabs.tech`
→ DNS Records:

| Name | Type | Value | Record ID (to spot the right row) |
|---|---|---|---|
| `atlas` | ALIAS | `cname.vercel-dns.com` | `rec_d2d98bfbe669649637f95fbc` |
| `api.atlas` | A | `100.58.138.196` (EIP) | `rec_3a09800dbd5074f43fd2136f` |
| `staging.atlas` | A | `100.58.138.196` (EIP) | `rec_8e68da9992a70330fbdb412d` |

After recreating, wait for propagation and re-check
`https://atlas.flabs.tech/api/health` → `"providers"` >= 1. If Caddy logged an
ACME failure meanwhile, it retries on its own.

## Scenario 4 — TLS or database certificate failure

| Log line | Fix |
|---|---|
| `no pg_hba.conf entry ... no encryption` | `ATLASLINK_DATABASE_URL` lost `?sslmode=verify-full` |
| `self-signed certificate in certificate chain`, `unable to verify the first certificate` | refresh the RDS CA bundle: `curl -fsS https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o certs/global-bundle.pem`, then recreate the backend |
| ACME failure in Caddy logs | DNS not pointing at the EIP yet, or the Caddyfile `acme_ca` was changed away from `https://acme-v02.api.letsencrypt.org/directory` |

## Scenario 5 — Total loss (instance terminated, AMI gone)

The stack is disposable; only RDS is not.

1. Restore RDS into a new instance (Scenario 2) if the database is gone.
2. Follow [aws-deploy.md](aws-deploy.md) §1–§7 to provision the instance, security
   groups, EIP, SSM parameters, and `certs/global-bundle.pem`.
3. Point `api.atlas` / `staging.atlas` at the new EIP.
4. Run **Actions → Deploy AWS → Run workflow** (or push to `main`) and wait for
   the poll of both hosts to pass.
5. Vercel needs no change unless `ATLASLINK_API_TOKEN` was rotated.

Expected cost of an unplanned rebuild: ~30–60 min of manual work plus backup
restore time.

## Scenario 6 — Dashboard (Vercel)

```bash
cd dashboard
npx vercel rollback          # to the previous production deployment
npx vercel --prod            # or redeploy the current commit
```

Rollback only reaches deployments that already carry the current
`ATLASLINK_API_URL` / `ATLASLINK_API_TOKEN` — both are Sensitive, so they cannot
be read back. If a bad env value shipped, set it again and redeploy instead of
rolling back.

## Monitoring & alerting

**Gap, by design of the free tier:** there is no uptime monitor on
`atlas.flabs.tech` or `api.atlas.flabs.tech` — the DNS loss in Scenario 3 was
found by a user. Until a monitor exists, run the health check manually after
each deploy and when a user reports a 5xx.

| Check | Healthy |
|---|---|
| `GET https://api.atlas.flabs.tech/health` | `ok:true`, `"providers"` >= 1 |
| `GET https://api.atlas.flabs.tech/health/ready` | `OK` |
| `GET https://atlas.flabs.tech/api/health` | `"providers"` >= 1 (via BFF) |
| `GET https://atlas.flabs.tech/api/tasks` | `ok:true`, sessions list |
| RDS FreeStorageSpace | > 2 GB |
| EC2 status checks | 2/2 |

## References

- [Deploy runbook](aws-deploy.md) — provisioning, TLS, deploy gate, troubleshooting
- [AWS RDS backup and restore](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_BackupRestore.html)
- [Vercel rollback](https://vercel.com/docs/deployments/rollback)
- [AWS deployment spec](../spec/aws-deployment.md)
