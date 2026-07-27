#!/usr/bin/env bash
# Sit Happens POS agent installer — run this ONCE on the front-desk Mint
# laptop, from wherever you copied the pos_agent/ folder to.
#
#   cd pos_agent
#   chmod +x install.sh
#   ./install.sh
#
# Safe to re-run — it just re-checks everything and reinstalls the service.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_USER="$(whoami)"
UNIT_NAME="sit-happens-pos-agent"
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}.service"

echo "== Sit Happens POS agent installer =="
echo "User: $INSTALL_USER"
echo "Directory: $SCRIPT_DIR"
echo

# 1. Python check (stdlib only — no pip installs needed)
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 not found. Install it first (e.g. sudo apt install python3), then re-run this script."
    exit 1
fi
echo "[ok] python3 found: $(python3 --version)"

# 2. lp group membership (needed to write to /dev/usb/lp0 without root)
if groups "$INSTALL_USER" | grep -qw lp; then
    echo "[ok] $INSTALL_USER is already in the 'lp' group"
else
    echo "[fix] adding $INSTALL_USER to the 'lp' group (requires sudo password)"
    sudo usermod -aG lp "$INSTALL_USER"
    echo "      NOTE: this only takes effect after you log out/in or reboot."
fi

# 3. Printer device check (informational only — printer may be unplugged right now)
if [ -e /dev/usb/lp0 ]; then
    echo "[ok] printer device /dev/usb/lp0 found"
else
    echo "[warn] /dev/usb/lp0 not found right now — plug in the printer, or check 'ls -l /dev/usb/' for the real path"
fi

# 4. Generate the systemd unit with the ACTUAL user/path — no manual editing required
echo
echo "[install] writing $UNIT_PATH (requires sudo password)"
sudo tee "$UNIT_PATH" > /dev/null <<EOF
[Unit]
Description=Sit Happens front-desk POS hardware agent (printer + cash drawer)
After=network.target

[Service]
Type=simple
User=$INSTALL_USER
ExecStart=$(command -v python3) $SCRIPT_DIR/pos_agent.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
StandardOutput=append:$SCRIPT_DIR/pos_agent.log
StandardError=append:$SCRIPT_DIR/pos_agent.log

[Install]
WantedBy=multi-user.target
EOF

# 5. Enable + (re)start
sudo systemctl daemon-reload
sudo systemctl enable "$UNIT_NAME" >/dev/null 2>&1
sudo systemctl restart "$UNIT_NAME"
sleep 1

# 6. Verify
echo
if sudo systemctl is-active --quiet "$UNIT_NAME"; then
    echo "[ok] $UNIT_NAME is running"
else
    echo "[FAIL] $UNIT_NAME did not start — check: sudo systemctl status $UNIT_NAME"
    exit 1
fi

echo
echo "Health check:"
sleep 1
curl -s http://127.0.0.1:8765/health || echo "(no response yet — give it a second and retry: curl http://127.0.0.1:8765/health)"
echo
echo
echo "Done. It will now start automatically on every boot and restart itself if it crashes."
echo "Logs: tail -f $SCRIPT_DIR/pos_agent.log"
echo "Status: sudo systemctl status $UNIT_NAME"
