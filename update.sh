#!/usr/bin/env bash
# Sit Happens — one-command updater.
# Pulls latest code from GitHub, rebuilds, restarts. Use this whenever a new
# feature lands in the upstream repo.
#
# Usage: ./update.sh

set -e
cd "$(dirname "$0")"

if [ ! -d .git ]; then
  echo "❌ This folder isn't a git clone — update.sh needs it to be one."
  echo "   Fix:"
  echo "     cd ~"
  echo "     mv sit-happens sit-happens.old"
  echo "     git clone https://github.com/sithappensohio-maker/sithappens.git sit-happens"
  echo "     cp sit-happens.old/.env sit-happens/"
  echo "     cd sit-happens && ./update.sh"
  exit 1
fi

# Data-safety gate: never replace application code/containers until a fresh
# Mongo + .env backup exists outside the project folder. backup-now.sh exits
# non-zero if the dump/archive cannot be verified, and set -e stops the update.
if [ "${SKIP_PREUPDATE_BACKUP:-0}" != "1" ]; then
  echo "💾  Creating required pre-update backup..."
  if [ ! -x ./backup-now.sh ]; then
    echo "❌ backup-now.sh is missing or not executable. Update aborted; no code was changed."
    exit 1
  fi
  ./backup-now.sh
  echo "✅  Pre-update backup complete."
else
  echo "⚠️  SKIP_PREUPDATE_BACKUP=1 — proceeding without the safety backup."
fi

echo "📥  Pulling latest code from GitHub..."
git pull

echo "🔨  Rebuilding containers (cached layers will be skipped)..."
docker compose build

echo "🔁  Restarting..."
docker compose up -d

echo "⏳  Waiting for backend to come online..."
for i in {1..60}; do
  if curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; then
    echo "✅  Update complete — backend is healthy."
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "⚠️  Backend didn't respond in 2 minutes. Check logs:"
echo "    docker compose logs --tail=80 backend"
exit 1
