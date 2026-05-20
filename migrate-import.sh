#!/usr/bin/env bash
# Sit Happens — full self-host import.
# Companion to migrate-export.sh. Takes the FULL-BACKUP tarball and restores
# the entire stack onto a fresh Bazzite PC (Docker must be installed first).
#
# Usage:  ./migrate-import.sh ~/sit-happens-FULL-BACKUP-2026-05-20_1430.tar.gz

set -e
BACKUP="${1:-}"
if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
  echo "❌ Usage: ./migrate-import.sh /path/to/sit-happens-FULL-BACKUP-*.tar.gz"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker is not installed on this PC."
  echo "   Install it first (see BAZZITE_SETUP.md Section 1), then re-run this."
  exit 1
fi

TARGET="${HOME}/sit-happens"
TMP="$(mktemp -d)"

echo "📦 Unpacking $BACKUP ..."
tar xzf "$BACKUP" -C "$TMP"

# 1) Restore app source
echo "  ➜ Restoring app source to $TARGET ..."
mkdir -p "$TARGET"
tar xzf "$TMP/app_src.tar.gz" -C "$TARGET"
chmod +x "$TARGET"/*.sh 2>/dev/null || true

# 2) Restore Mongo data volume
echo "  ➜ Restoring Mongo data volume..."
docker volume create sit-happens_mongo_data >/dev/null
docker run --rm \
  -v sit-happens_mongo_data:/data \
  -v "$TMP":/backup:Z \
  alpine sh -c "cd /data && tar xzf /backup/mongo_data.tar.gz"

# 3) Restore Cloudflare Tunnel config (if present in the backup)
if [ -f "$TMP/cloudflared.tar.gz" ]; then
  echo "  ➜ Restoring Cloudflare Tunnel config..."
  sudo mkdir -p /etc/cloudflared
  sudo tar xzf "$TMP/cloudflared.tar.gz" -C /etc/cloudflared
  echo "  ➜ Installing cloudflared service (will reuse the existing tunnel)..."
  if [ ! -x /usr/local/bin/cloudflared ]; then
    echo "  ⚠️  cloudflared binary not installed yet — install it now:"
    echo ""
    echo "     curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \\"
    echo "       -o /tmp/cloudflared && sudo install /tmp/cloudflared /usr/local/bin/cloudflared"
    echo ""
    echo "     Then re-run this script."
  else
    sudo /usr/local/bin/cloudflared --config /etc/cloudflared/config.yml service install || true
    sudo systemctl enable --now cloudflared
    echo "  ✅ Cloudflare Tunnel running — sithappens.app will route to this PC."
  fi
fi

rm -rf "$TMP"

# 4) Start the stack
echo "  ➜ Starting Docker stack..."
cd "$TARGET"
docker compose up -d --build

echo ""
echo "✅ Migration complete!"
echo ""
echo "   • Local check:  http://localhost:8080"
echo "   • Public URL:   https://sithappens.app  (if cloudflared was migrated)"
echo "   • Logs:         cd ~/sit-happens && docker compose logs -f"
echo ""
echo "If something looks off, check:"
echo "   docker compose ps"
echo "   sudo systemctl status cloudflared"
