# Sit Happens — Linux Mint Setup (Step-by-Step)

A literal, copy-paste walkthrough for getting Sit Happens running on your Linux Mint box,
publicly accessible via Cloudflare Tunnel on your own domain.

**Time budget: ~90 minutes** (mostly waiting for downloads).

> **Replace `{YOUR_DOMAIN}` throughout this doc with your real domain** (e.g. `sit-happens.com`).
> Replace `{SUB}` with whatever subdomain you want for the app (e.g. `app` or `crm`).
> So `{SUB}.{YOUR_DOMAIN}` becomes `app.sit-happens.com` or whatever you pick.

## What you're about to build

```
Internet
   │  https://{SUB}.{YOUR_DOMAIN}
   ▼
Cloudflare (free DDoS protection + HTTPS termination)
   │  encrypted tunnel
   ▼
cloudflared (runs as a systemd service on YOUR PC)
   │  http://127.0.0.1:8080
   ▼
Docker network
   ├── nginx (frontend container)
   │     ├── serves React static files
   │     └── proxies /api/* to backend
   ├── FastAPI (backend container) on :8001
   └── MongoDB (mongo container) on :27017 (LAN-blocked)
```

Nothing on your home network — let alone the internet — can reach Mongo or the
backend directly. The only public surface is the Cloudflare Tunnel, and that's
protected by Cloudflare's edge.

---

## Phase 1 — Prep your machine (~10 min)

Open a terminal and run:

```bash
# Make sure the system is current
sudo apt update && sudo apt upgrade -y

# Install the basics we'll need
sudo apt install -y git curl ca-certificates openssl ufw
```

### Set up a basic firewall (recommended for any internet-facing box)

```bash
# Allow SSH on the off chance you ever want to remote into it
sudo ufw allow OpenSSH
# Default: deny everything inbound, allow everything outbound
sudo ufw default deny incoming
sudo ufw default allow outgoing
# Activate it
sudo ufw enable
sudo ufw status
```

You do NOT need to open port 80 or 443. Cloudflare Tunnel makes outbound connections —
it doesn't accept inbound. That's why we don't have to mess with port forwarding.

---

## Phase 2 — Install Docker (~5 min)

Linux Mint is Ubuntu under the hood, but the distro version Docker reports needs to
match. We'll use Docker's official install script, which auto-detects:

```bash
# Download and run the official Docker install script
curl -fsSL https://get.docker.com | sudo sh

# Let your user run docker without sudo
sudo usermod -aG docker $USER

# IMPORTANT: log out and log back in (or reboot) so the group takes effect.
# Don't skip this. After re-login, verify:
docker compose version
# Should print something like "Docker Compose version v2.x.x"
```

If `docker compose version` errors with permission denied, you didn't fully log out
and back in. Reboot the PC and try again.

---

## Phase 3 — Get the code (~5 min)

In your Emergent chat, look for the **"Save to GitHub"** button in the chat input area.
Click it, create a new **private** repository (call it `sit-happens-crm` or similar),
and let Emergent push the code.

Once the repo exists, on your Linux Mint box:

```bash
# Create the app directory in /opt (system convention for self-installed apps)
sudo mkdir -p /opt/sit-happens
sudo chown $USER:$USER /opt/sit-happens
cd /opt/sit-happens

# Clone YOUR repo (replace with the URL GitHub gives you)
git clone https://github.com/YOUR-GITHUB-USERNAME/sit-happens-crm.git .

# The "." at the end matters — it clones INTO /opt/sit-happens, not into a subfolder.

# Verify the key files landed:
ls -la docker-compose.yml Dockerfile.backend Dockerfile.frontend SELF_HOSTING.md
```

If `git clone` asks for credentials, the easiest path is a [GitHub Personal Access
Token](https://github.com/settings/tokens) used as the password (the username is your
GitHub username). Or just use the HTTPS URL with a token embedded: `https://YOUR_TOKEN@github.com/...`

---

## Phase 4 — Create your secrets (~10 min)

This is the only step that requires thinking. The app needs a handful of env vars:

