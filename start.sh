#!/usr/bin/env bash
# Sit Happens — one-command starter.
# Usage:  ./start.sh   (from inside /app)
#
# This script:
#   1. Checks docker is installed and running
#   2. Checks .env exists (copies from .env.example if not)
#   3. Builds the containers (only re-builds what changed)
#   4. Starts everything in the background
#   5. Waits for the backend to report healthy
#   6. Prints where to open it in a browser

set -e
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker is not installed."
  echo "   On Bazzite, run:  rpm-ostree install moby-engine docker-compose"
  echo "   Then reboot:      systemctl reboot"
  echo "   Then enable:      sudo systemctl enable --now docker"
  exit 1
fi

if ! docker ps >/dev/null 2>&1; then
  echo "❌ docker is installed but not running, or your user can't talk to it."
  echo "   Try:    sudo systemctl enable --now docker"
  echo "   And:    sudo usermod -aG docker $USER     (then log out & back in)"
  exit 1
fi

if [ ! -f .env ]; then
  echo "⚠️  No .env file found. Copying .env.example → .env"
  echo "    ➜ Edit /app/.env to set JWT_SECRET and RESEND_API_KEY, then run this script again."
  cp .env.example .env
  exit 1
fi

echo "🐶  Building containers (first time takes ~5 minutes, later runs are instant)..."
docker compose build

echo "🚀  Starting Sit Happens..."
docker compose up -d

echo "⏳  Waiting for backend to come online..."
for i in {1..60}; do
  if curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; then
    echo ""
    echo "✅  Sit Happens is up!"
    echo ""
    echo "   On this PC:        http://localhost:8080"
    echo "   From other devices on your network:"
    IP=$(ip -4 addr show | awk '/inet / && $2 !~ /^127/ {print $2}' | cut -d/ -f1 | head -n1)
    echo "                      http://$IP:8080      (only works after the LAN expose step — see BAZZITE_SETUP.md §7)"
    echo ""
    echo "   To stop:           docker compose down"
    echo "   To view logs:      docker compose logs -f"
    exit 0
  fi
  sleep 2
done

echo "❌  Backend didn't come up in 2 minutes. Run 'docker compose logs backend' to see why."
exit 1
