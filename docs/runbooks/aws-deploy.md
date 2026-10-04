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

## 4. DNS (staging)

In Vercel DNS for `flabs.tech`:

```
staging  A  <EC2_PUBLIC_IP>
```

Caddy provisions the Let's Encrypt certificate on first request to the host.

## 5. Secrets → SSM Parameter Store

```bash
aws ssm put-parameter --name /atlaslink/OPENCODE_API_KEY   --type SecureString --value "<key>"
aws ssm put-parameter --name /atlaslink/GROQ_API_KEY       --type SecureString --value "<key>"
aws ssm put-parameter --name /atlaslink/ATLASLINK_API_TOKEN --type SecureString --value "$(openssl rand -hex 32)"
aws ssm put-parameter --name /atlaslink/ATLASLINK_JWT_SECRET --type SecureString --value "$(openssl rand -hex 32)"
aws ssm put-parameter --name /atlaslink/ATLASLINK_DATABASE_URL --type SecureString \
  --value "postgresql://atlas:<password>@atlaslink.xxxxx.us-east-1.rds.amazonaws.com:5432/atlaslink"
```

## 6. First boot on the instance

```bash
ssh -i atlaslink.pem ubuntu@<EC2_PUBLIC_IP>

# Docker (Ubuntu 24.04 ships without it)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

git clone https://github.com/fworks-tech/atlaslink.git && cd atlaslink

# Untracked .env assembled from SSM (instance profile authenticates the CLI)
{
  echo "ATLASLINK_HOST=0.0.0.0"
  echo "ATLASLINK_PORT=3000"
  for p in OPENCODE_API_KEY GROQ_API_KEY ATLASLINK_API_TOKEN ATLASLINK_JWT_SECRET ATLASLINK_DATABASE_URL; do
    echo "$p=$(aws ssm get-parameter --name /atlaslink/$p --with-decryption --query Parameter.Value --output text)"
  done
} > .env && chmod 600 .env

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
| `AWS_DEPLOY_HOST` | `<EC2_PUBLIC_IP>` (or DNS) |
| `AWS_DEPLOY_KEY` | full contents of `atlaslink.pem` |

Pin the host key before trusting the first deploy: `ssh-keyscan <EC2_PUBLIC_IP>`
from a trusted network and keep it (the workflow uses
`accept-new`, which trusts on first contact — tightening that, restricting the
deploy key, and a build-sha health marker are tracked in #329).

Push to `main` → green CI → `deploy-aws.yml` pulls, rebuilds, and polls the
staging health marker. Until these secrets exist the workflow skips silently
and Render keeps deploying (parallel running is intentional).

## 9. Cutover (issue #329)

After a soak period on staging: point `api.atlas.flabs.tech` at the EC2 IP,
uncomment the api block in `deploy/aws/Caddyfile`, update the Vercel
dashboard's `ATLASLINK_API_URL`, then decommission Render and this runbook's
Oracle sibling per #329.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker compose` fails on `.env` | §6 didn't run, or SSM parameters are missing (`aws ssm get-parameter …` as the `ubuntu` user) |
| Cert not issued | DNS not resolving yet, or port 443 SG closed — Caddy retries once DNS is right |
| `/health` keeps returning old `"providers"` | Image build failed on the instance: `docker compose -f docker-compose.yml -f docker-compose.aws.yml build` and read the router stage output |
| `/health/ready` not OK | Router can't reach subgraphs: `docker compose logs router` — `backend:3000` must resolve on the compose network |
| Deploy workflow red at the poll step | SSH/deploy worked but the marker never matched — same log commands as above |
| First deploy ever fails the 5-min poll | Let's Encrypt issuance on the fresh hostname can eat the budget — confirm `/health` manually after the cert lands, re-run the job |
| Free tier nearing 12 months | Budget alarm in Cost Explorer; expected post-free cost is low single digits/month |
