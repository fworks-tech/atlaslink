# Runbook: AWS deployment (EC2 + RDS + Cosmo Router)

Deploys the full stack to the AWS 12-month free tier (ADR-013, issue #328).
Staging is proven on `staging.atlas.flabs.tech` before any production DNS
move; Render and Oracle are retired afterwards in #329.

```
Vercel dashboard ──BFF──▶ Caddy (:80/:443, EC2)
                            ├─ /graphql*, /health/ready → router:3002
                            └─ everything else          → backend:3000
                                                            └─ RDS Postgres (db.t3.micro)
```

## 1. AWS account and CLI

1. Create an account at aws.amazon.com (free tier starts **today**, 12-month
   clock). A card is required for identity; free-tier resources are not billed.
2. On your machine: install the AWS CLI v2 and configure an admin user
   (`aws configure`) — used below to push secrets to SSM and to fetch the
   RDS endpoint.

## 2. EC2 instance

**EC2 → Launch instance:**

| Setting | Value |
|---|---|
| Name | `atlaslink-staging` |
| AMI | Ubuntu 24.04 LTS (ARM) |
| Instance type | `t4g.micro` (free-tier eligible: 750h/mo) |
| Key pair | create/download one (`atlaslink.pem`) |
| Network | default VPC |
| Security group | new: `atlaslink` — inbound **22**, **80**, **443**. Port 22 must admit **both** you (manual ops) **and** the GitHub-hosted runner (deploy-aws egress IPs are dynamic — see github.com/meta for the current ranges). Practical minimum: your IP while bringing it up; if you enable the deploy workflow, either allow the runner ranges or 22/0.0.0.0/0 with key-only auth (accepted trade-off, documented here so it is a decision and not an accident) |
| IMDSv2 | Metadata → HttpTokens **required** (instance profile authenticates the secret pulls) |
| Storage | 8 GB gp3 (free: 30 GB) |
| IAM role | create `atlaslink-ec2` with **AmazonSSMManagedInstanceCore** **plus** the inline policy below (the managed policy does not grant `GetParameter`) |

Inline policy for `atlaslink-ec2` (first boot reads the secrets):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:*:*:parameter/atlaslink/*"
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "*",
      "Condition": { "StringEquals": { "kms:ViaService": "ssm.*.amazonaws.com" } }
    }
  ]
}
```

## 3. RDS Postgres (free tier)

**RDS → Create database:**

| Setting | Value |
|---|---|
| Engine | PostgreSQL 16 |
| Template | Free tier |
| Instance | `db.t3.micro`, 20 GB gp2 |
| DB name | `atlaslink` |
| Credentials | user `atlas`, strong password (note it) |
| VPC security group | new `atlaslink-db`: inbound **5432** from the EC2 SG only |

Wait for *Available*. Note the endpoint:
`atlaslink.xxxxx.us-east-1.rds.amazonaws.com`.

Staging uses the CLI equivalent (the master password is generated once and
lives only inside the SSM `ATLASLINK_DATABASE_URL`):

```bash
aws rds create-db-subnet-group --db-subnet-group-name atlaslink-db-subnets \
  --db-subnet-group-description "Atlaslink default VPC subnets" \
  --subnet-ids <subnet-a> <subnet-b>
# create atlaslink-db SG, then allow 5432 from the atlaslink EC2 SG
aws rds create-db-instance --db-instance-identifier atlaslink \
  --db-instance-class db.t3.micro --engine postgres --engine-version 16.15 \
  --master-username atlas --master-user-password "$DB_PASS" --db-name atlaslink \
  --allocated-storage 20 --storage-type gp2 --no-publicly-accessible \
  --vpc-security-group-ids <db-sg> --db-subnet-group-name atlaslink-db-subnets \
  --backup-retention-period 1 --no-multi-az --no-auto-minor-version-upgrade \
  --storage-encrypted
```

The AWS **Free plan** caps automated backup retention at 1 day; raising it
requires upgrading the account plan. #125 tracks the backup/restore drill.

## 4. DNS (staging)

In Vercel DNS for `flabs.tech`:

```
staging  A  <EC2_PUBLIC_IP>
```

The record must be an **A record to the Elastic IP**, not a Vercel domain
assignment. If `staging` resolves to `64.29.17.x` / `216.198.79.x`, the ACME
challenge lands on Vercel and fails; remove the staging domain from the Vercel
project before adding the record.

Caddy provisions the Let's Encrypt certificate on first request to the host.

## 5. Secrets → SSM Parameter Store

```bash
aws ssm put-parameter --name /atlaslink/OPENCODE_API_KEY   --type SecureString --value "<key>"
aws ssm put-parameter --name /atlaslink/GROQ_API_KEY       --type SecureString --value "<key>"
aws ssm put-parameter --name /atlaslink/ATLASLINK_API_TOKEN --type SecureString --value "$(openssl rand -hex 32)"
aws ssm put-parameter --name /atlaslink/ATLASLINK_JWT_SECRET --type SecureString --value "$(openssl rand -hex 32)"
aws ssm put-parameter --name /atlaslink/ATLASLINK_DATABASE_URL --type SecureString \
  --value "postgresql://atlas:<password>@atlaslink.xxxxx.us-east-1.rds.amazonaws.com:5432/atlaslink?sslmode=verify-full"
```

RDS enforces TLS. The backend verifies the server certificate against the RDS
global CA bundle at `certs/global-bundle.pem`, mounted by
`docker-compose.aws.yml` and exposed through `NODE_EXTRA_CA_CERTS`. The deploy
downloads it when missing; §6 does the same on a fresh host. Do not add
`uselibpqcompat` — it turns certificate verification off.

## 6. First boot on the instance

```bash
ssh -i atlaslink.pem ubuntu@<EC2_PUBLIC_IP>

# 2 GB swap: t4g.micro has 1 GB and the first compose build runs npm ci plus
# the better-sqlite3 node-gyp compile inside the image, which OOMs without it
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile \
  && sudo mkswap /swapfile && sudo swapon /swapfile \
  && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker (Ubuntu 24.04 ships without it)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

# AWS CLI v2: the .env loop reads SSM through the instance role
curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o /tmp/awscliv2.zip
sudo apt-get install -y unzip
sudo unzip -q -o /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install

git clone https://github.com/fworks-tech/atlaslink.git && cd atlaslink

# Untracked .env assembled from SSM (instance profile authenticates the CLI)
{
  echo "ATLASLINK_HOST=0.0.0.0"
  echo "ATLASLINK_PORT=3000"
  for p in OPENCODE_API_KEY GROQ_API_KEY ATLASLINK_API_TOKEN ATLASLINK_JWT_SECRET ATLASLINK_DATABASE_URL; do
    val=$(aws ssm get-parameter --name /atlaslink/$p --with-decryption --query Parameter.Value --output text 2>/dev/null) || continue
    [ -n "$val" ] && echo "$p=$val"
  done
} > .env && chmod 600 .env

# RDS CA bundle: the compose overlay mounts it into the backend and sets
# NODE_EXTRA_CA_CERTS. The deploy fetches it when it is missing.
mkdir -p certs
curl -fsS https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o certs/global-bundle.pem

docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
```

## 7. Verify staging

```bash
# daemon build marker (the deploy gate greps the same thing)
curl -fsS https://staging.atlas.flabs.tech/health          # "providers": >= 1

# router edge
curl -fsS https://staging.atlas.flabs.tech/health/ready    # OK

# federated graph — subgraphs are bearer-gated (ADR-008) and the router
# propagates the caller's Authorization, so the token is required here
TOKEN=$(aws ssm get-parameter --name /atlaslink/ATLASLINK_API_TOKEN \
  --with-decryption --query Parameter.Value --output text)
curl -fsS https://staging.atlas.flabs.tech/graphql \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"query":"{ __typename }"}'
```

Then the full loop: create a session through the graph, confirm the
workspace commit on the instance
(`git -C data/workspaces/<tenant>/<project> log`), restart the stack
(`docker compose … restart`) and confirm sessions survived on **RDS**
(nothing in `data/atlaslink.sqlite`).

## 8. Hook up CI/CD

Repo **Settings → Secrets and variables → Actions**:

| Name | Value |
|---|---|
| `AWS_DEPLOY_HOST` | Elastic IP (or DNS once it is proven) |
| `AWS_DEPLOY_KEY` | full contents of `atlaslink.pem` |

Use the Elastic IP for the host until DNS is proven; a stale hostname or key
turns the deploy into a failed SSH, not a deploy. Re-set both secrets after any
key rotation. On the canonical repo an empty `AWS_DEPLOY_HOST` fails the
workflow instead of reporting a green no-op.

Pin the host key before trusting the first deploy: `ssh-keyscan <EC2_PUBLIC_IP>`
from a trusted network and keep it (the workflow uses
`accept-new`, which trusts on first contact — tightening that, restricting the
deploy key, and a build-sha health marker are tracked in #329).

Push to `main` → green CI → `deploy-aws.yml` pulls, rebuilds, and polls the
staging and production health markers.

## 9. Cutover (issue #329)

`api.atlas.flabs.tech` and `staging.atlas.flabs.tech` front the same EC2 stack,
so the cutover is DNS plus a Vercel env swap, not a second deployment. Staging
and production share the RDS store: do not run destructive tests on staging.

1. Add the `api.atlas` A record pointing at the Elastic IP.
2. Before touching Vercel, copy the current Render service URL and its
   `ATLASLINK_API_TOKEN` value into the cutover issue (#329) or the team
   password manager. The Vercel values are Sensitive (write-only), and Hobby
   can only roll back to the immediately previous deployment.
3. Merge the address change in `deploy/aws/Caddyfile`; the deploy reloads Caddy
   and Let's Encrypt obtains the certificate. Verify the API directly before
   pointing the dashboard at it:
   `curl -fsS https://api.atlas.flabs.tech/health` (`"providers"` >= 1),
   `/health/ready` → `OK`, and a tokenless `/graphql` → `401`.
4. Set the Vercel dashboard's `ATLASLINK_API_URL` to
   `https://api.atlas.flabs.tech` and `ATLASLINK_API_TOKEN` to the value of
   `/atlaslink/ATLASLINK_API_TOKEN`; keep both Sensitive, then redeploy.
5. Verify `https://atlas.flabs.tech/api/health` reports `"providers"` >= 1 and
   `api/tasks` lists the RDS sessions.
6. The swap does not migrate accounts or API keys from the Render store.
   Recreate the production login and any API keys after the swap. The JWT
   secret also changes, so browsers holding an old JWT get `401` and must log
   in again.

Remaining for #329, after the soak:

1. Delete the Render service and remove `render.yaml` and
   `.github/workflows/deploy-render.yml`; remove any Render secrets if present.
2. Rewrite `docs/runbooks/disaster-recovery.md` around EC2 + RDS only.
3. Archive `docs/tasks/deploy-oracle-free-tier.md`.

Rollback: on Hobby only the immediately previous production deployment is
eligible, so the captured Render URL and token are the durable fallback — set
`ATLASLINK_API_URL` and `ATLASLINK_API_TOKEN` back to the Render values and
redeploy. Render sleeps when idle; expect a 30–60s cold start.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker compose` fails on `.env` | §6 didn't run, or SSM parameters are missing (`aws ssm get-parameter …` as the `ubuntu` user) |
| Startup logs `no pg_hba.conf entry ... no encryption` | `ATLASLINK_DATABASE_URL` is missing `?sslmode=verify-full` (§5) |
| Startup logs `self-signed certificate in certificate chain` or `unable to verify the first certificate` | `certs/global-bundle.pem` is missing or stale — the deploy downloads it; check the mount and `NODE_EXTRA_CA_CERTS` (§5, §6) |
| Build dies with `Killed` / exit 137 | Swap is missing (§6) — `npm ci` plus the `better-sqlite3` compile needs more than the 1 GB t4g.micro offers; `free -m` should show the swapfile |
| Cert not issued | DNS not resolving yet, or port 443 SG closed — Caddy retries once DNS is right |
| Caddy log shows `acme-staging-v02` | The Caddyfile must pin `acme_ca https://acme-v02.api.letsencrypt.org/directory`; reload Caddy |
| ACME challenge 404 from `64.29.17.x` / `216.198.79.x` | `staging` still points at Vercel; set the A record to the Elastic IP |
| Deploy workflow green but nothing deployed | `AWS_DEPLOY_HOST` was empty; the guard now fails instead of skipping |
| Cert still missing after DNS propagates | `docker compose -f docker-compose.yml -f docker-compose.aws.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile` |
| `/health` keeps returning old `"providers"` | Image build failed on the instance: `docker compose -f docker-compose.yml -f docker-compose.aws.yml build` and read the router stage output |
| `/health/ready` not OK | Router can't reach subgraphs: `docker compose logs router` — `backend:3000` must resolve on the compose network |
| Deploy workflow red at the poll step | SSH/deploy worked but the marker never matched — same log commands as above |
| First deploy ever fails the 5-min poll | Let's Encrypt issuance on the fresh hostname can eat the budget — confirm `/health` manually after the cert lands, re-run the job |
| Free tier nearing 12 months | Budget alarm in Cost Explorer; expected post-free cost is low single digits/month |
