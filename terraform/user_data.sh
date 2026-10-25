#!/usr/bin/env bash
# =============================================================================
# Shipyard EC2 Host Bootstrap Script (Cloud-Init / User Data)
#
# ADR-010: AWS Cloud Infrastructure Design
# Provisions Docker CE, Node.js 20, system users, log rotation, and directory
# layouts on an Ubuntu 22.04 LTS host.
# =============================================================================

set -euo pipefail
exec > >(tee -a /var/log/shipyard-bootstrap.log) 2>&1

echo "=========================================================="
echo "🚀 Starting Shipyard Host Bootstrap: $(date -u)"
echo "=========================================================="

export DEBIAN_FRONTEND=noninteractive

# 1. Update package lists and install base utilities
echo "📦 Updating packages..."
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  git \
  jq \
  make \
  unzip \
  software-properties-common

# 2. Install Docker Official Repository & Engine
echo "🐳 Installing Docker Engine & Compose..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y --no-install-recommends \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

# 3. Configure Docker Daemon: Log rotation & Storage
echo "⚙️ Configuring Docker daemon..."
cat <<'EOF' > /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 64000,
      "Soft": 64000
    }
  }
}
EOF

systemctl restart docker
systemctl enable docker

# 4. Install Node.js 20.x LTS via NodeSource
echo "🟩 Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g npm@latest

# 5. Create dedicated non-root shipyard user
echo "👤 Creating shipyard service user..."
if ! id "shipyard" &>/dev/null; then
  useradd -r -m -s /bin/bash -G docker shipyard
fi

# 6. Setup Directory Layout in /opt/shipyard
echo "📁 Setting up /opt/shipyard directories..."
mkdir -p /opt/shipyard/{builds,traefik/acme,traefik/dynamic,logs,data}
chmod 700 /opt/shipyard/traefik/acme
touch /opt/shipyard/traefik/acme/acme.json
chmod 600 /opt/shipyard/traefik/acme/acme.json

chown -R shipyard:shipyard /opt/shipyard
chmod 755 /opt/shipyard

# 7. Create production Docker Compose override for ACME TLS termination
cat <<'EOF' > /opt/shipyard/docker-compose.prod.yml
# Production Traefik overlay enabling Let's Encrypt automated TLS
services:
  traefik:
    ports:
      - "443:443"
    command:
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entryPoint.to=websecure"
      - "--entrypoints.web.http.redirections.entryPoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.email=${LETSENCRYPT_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/etc/traefik/acme/acme.json"
    volumes:
      - /opt/shipyard/traefik/acme:/etc/traefik/acme
EOF

echo "=========================================================="
echo "✅ Shipyard Host Bootstrap Completed Successfully: $(date -u)"
echo "=========================================================="
