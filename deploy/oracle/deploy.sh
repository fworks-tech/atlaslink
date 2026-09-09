#!/usr/bin/env bash
set -euo pipefail

# Deploy (or update) atlaslink-backend on this VM. Keeps a checkout at
# /opt/atlaslink, writes .env from the provided variables on first run, then
# builds and starts the stack (backend + postgres + caddy).
#
#   ATLASLINK_API_TOKEN=<token> OPENCODE_API_KEY=<key> [POSTGRES_PASSWORD=<pw>] bash deploy.sh
#
# The token must match the value stored on Vercel for this dashboard.
# POSTGRES_PASSWORD defaults to "atlaslink" if omitted.

REPO_DIR=/opt/atlaslink

if [ ! -d "$REPO_DIR/.git" ]; then
  sudo mkdir -p /opt
  sudo chown "$USER":"$USER" /opt
  git clone https://github.com/fworks-tech/atlaslink.git "$REPO_DIR"
fi

cd "$REPO_DIR"
git pull --ff-only

if [ ! -f .env ]; then
  {
    echo "ATLASLINK_API_TOKEN=${ATLASLINK_API_TOKEN:-}"
    echo "OPENCODE_API_KEY=${OPENCODE_API_KEY:-}"
    echo "ATLASLINK_CORS_ORIGINS=${ATLASLINK_CORS_ORIGINS:-https://atlas.flabs.tech}"
  } > .env
fi

# Ensure required vars are present (not empty).
if ! grep -qE '^ATLASLINK_API_TOKEN=.+$' .env || ! grep -qE '^OPENCODE_API_KEY=.+$' .env; then
  echo "incomplete .env — set ATLASLINK_API_TOKEN and OPENCODE_API_KEY in $REPO_DIR/.env, then re-run" >&2
  exit 1
fi

docker compose up -d --build

echo "containers:"
docker compose ps
echo "health:"
curl -fsS http://127.0.0.1:80/health || echo "(daemon still booting — try again shortly)"