```bash
cd /opt/sit-happens

# Generate a strong random JWT secret (used to sign auth tokens)
JWT_SECRET=$(openssl rand -hex 32)
echo "Save this somewhere safe just in case: $JWT_SECRET"

# Pick the subdomain you want — e.g., app.yourdomain.com
PUBLIC_URL="https://{SUB}.{YOUR_DOMAIN}"

# Create the backend's .env (this is what the FastAPI container reads)
cat > backend/.env <<EOF
MONGO_URL=mongodb://mongo:27017
DB_NAME=sit_happens
JWT_SECRET=${JWT_SECRET}
APP_PUBLIC_URL=${PUBLIC_URL}
RESEND_API_KEY=re_REPLACE_WITH_YOUR_RESEND_KEY
ADMIN_NOTIFICATION_EMAIL=youremail@example.com
EMERGENT_LLM_KEY=
EOF

# Create the top-level .env (this is what docker-compose reads)
cat > .env <<EOF
DB_NAME=sit_happens
APP_PUBLIC_URL=${PUBLIC_URL}
RESEND_API_KEY=re_REPLACE_WITH_YOUR_RESEND_KEY
ADMIN_NOTIFICATION_EMAIL=youremail@example.com
JWT_SECRET=${JWT_SECRET}
REACT_APP_BACKEND_URL=
EOF

# Lock down permissions on the env files (only your user can read them)
chmod 600 backend/.env .env

# Open backend/.env and fix the two REPLACE_WITH lines:
nano backend/.env
# Then do the same for the root .env:
nano .env
```

