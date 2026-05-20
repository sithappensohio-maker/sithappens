#!/usr/bin/env bash
# Sit Happens — full self-host export.
# Bundles code + Mongo volume + cloudflared config into a single .tar.gz that
# can be carried to a new PC and restored with migrate-import.sh.
#
# Run from /home/<you>/sit-happens or wherever your project lives.
# Usage:  ./migrate-export.sh   (creates ~/sit-happens-FULL-BACKUP-<date>.tar.gz)

set -e
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
DATE=$(date +%Y-%m-%d_%H%M)
OUT="$HOME/sit-happens-FULL-BACKUP-${DATE}.tar.gz"
TMP="$(mktemp -d)"

echo "📦 Exporting Sit Happens (this takes a few minutes)..."

# 1) Stop the stack so Mongo isn't being written to mid-copy
echo "  ➜ Stopping containers for a clean snapshot..."
docker compose down

# 2) Dump the Mongo data volume as a tarball
echo "  ➜ Dumping Mongo data volume..."
docker run --rm \
  -v sit-happens_mongo_data:/data \
  -v "$TMP":/backup:Z \
  alpine sh -c "cd /data && tar czf /backup/mongo_data.tar.gz . && chmod 644 /backup/mongo_data.tar.gz"

# 3) Copy the app source (without node_modules / build artefacts / git)
echo "  ➜ Copying app source..."
tar czf "$TMP/app_src.tar.gz" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='build' \
  --exclude='__pycache__' \
  --exclude='backups' \
  --exclude='.next' \
  -C "$APP_DIR" .

# 4) Copy the Cloudflare Tunnel config + credentials
echo "  ➜ Copying Cloudflare Tunnel config..."
if [ -d /etc/cloudflared ]; then
  sudo tar czf "$TMP/cloudflared.tar.gz" -C /etc/cloudflared .
  sudo chmod 644 "$TMP/cloudflared.tar.gz"
elif [ -d "$HOME/.cloudflared" ]; then
  tar czf "$TMP/cloudflared.tar.gz" -C "$HOME/.cloudflared" .
else
  echo "  ⚠️  No cloudflared config found — you'll need to recreate the tunnel on the new PC."
  echo "       (Skipping cloudflared snapshot.)"
fi

# 5) Bundle everything into a single file
echo "  ➜ Bundling final archive..."
tar czf "$OUT" -C "$TMP" .
rm -rf "$TMP"

# 6) Restart the stack so the old PC keeps serving traffic
echo "  ➜ Restarting containers..."
docker compose up -d

SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "✅ Backup complete!"
echo "   File: $OUT"
echo "   Size: $SIZE"
echo ""
echo "Copy this file to a USB stick or cloud storage."
echo "On the new PC after installing Docker, run:"
echo "   ./migrate-import.sh \"$OUT\""
