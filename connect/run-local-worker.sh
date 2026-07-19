#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_SOURCE="$SCRIPT_DIR/../../pixo-deployment/context/local-secrets/keys/andon-clients"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "Creating .env from .env.example — fill in the values before running again."
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  exit 1
fi

echo "Copying mTLS certs..."
mkdir -p "$SCRIPT_DIR/certs"

for file in tls.crt tls.key ca.crt; do
  if [ ! -f "$CERT_SOURCE/$file" ]; then
    echo "ERROR: $CERT_SOURCE/$file not found."
    echo "Generate the local client cert first. See pixo-deployment/docs/DEPLOYMENT.md."
    exit 1
  fi
  cp "$CERT_SOURCE/$file" "$SCRIPT_DIR/certs/"
done
chmod 600 "$SCRIPT_DIR/certs/tls.key"

echo "Starting local andon worker..."
cd "$SCRIPT_DIR"
docker compose up -d

echo ""
echo "Worker running. Check logs: docker compose logs -f"
