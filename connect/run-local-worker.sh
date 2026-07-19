#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "Creating .env from .env.example — fill in the values before running again."
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  exit 1
fi

chmod 600 "$SCRIPT_DIR/certs/tls.key"

echo "Starting local andon worker..."
cd "$SCRIPT_DIR"
docker compose up

echo ""
echo "Worker running. Check logs: docker compose logs -f"