**About the Resend API key:** the same key you've been using in Emergent's deployment.
Log in to [resend.com](https://resend.com) → API Keys → grab it (or create a new one).
The key starts with `re_`. Without this, automated emails (booking notifications,
birthday cards, etc.) silently no-op. The app still works otherwise.

**About `REACT_APP_BACKEND_URL=` being empty:** intentional. Empty means the React
frontend will call `/api/*` as relative URLs, which nginx routes to the backend
container. One domain serves everything — cleaner and more secure.

---

## Phase 5 — Build and launch (~10 min)

```bash
cd /opt/sit-happens

# First build pulls a bunch of base images and compiles React. Be patient.
docker compose build

# Once that finishes, start everything in the background:
docker compose up -d

# Watch the logs to confirm startup
docker compose logs -f
# Wait for "Application startup complete" on the backend.
# Press Ctrl+C to detach from the log stream (the containers keep running).
```

**Local sanity check** — before exposing it to the internet, make sure it works
locally:

```bash
curl http://localhost:8080/api/health
# Should print: {"status":"ok"}
```

If you get `{"status":"ok"}`, the entire app stack is healthy. If not, run
`docker compose logs --tail 100` and read the errors.

---

## Phase 6 — Cloudflare Tunnel (~20 min)

### 6a. Add your domain to Cloudflare (free tier, no credit card)

1. Go to [cloudflare.com](https://cloudflare.com) and sign up
2. Add `{YOUR_DOMAIN}` — Cloudflare will scan your existing DNS records
3. Cloudflare will give you 2 nameservers like `bob.ns.cloudflare.com` and `lisa.ns.cloudflare.com`
4. Go to wherever you bought your domain (Namecheap, GoDaddy, etc.) and change the
   domain's nameservers to those two values. Propagation takes 1-24h but for our
   purposes it's usually live in 10-15 minutes
5. Once Cloudflare's dashboard shows your domain as "Active", continue below

### 6b. Install cloudflared on the Linux PC

```bash
# Download the latest .deb package (works on Linux Mint since it's Ubuntu-based)
cd /tmp
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb

# Verify
cloudflared --version
```

### 6c. Authenticate cloudflared with your Cloudflare account

```bash
cloudflared tunnel login
# This prints a URL. Copy it and open in your browser.
# Cloudflare will ask you to log in and authorize the tunnel.
# Pick your domain when prompted. The terminal will continue once authorized.
```

### 6d. Create a tunnel + point your subdomain at it

```bash
# Create a tunnel named "sit-happens" — name is arbitrary
cloudflared tunnel create sit-happens

# Cloudflare will print a UUID (looks like 5f8c1234-abcd-...). Note it down.
# A credentials file gets saved to ~/.cloudflared/<UUID>.json automatically.

# Build the tunnel config — replace {SUB}.{YOUR_DOMAIN} with your actual values
TUNNEL_UUID=$(ls ~/.cloudflared/*.json | head -1 | xargs -n1 basename | sed 's/.json//')
echo "Tunnel UUID: $TUNNEL_UUID"

cat > ~/.cloudflared/config.yml <<EOF
tunnel: ${TUNNEL_UUID}
credentials-file: /root/.cloudflared/${TUNNEL_UUID}.json

ingress:
  - hostname: {SUB}.{YOUR_DOMAIN}
    service: http://localhost:8080
  - service: http_status:404
EOF

# Tell Cloudflare to route DNS for that subdomain at the tunnel
cloudflared tunnel route dns sit-happens {SUB}.{YOUR_DOMAIN}
```

### 6e. Run cloudflared as a system service (auto-starts on boot)

```bash
# IMPORTANT: cloudflared as a systemd service runs as root and reads /root/.cloudflared.
# Copy the credentials there:
sudo mkdir -p /root/.cloudflared
sudo cp ~/.cloudflared/${TUNNEL_UUID}.json /root/.cloudflared/
sudo cp ~/.cloudflared/config.yml /root/.cloudflared/

# Install as a systemd service
sudo cloudflared service install

# Start it + enable on boot
sudo systemctl start cloudflared
sudo systemctl enable cloudflared

# Verify it's running
sudo systemctl status cloudflared --no-pager
# Look for "Active: active (running)"
```

### 6f. Test from your phone (use cellular data, not your home WiFi)

Open `https://{SUB}.{YOUR_DOMAIN}` on your phone with WiFi OFF (to prove it's coming
through Cloudflare, not your LAN). You should see the Sit Happens login page.

🎉 **At this point you're publicly self-hosting.** HTTPS is automatic via Cloudflare's
edge cert. No port forwarding. No Let's Encrypt setup. No static IP needed.

---

## Phase 7 — Migrate your existing data from Emergent (~5 min)

1. On Emergent's preview/production: log in as admin → **Settings → Backup & Restore → Download Backup (.json)**
2. The file downloads to your computer (probably `~/Downloads/`)
3. Open `https://{SUB}.{YOUR_DOMAIN}` (your self-hosted instance)
4. **You'll need to create a new admin account first** since this is a fresh database.
   Use the registration link, or run this one-time seed:
   ```bash
   # Create the bootstrap admin (only works if no admin exists yet)
   docker exec -it sit-happens-backend python -c "
   import asyncio
   from server import db, hash_password
   from datetime import datetime, timezone
   import uuid
   async def main():
       if await db.users.find_one({'role': 'admin'}):
           print('Admin already exists, skipping')
           return
       await db.users.insert_one({
           'id': str(uuid.uuid4()),
           'email': 'admin@yourbusiness.com',  # change this
           'password_hash': hash_password('CHANGE-THIS-IMMEDIATELY'),
           'role': 'admin',
           'created_at': datetime.now(timezone.utc).isoformat(),
       })
       print('Admin created.')
   asyncio.run(main())
   "
   ```
5. Log in as that admin
6. **Settings → Backup & Restore → Restore from File** → pick your JSON. Done.

---

## Phase 8 — Nightly automatic backups (~5 min)

```bash
# Create the backups directory + the cron script
sudo mkdir -p /opt/sit-happens/backups
sudo chown $USER:$USER /opt/sit-happens/backups

sudo tee /etc/cron.daily/sit-happens-backup > /dev/null <<'EOF'
#!/bin/bash
set -e
TS=$(date +%F)
docker exec sit-happens-mongo mongodump --quiet --archive=/backups/sit-happens-${TS}.archive --db=sit_happens
# Retention: keep last 30 days
find /opt/sit-happens/backups -name 'sit-happens-*.archive' -mtime +30 -delete
# Optional: copy to NAS / external drive / another disk
# rsync -a /opt/sit-happens/backups/ /mnt/nas/sit-happens-backups/ 2>/dev/null || true
EOF

sudo chmod +x /etc/cron.daily/sit-happens-backup

# Test it now
sudo /etc/cron.daily/sit-happens-backup && ls -lh /opt/sit-happens/backups/
# You should see one file appear like "sit-happens-2026-02-XX.archive"
```

If you have a NAS or external drive, uncomment + edit the `rsync` line to push
backups offsite.

---

## Daily operations cheat sheet

| What you want to do                | Command                                                  |
|------------------------------------|----------------------------------------------------------|
| Check app status                   | `cd /opt/sit-happens && docker compose ps`               |
| Tail all logs                      | `docker compose logs -f --tail 100`                      |
| Tail backend only                  | `docker compose logs -f backend --tail 100`              |
| Restart the app                    | `docker compose restart`                                 |
| Stop the app (rare)                | `docker compose stop`                                    |
| Start it again                     | `docker compose start`                                   |
| Get latest code from GitHub        | `git pull && docker compose up -d --build`               |
| Manual backup right now            | `sudo /etc/cron.daily/sit-happens-backup`                |
| Open Mongo shell (admin debugging) | `docker exec -it sit-happens-mongo mongosh sit_happens`  |
| Check Cloudflare Tunnel status     | `sudo systemctl status cloudflared`                      |
| Restart Cloudflare Tunnel          | `sudo systemctl restart cloudflared`                     |

---

## If something breaks

**Browser shows "Bad Gateway 502":** the backend container is down.
```bash
docker compose ps                            # is backend "running"?
docker compose logs backend --tail 50        # what does it say?
docker compose restart backend
```

**Browser shows Cloudflare error page (not Sit Happens):** the tunnel is down.
```bash
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -n 50
sudo systemctl restart cloudflared
```

**Email notifications stopped firing:** Resend key is wrong or rate-limited.
```bash
docker compose logs backend | grep -i resend
# Fix the RESEND_API_KEY in both .env files, then:
docker compose restart backend
```

**Mongo container won't start:** disk space.
```bash
df -h        # how much free?
docker system df    # docker-specific usage
sudo find /opt/sit-happens/backups -mtime +60 -delete   # nuke old backups
```

**You want to roll back to a backup:** restore from the nightly archive.
```bash
# Stop the app (keep mongo running)
docker compose stop backend frontend

# Restore from an archive (replace date)
docker exec -i sit-happens-mongo mongorestore --drop --archive=/backups/sit-happens-2026-02-15.archive

# Start the app back up
docker compose start backend frontend
```

---

## When Emergent makes more updates that you want

Two clean paths:

**A. Keep dev work in Emergent's preview, deploy to your PC on demand**
1. Make changes in Emergent preview, test them there
2. Click "Save to GitHub" to push the new code
3. On your PC: `cd /opt/sit-happens && git pull && docker compose up -d --build`
4. ~2 minutes of downtime while it rebuilds

**B. Stop using Emergent entirely**
1. Develop directly against your self-hosted instance (or set up a second copy on
   `localhost:8090` for a dev environment)
2. Push code to GitHub from your own machine
3. Deploy with the same `git pull && up -d --build`

Both are valid. Option A is easier if you want to keep using Emergent's AI
assistance for code changes.

---

## What you give up by self-hosting

- Emergent's hosted preview / production environment
- Their automatic deployment system
- Their hosted Mongo
- ~50 GB / week of nothing-to-think-about

## What you gain

- **$0/month recurring cost** (just your $12/yr domain)
- **Total data ownership** — your data lives in your house, in a JSON-restorable backup
- **No vendor risk** — if Emergent ever shuts down or changes pricing, you're not affected
- **Unlimited photo storage** — your disk is the limit, not a per-MB cost
- **Cloudflare's free DDoS protection + edge caching** as a side effect of using their tunnel

---

When you finish: **just your domain bill. ~$12/yr.**
That's the entire ongoing cost of running this CRM forever.

Stuck on any step? Ping me with the exact error and which phase you're in.
