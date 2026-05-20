#!/usr/bin/env bash
# Sit Happens — single-run backup.
# Dumps Mongo + saves .env, tars + gzips with a timestamp, rotates locally,
# and (if rclone is configured) uploads to Google Drive.
#
# Safe to run anytime by hand; also called by the systemd timer installed by
# setup-auto-backup.sh.
#
# Exits non-zero on any failure so the systemd unit shows red.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Where local archives live. ~/sit-happens-backups so it survives a folder rebuild.
BACKUP_DIR="${BACKUP_DIR:-$HOME/sit-happens-backups}"
KEEP_LOCAL="${KEEP_LOCAL:-14}"               # rotate: keep this many archives locally
REMOTE_NAME="${REMOTE_NAME:-gdrive}"         # rclone remote name
REMOTE_PATH="${REMOTE_PATH:-sit-happens-backups}"  # folder inside Google Drive
TS="$(date +%Y-%m-%d_%H%M%S)"
ARCHIVE="sit-happens-backup-${TS}.tar.gz"
RCLONE_BIN="${RCLONE_BIN:-$HOME/.local/bin/rclone}"
[ -x "$RCLONE_BIN" ] || RCLONE_BIN="$(command -v rclone 2>/dev/null || true)"

log() { printf "  [%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
err() { printf "  \033[31m✗\033[0m %s\n" "$*" >&2; }

mkdir -p "$BACKUP_DIR"

# ── 1. Mongo dump ──────────────────────────────────────────────────────────
log "Dumping MongoDB..."
if ! docker ps --format '{{.Names}}' | grep -q '^sit-happens-mongo$'; then
  err "sit-happens-mongo container isn't running. Start the stack first."
  exit 1
fi

# Clear previous dump dir inside the container's bind-mounted ./backups
docker exec sit-happens-mongo rm -rf /backups/_latest 2>/dev/null || true
docker exec sit-happens-mongo mongodump --quiet --out=/backups/_latest >/dev/null

# ./backups is bind-mounted from the host (see docker-compose.yml)
if [ ! -d "./backups/_latest" ]; then
  err "mongodump didn't produce ./backups/_latest — check container logs."
  exit 1
fi
log "Mongo dumped → ./backups/_latest"

# ── 2. Stage everything we want in the archive ─────────────────────────────
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -r ./backups/_latest "$STAGE/mongo"
[ -f .env ]              && cp .env              "$STAGE/.env"
[ -f docker-compose.yml ] && cp docker-compose.yml "$STAGE/docker-compose.yml"

cat > "$STAGE/RESTORE.md" <<'EOF'
# Sit Happens backup — restore instructions

This archive contains a full MongoDB dump (`mongo/`) and your `.env`.

## Restore on a fresh PC

1. Install the app: `./install.sh` (or clone the repo + start docker compose)
2. Stop the stack: `docker compose down`
3. Copy the `.env` from this archive into the project root
4. Start mongo only: `docker compose up -d mongo`
5. Restore: `docker cp mongo sit-happens-mongo:/restore-tmp && \
            docker exec sit-happens-mongo mongorestore --drop /restore-tmp`
6. Start the rest: `docker compose up -d`

See MIGRATE_TO_NEW_PC.md for a fuller walkthrough.
EOF

# ── 3. Pack it ─────────────────────────────────────────────────────────────
log "Archiving to ${BACKUP_DIR}/${ARCHIVE}..."
tar -czf "${BACKUP_DIR}/${ARCHIVE}" -C "$STAGE" .
SIZE=$(du -h "${BACKUP_DIR}/${ARCHIVE}" | awk '{print $1}')
log "Archive size: $SIZE"

# ── 4. Rotate local copies (keep newest N) ─────────────────────────────────
log "Rotating local archives (keeping newest ${KEEP_LOCAL})..."
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/sit-happens-backup-*.tar.gz 2>/dev/null \
  | tail -n +"$((KEEP_LOCAL + 1))" \
  | xargs -r rm -v

# ── 5. Upload to Google Drive (best-effort) ───────────────────────────────
if [ -x "$RCLONE_BIN" ] && "$RCLONE_BIN" listremotes 2>/dev/null | grep -q "^${REMOTE_NAME}:"; then
  log "Uploading to ${REMOTE_NAME}:${REMOTE_PATH}..."
  if "$RCLONE_BIN" copy "${BACKUP_DIR}/${ARCHIVE}" "${REMOTE_NAME}:${REMOTE_PATH}" \
      --progress=false --stats=0; then
    log "Upload OK"
  else
    err "Upload failed — local copy still saved at ${BACKUP_DIR}/${ARCHIVE}"
    # Don't fail the whole backup if cloud is down — the local copy is the priority.
  fi
else
  log "rclone not configured — skipping cloud upload (run ./setup-auto-backup.sh to enable)"
fi

# ── 6. Cleanup the mongodump scratch dir ───────────────────────────────────
docker exec sit-happens-mongo rm -rf /backups/_latest 2>/dev/null || true

echo
log "✅ Backup complete: ${BACKUP_DIR}/${ARCHIVE} (${SIZE})"
