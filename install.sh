#!/usr/bin/env bash
# Sit Happens — interactive installer for Bazzite (and most Fedora/RHEL distros).
# Walks through Docker setup, .env creation, build, first-run, and optional
# Cloudflare Tunnel. Idempotent — safe to re-run if something fails.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sithappensohio-maker/sithappens/main/install.sh | bash
#   OR after cloning:
#   ./install.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Pretty print helpers ────────────────────────────────────────────────────
b() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }
err() { printf "  \033[31m✗\033[0m %s\n" "$*"; }
prompt() { printf "\n\033[1;36m? %s\033[0m " "$*"; }

ask_yn() {
  local q="$1" default="${2:-n}" reply
  while true; do
    prompt "$q [$( [ "$default" = "y" ] && echo "Y/n" || echo "y/N" )]"
    read -r reply
    reply="${reply:-$default}"
    case "$reply" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
    esac
  done
}

clear
b "🐾  Sit Happens — Self-Host Installer"
echo "    This walks you through the whole setup. Re-run anytime if a step fails."
echo

# ── 1. Docker ───────────────────────────────────────────────────────────────
b "[1/6]  Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  err "Docker isn't installed."
  echo "    On Bazzite, run:"
  echo "      rpm-ostree install moby-engine docker-compose"
  echo "      systemctl reboot"
  echo "    Then re-run this installer."
  exit 1
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

if ! sudo systemctl is-active --quiet docker 2>/dev/null; then
  warn "Docker service isn't running. Starting it..."
  sudo systemctl enable --now docker
fi
ok "Docker service active"

# Fix the immutable-fedora group-membership quirk if needed
if ! id -nG | grep -qw docker; then
  warn "You're not in the docker group yet."
  if ! grep -q '^docker:' /etc/group; then
    echo "    Copying docker group definition from /usr/lib/group to /etc/group..."
    grep '^docker:' /usr/lib/group | sudo tee -a /etc/group >/dev/null
  fi
  sudo gpasswd -a "$USER" docker
  err "Added you to the docker group. REBOOT now, then re-run this installer."
  exit 1
fi
ok "User '$USER' is in the docker group"

# ── 2. .env file ────────────────────────────────────────────────────────────
b "[2/6]  Configuring secrets (.env)..."
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    ok "Created .env from .env.example"
  else
    cat > .env <<'EOF'
DB_NAME="sit_happens"
JWT_SECRET="REPLACE_ME"
APP_PUBLIC_URL=""
RESEND_API_KEY=""
ADMIN_NOTIFICATION_EMAIL=""
ADMIN_EMAIL="admin@sithappens.com"
ADMIN_PASSWORD="admin123"
ADMIN_NAME="Admin"
CORS_ORIGINS="*"
EMERGENT_LLM_KEY=""
REACT_APP_BACKEND_URL=""
EOF
    ok "Created a blank .env"
  fi
fi

# Auto-generate JWT_SECRET if still placeholder
if grep -qE 'JWT_SECRET="(REPLACE_ME|CHANGE_ME[^"]*)"' .env; then
  warn "JWT_SECRET is a placeholder. Generating a random one..."
  if command -v openssl >/dev/null 2>&1; then
    NEW_SECRET=$(openssl rand -hex 32)
  else
    NEW_SECRET=$(head -c 64 /dev/urandom | base64 | tr -d '/+=' | head -c 64)
  fi
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=\"${NEW_SECRET}\"|" .env
  ok "Generated a new JWT_SECRET"
fi

# Prompt for the things that have no good default
ENV_NEEDS_EDIT=0
if grep -qE 'RESEND_API_KEY=""' .env; then
  prompt "Paste your Resend API key (starts with re_) — or just hit Enter to skip and edit later:"
  read -r RESEND
  if [ -n "$RESEND" ]; then
    sed -i "s|^RESEND_API_KEY=.*|RESEND_API_KEY=\"${RESEND}\"|" .env
    ok "Saved Resend key"
  else
    ENV_NEEDS_EDIT=1
  fi
