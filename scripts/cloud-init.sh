#!/bin/bash
# TradeAlgo cloud bootstrap — paste this whole file into the Oracle Cloud
# "Advanced options -> User data (cloud-init script)" box when creating the
# Always-Free VM (VM.Standard.A1.Flex, Ubuntu 24.04). It installs Docker,
# clones the repo, generates secrets, derives a free nip.io hostname from the
# VM's public IP (no DNS account needed), and starts the full stack.
# Everything used here is free forever + open source. Watch progress with:
#   sudo tail -f /var/log/cloud-init-output.log
set -eux
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git ufw openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Host firewall: web only (SSH stays as configured by Oracle).
ufw allow 80,443/tcp
ufw --force enable

git clone https://github.com/amant03/trading_algo.git /opt/tradealgo
cd /opt/tradealgo

# Secrets: generated on the box, never leave it (except via your SSH).
cat > .env <<EOF
PGDATABASE=trading_platform
PGUSER=trading_app
PGPASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
EOF

# Free wildcard-DNS hostname from the public IP, e.g. 203-0-113-10.nip.io.
PUBIP=$(curl -fsSL --max-time 20 https://api.ipify.org || curl -fsSL --max-time 20 https://ifconfig.me)
DOMAIN="$(echo "$PUBIP" | tr '.' '-').nip.io"
echo "DOMAIN=$DOMAIN" >> .env
sed "s/__DOMAIN__/$DOMAIN/" docker/Caddyfile.tmpl > docker/Caddyfile

docker compose up -d --build

cat > /root/TRADEALGO_URL.txt <<EOF
API: https://$DOMAIN
Adminer (via SSH tunnel): ssh -L 8080:localhost:8080 ubuntu@$PUBIP, then http://localhost:8080 (system PostgreSQL, server postgres)
Frontend: set GitHub repo secret VITE_API_URL=https://$DOMAIN, then redeploy the frontend.
EOF
echo "TradeAlgo cloud stack started for https://$DOMAIN"
docker compose ps
