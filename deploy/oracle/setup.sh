#!/usr/bin/env bash
set -euo pipefail

# Bootstrap Docker Engine + the compose plugin on an Ubuntu 22.04/24.04 Oracle
# Cloud Always Free VM, then point the operator at deploy.sh. Run once as a
# normal user with sudo privileges:
#   bash setup.sh

if [ "$(id -u)" -eq 0 ]; then
  echo "refusing to run as root; re-run as a normal sudo-enabled user" >&2
  exit 1
fi

needs_completion=0

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl git

  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
    sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  arch="$(dpkg --print-architecture)"
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu ${codename} stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  if ! id -nG "$USER" | grep -qw docker; then
    sudo usermod -aG docker "$USER"
    needs_completion=1
  fi
else
  echo "docker already installed"
fi

if [ "$needs_completion" -eq 1 ]; then
  echo "docker installed. Log out and back in (or run: newgrp docker)," >&2
  echo "then run: bash deploy.sh" >&2
else
  echo "setup complete — run: bash deploy.sh"
fi