fi
if grep -qE 'ADMIN_NOTIFICATION_EMAIL=""' .env; then
  prompt "Your admin email (where booking notifications go) — or Enter to skip:"
  read -r EMAIL
  if [ -n "$EMAIL" ]; then
    sed -i "s|^ADMIN_NOTIFICATION_EMAIL=.*|ADMIN_NOTIFICATION_EMAIL=\"${EMAIL}\"|" .env
    ok "Saved admin email"
  else
    ENV_NEEDS_EDIT=1
  fi
fi

if [ "$ENV_NEEDS_EDIT" = "1" ]; then
  warn "Some .env values left blank. Edit later with: nano .env"
fi

# ── 3. Build & start ────────────────────────────────────────────────────────
b "[3/6]  Building the Docker stack (first run ≈ 5 min)..."
docker compose build
ok "Built"

b "[4/6]  Starting containers..."
docker compose up -d
ok "Started"

# ── 4. Wait for health ──────────────────────────────────────────────────────
b "[5/6]  Waiting for backend to come online..."
HEALTH_OK=0
for i in {1..60}; do
  if curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  printf "."
  sleep 2
done
echo
if [ "$HEALTH_OK" = "1" ]; then
  ok "Backend healthy"
else
  err "Backend didn't come up in 2 minutes."
  echo "    Run: docker compose logs --tail=80 backend"
  exit 1
fi

# ── 5. Cloudflare Tunnel (optional) ────────────────────────────────────────
b "[6/6]  Cloudflare Tunnel (public HTTPS access)..."
if systemctl is-active --quiet cloudflared 2>/dev/null; then
  ok "cloudflared is already running — your tunnel survived this install."
elif ask_yn "Set up Cloudflare Tunnel now to make the app publicly reachable?" "n"; then
  if [ ! -x /usr/local/bin/cloudflared ] && [ ! -f ./cloudflared ]; then
    echo "    Downloading cloudflared..."
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
      -o /tmp/cloudflared
    chmod +x /tmp/cloudflared
    sudo install /tmp/cloudflared /usr/local/bin/cloudflared
    ok "cloudflared installed at /usr/local/bin/cloudflared"
  fi
  cat <<'EOF'

  Now run these by hand (each one waits for you to do something):

    cloudflared tunnel login
        ↳ opens a URL; pick your domain, click Authorize

    cloudflared tunnel create sithappens
        ↳ copy the tunnel ID it prints

    cloudflared tunnel route dns sithappens YOUR-DOMAIN.app
        ↳ replace YOUR-DOMAIN.app with your real domain

    nano ~/cloudflared/config.yml
        ↳ paste the YAML block from BAZZITE_SETUP.md §5.6

    sudo cloudflared --config ~/cloudflared/config.yml service install
    sudo systemctl enable --now cloudflared

  Or just follow BAZZITE_SETUP.md sections 5.3 → 5.8.

EOF
else
  warn "Skipped Cloudflare Tunnel. App is only reachable from this PC for now."
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo
b "🎉  Sit Happens is installed!"
echo
LAN_IP=$(ip -4 addr show 2>/dev/null | awk '/inet / && $2 !~ /^127/ {print $2}' | cut -d/ -f1 | head -n1)
echo "    On this PC:       http://localhost:8080"
[ -n "$LAN_IP" ] && echo "    From your network: http://${LAN_IP}:8080  (after the LAN expose step)"
systemctl is-active --quiet cloudflared 2>/dev/null && echo "    Public URL:       check 'sudo systemctl status cloudflared'"
echo
echo "    Default login:    admin@sithappens.com  /  admin123   ← CHANGE IMMEDIATELY"
echo
echo "    Day-to-day:"
echo "      ./update.sh                  → pull latest code + rebuild"
echo "      ./migrate-export.sh          → take a portable backup"
echo "      docker compose logs -f       → live logs"
echo "      docker compose down          → stop everything"
echo
