# Deploy atlaslink to Oracle Cloud Always Free

Hosts the Fastify daemon at **zero cost** on Oracle Cloud Infrastructure's
Always Free tier, fronted by the Vercel dashboard at `https://atlas.flabs.tech`.
A local Postgres container on the VM provides durable sessions — no connection
limits, no sleeping, no dormancy deletion.

## Architecture

```
Browser ─▶ https://atlas.flabs.tech (Vercel Next.js)
               │ /api/*  (BFF route handler, injects the gate token server-side)
               ▼
Caddy (VM, :443) ─▶ backend:3000 (Fastify daemon in Docker)
                         │
                         ▼
                   postgres:5432 (local Postgres container)
```

## 1. Create the VM (OCI console)

1. Sign up at https://cloud.oracle.com (a card is required for identity
   verification but Always Free resources are never billed).
2. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 24.04** (or 22.04)
   - Shape: **Ampere A1** (ARM; richest free budget) — 2 OCPU / 12 GB is
     generous and still inside the monthly free allowance. `VM.Standard.E2.1.Micro`
     (1 OCPU / 1 GB) also works.
   - Add/keep your SSH key.
3. **Networking (VCN security list)** — add ingress rules:
   | Source | Port | Purpose |
   |--------|------|---------|
   | 0.0.0.0/0 | TCP 80 | Caddy (HTTP → HTTPS redirect, ACME challenge) |
   | 0.0.0.0/0 | TCP 443 | Caddy (TLS, dashboard proxy) |
   | 0.0.0.0/0 | TCP 22 | SSH (default) |
4. Note the **Public IP** assigned to the instance.

## 2. Add a DNS A record

In Vercel DNS (flabs.tech is Vercel-managed), add an **A record**:

```
api.atlas.flabs.tech → <PUBLIC_IP>
```

This enables the TLS subdomain. Caddy will auto-provision a Let's Encrypt
certificate on first boot.

## 3. SSH in and deploy

```bash
ssh -i ~/.ssh/<your_key> ubuntu@<PUBLIC_IP>

git clone https://github.com/fworks-tech/atlaslink.git
cd atlaslink
bash deploy/oracle/setup.sh      # installs Docker (you may need to re-login for group)
# re-login, then:
ATLASLINK_API_TOKEN=<daemon token> \
  OPENCODE_API_KEY=<opencode-go key> \
  POSTGRES_PASSWORD=<secure password> \
  bash deploy/oracle/deploy.sh
```

`deploy.sh` clones (or updates) `/opt/atlaslink`, writes `.env` from the
variables, builds the image, and starts the docker-compose stack (`backend` +
`postgres` + `caddy`). `ATLASLINK_API_TOKEN` **must equal** the value stored
on Vercel.

Verify: `curl https://api.atlas.flabs.tech/health` → `{"ok":true,"name":"atlaslink",…}`.

## 4. Point the dashboard at the VM

```bash
cd dashboard   # from the repo root
vercel env add ATLASLINK_API_URL production --value "https://api.atlas.flabs.tech" --yes
```

The `/api/*` BFF proxy on Vercel now reaches the VM server-side (no browser
mixed-content). The sidebar `ConnectionStatus` flips to **connected** once the
daemon responds.

Trigger a production redeploy in Vercel to pick up the new env var.

## 5. Verify end-to-end

1. Open https://atlas.flabs.tech
2. Create a task — it should appear in the sidebar
3. Check the session detail — events stream in real time
4. Confirm persistence: `curl https://api.atlas.flabs.tech/v1/tasks` returns
   the task you just created (proving Postgres is working)

## Migration from Render

If you're migrating from the Render free-tier interim:

1. Complete steps 1–4 above first.
2. Verify the Oracle backend works end-to-end.
3. Remove the Render services:
   - Render dashboard → `atlaslink-backend` → **Delete Service**
   - Render dashboard → `atlaslink-pg` → **Delete Database**
4. The Vercel dashboard now points exclusively at Oracle.

**Rollback**: If Oracle has issues, revert Vercel `ATLASLINK_API_URL` to the
Render URL and redeploy.

## Operations

- Logs: `cd /opt/atlaslink && docker compose logs -f backend`
- Restart daemon: `cd /opt/atlaslink && docker compose restart backend`
- Update daemon: `cd /opt/atlaslink && git pull && docker compose up -d --build`
- Postgres logs: `docker compose logs -f postgres`
- Postgres shell: `docker compose exec postgres psql -U atlas -d atlaslink`
- The Ampere free allowance (3000 OCPU-hours/mo) covers an always-on VM; the
  E2.Micro shape also fits the same budget.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `health` returns 500 | Postgres not ready | `docker compose logs postgres` — wait for "database system is ready" |
| `health` returns 404 | Caddy not routing | Check `docker compose logs caddy` and DNS A record |
| TLS certificate error | DNS not propagated or port 443 closed | Verify A record + VCN security list |
| Sessions lost on restart | `ATLASLINK_DATABASE_URL` not set | Check `.env` contains the database URL |
| Backend 500 on all routes | Database connection failed | `docker compose exec backend node -e "..."` or check logs |
