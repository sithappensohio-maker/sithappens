#!/usr/bin/env bash
# Sit Happens — one-shot installer for nightly auto-backups.
# Installs rclone (user-local, no root needed thanks to the immutable Bazzite
# /usr), walks you through Google Drive auth, registers a systemd --user timer
# that runs backup-now.sh every night at 03:00 local time.
#
# Idempotent — re-run anytime to repair / reconfigure.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

b()    { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }
err()  { printf "  \033[31m✗\033[0m %s\n" "$*"; }

clear
b "🐾  Sit Happens — Auto-Backup Setup"
echo "    Nightly backups → local folder + Google Drive."
echo

# ── 1. rclone (user-local — no rpm-ostree needed) ──────────────────────────
b "[1/4]  Installing rclone..."
RCLONE_BIN="$HOME/.local/bin/rclone"
mkdir -p "$HOME/.local/bin"

if [ -x "$RCLONE_BIN" ] || command -v rclone >/dev/null 2>&1; then
  ok "rclone already installed ($("$RCLONE_BIN" version 2>/dev/null | head -1 || rclone version | head -1))"
else
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  RCLONE_ARCH="amd64" ;;
    aarch64) RCLONE_ARCH="arm64" ;;
    *) err "Unsupported arch: $ARCH"; exit 1 ;;
  esac
  TMP="$(mktemp -d)"
  echo "    Downloading rclone for linux-${RCLONE_ARCH}..."
  curl -fsSL "https://downloads.rclone.org/rclone-current-linux-${RCLONE_ARCH}.zip" -o "$TMP/rclone.zip"
  ( cd "$TMP" && unzip -q rclone.zip && cp rclone-*/rclone "$RCLONE_BIN" && chmod +x "$RCLONE_BIN" )
  rm -rf "$TMP"
  ok "rclone installed at $RCLONE_BIN"
fi

# Make sure ~/.local/bin is on PATH for future shells
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin"; then
  if ! grep -q 'HOME/.local/bin' "$HOME/.bashrc" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
    ok "Added ~/.local/bin to PATH in ~/.bashrc"
  fi
fi

# ── 2. Google Drive remote ─────────────────────────────────────────────────
b "[2/4]  Configuring Google Drive remote..."
REMOTE_NAME="gdrive"

if "$RCLONE_BIN" listremotes 2>/dev/null | grep -q "^${REMOTE_NAME}:"; then
  ok "rclone remote '${REMOTE_NAME}' already configured"
else
  cat <<EOF

  rclone will now walk you through the Google Drive auth.

  When it asks:
    name>                ${REMOTE_NAME}
    Storage>             drive            (option for Google Drive — usually "18")
    client_id>           (leave blank, press Enter)
    client_secret>       (leave blank, press Enter)
    scope>               1                (Full access)
    service_account_file (leave blank, press Enter)
    Edit advanced config> n
    Use auto config?>    y   ← if this PC has a browser
                         n   ← if you're on SSH (it'll give you a URL to open elsewhere)
    Configure as Shared Drive> n
    Yes this is OK>      y
    Quit config>         q

EOF
  read -r -p "  Press Enter when ready to start the rclone wizard..."
  "$RCLONE_BIN" config
fi

if ! "$RCLONE_BIN" listremotes | grep -q "^${REMOTE_NAME}:"; then
  err "Google Drive remote '${REMOTE_NAME}' wasn't created. Re-run this script."
  exit 1
fi
ok "Google Drive remote '${REMOTE_NAME}' ready"

# ── 3. Verify backup script ────────────────────────────────────────────────
b "[3/4]  Verifying backup script..."
if [ ! -x ./backup-now.sh ]; then
  chmod +x ./backup-now.sh 2>/dev/null || true
fi
if [ ! -x ./backup-now.sh ]; then
  err "backup-now.sh not found in $SCRIPT_DIR — pull latest with ./update.sh"
  exit 1
fi
ok "backup-now.sh found"

# ── 4. systemd --user timer ────────────────────────────────────────────────
b "[4/4]  Installing nightly timer (03:00 local time)..."
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_USER_DIR"

cat > "$SYSTEMD_USER_DIR/sit-happens-backup.service" <<EOF
[Unit]
Description=Sit Happens nightly backup
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${SCRIPT_DIR}/backup-now.sh
StandardOutput=journal
StandardError=journal
EOF

cat > "$SYSTEMD_USER_DIR/sit-happens-backup.timer" <<'EOF'
[Unit]
Description=Sit Happens nightly backup timer

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=300
Unit=sit-happens-backup.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now sit-happens-backup.timer
ok "Timer enabled"

# Make systemd --user survive logout (so backups run even when you're not logged in)
if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
  if loginctl enable-linger "$USER" 2>/dev/null; then
    ok "Enabled user-linger (timer runs even when you're logged out)"
  else
    warn "Couldn't enable user-linger automatically. Run:"
    echo "      sudo loginctl enable-linger $USER"
    echo "    Otherwise the timer pauses when you log out."
  fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo
b "🎉  Auto-backups are armed."
echo
echo "    Next run:        $(systemctl --user list-timers sit-happens-backup.timer --no-pager | awk 'NR==2 {print $1,$2,$3}')"
echo "    Local archives:  ${HOME}/sit-happens-backups/"
echo "    Cloud archives:  Google Drive → /sit-happens-backups/"
echo
echo "    Useful commands:"
echo "      ./backup-now.sh                                  → run a backup right now"
echo "      systemctl --user list-timers sit-happens-backup  → see next scheduled run"
echo "      journalctl --user -u sit-happens-backup -f       → tail backup logs"
echo "      systemctl --user disable --now sit-happens-backup.timer  → stop auto-backups"
echo
