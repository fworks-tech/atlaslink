# Deploy atlaslink to Oracle Cloud Always Free

Hosts the Fastify daemon at **zero GPU/CPU cost** on Oracle Cloud Infrastructure's
Always Free tier, fronted by the Vercel dashboard at `https://atlas.flabs.tech`.
The Dockerfile is the same one reviewed in PR #50; this adds the VM runtime
(`docker-compose.yml`, `deploy/oracle/`).

## Architecture

```
Browser ─▶ https://atlas.flabs.tech (Vercel Next.js)
              │ /api/*  (BFF route handler, injects the gate token server-side)
              ▼
Caddy (VM, :80) ─▶ backend:3000 (Fastify daemon in Docker)
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
   | 0.0.0.0/0 | TCP 80 | Caddy (dashboard proxy) |
   | 0.0.0.0/0 | TCP 443 | optional TLS upgrade |
   | 0.0.0.0/0 | TCP 22 | SSH (default) |

## 2. SSH in and deploy

```bash
ssh -i ~/.ssh/<your_key> ubuntu@<PUBLIC_IP>

git clone https://github.com/fworks-tech/atlaslink.git
cd atlaslink
bash deploy/oracle/setup.sh      # installs Docker (you may need to re-login for group)
# re-login, then:
ATLASLINK_API_TOKEN=<daemon token> OPENCODE_API_KEY=<opencode-go key> bash deploy/oracle/deploy.sh
```

`deploy.sh` clones (or updates) `/opt/atlaslink`, writes `.env` from the two
variables, builds the image, and starts `docker compose` services (`backend` +
`caddy`). `ATLASLINK_API_TOKEN` **must equal** the value stored on Vercel.

Verify: `curl http://<PUBLIC_IP>/health` → `{"ok":true,"name":"atlaslink",…}`.

## 3. Point the dashboard at the VM

```bash
cd dashboard   # from the repo root
vercel env add ATLASLINK_API_URL production --value "http://<PUBLIC_IP>:80" --yes
```

The `/api/*` BFF proxy on Vercel now reaches the VM server-side (no browser
mixed-content). The sidebar `ConnectionStatus` flips to **connected** once the
daemon responds.

## 4. Optional — HTTPS with a subdomain

- In Vercel DNS (flabs.tech is Vercel-managed), add an **A record**
  `api.atlas.flabs.tech → <PUBLIC_IP>`.
- Open TCP **443** in the VCN security list.
- Uncomment the `api.atlas.flabs.tech` block in `deploy/oracle/Caddyfile` and
  `docker compose up -d caddy`. Caddy auto-provisions a Let's Encrypt cert.
- Set `ATLASLINK_API_URL` to `https://api.atlas.flabs.tech` instead.

## 5. Optional — persistent sessions (Postgres)

The event log persists in the `atlaslink-data` volume, but the session aggregate
is in-memory by default (`src/session/backendFactory.ts`). For durable `GET /tasks`,
run a Postgres container on the VM and set `ATLASLINK_DATABASE_URL` in `.env`:

```bash
docker run -d --name atlaslink-pg --restart unless-stopped \
  -e POSTGRES_USER=atlas -e POSTGRES_PASSWORD=<pw> -e POSTGRES_DB=atlaslink \
  -v atlas-pg-data:/var/lib/postgresql/data -p 127.0.0.1:5432:5432 \
  postgres:17-alpine
# then add to /opt/atlaslink/.env:
# ATLASLINK_DATABASE_URL=postgres://atlas:<pw>@127.0.0.1:5432/atlaslink
# docker compose up -d
```

## Operations

- Logs: `cd /opt/atlaslink && docker compose logs -f backend`
- Restart daemon: `docker compose restart backend`
- Update daemon: `cd /opt/atlaslink && git pull && docker compose up -d --build`
- The Ampere free allowance (3000 OCPU-hours/mo) covers an always-on VM; the
  E2.Micro shape also fits the same budget.