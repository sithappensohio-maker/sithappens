# Sit Happens — Self-Hosting Guide

Run the full Sit Happens CRM on your own Linux box with Docker + Cloudflare Tunnel.
Total first-time setup: ~3-4 hours. Daily maintenance: zero.

## What you're building

```
internet ─► Cloudflare Tunnel ─► localhost:8080 (nginx in frontend container)
                                       │
                                       ├─ /            → React SPA
                                       └─ /api/*       → backend:8001 (FastAPI)
                                                              │
                                                              └─► mongo:27017
```

All three containers live on a Docker network. Only the frontend port 8080
is exposed to the host, and **only on 127.0.0.1** — nothing on your LAN can hit
it without going through Cloudflare Tunnel. That's the security model.

## Hardware you already have ✓

- Linux PC (any modern distro — Ubuntu 22.04+ / Debian 12 / Fedora 40 all fine)
- Business fiber internet
- UPS / battery backup
- ~60 dogs of data (trivial — uses <1GB Mongo storage, <2GB RAM total)

## One-time setup

### Step 1 — Install Docker (~5 min)

Ubuntu/Debian:
```bash
# Install Docker Engine + Compose plugin (official repo, not the distro version)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in so the group change takes effect, then verify:
docker compose version
```

### Step 2 — Get the code (~2 min)

In the Emergent chat input, click **"Save to GitHub"** → create a repo (private is
fine). Then on your PC:

```bash
cd /opt   # or wherever you want it; /opt or ~/apps are both fine
sudo mkdir -p sit-happens && sudo chown $USER:$USER sit-happens
cd sit-happens
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git .
```

### Step 3 — Create your `.env` file (~3 min)

The repo intentionally doesn't ship secrets. Create them once:

```bash
# 1. Backend env — copies the structure of what's used in preview
cat > backend/.env <<'EOF'
MONGO_URL=mongodb://mongo:27017
DB_NAME=sit_happens
JWT_SECRET=GENERATE_A_RANDOM_STRING_HERE
APP_PUBLIC_URL=https://sit-happens.yourdomain.com
RESEND_API_KEY=re_your_resend_key_here
ADMIN_NOTIFICATION_EMAIL=youremail@example.com
EMERGENT_LLM_KEY=
EOF

# Generate a strong random JWT_SECRET and replace the placeholder:
sed -i "s/GENERATE_A_RANDOM_STRING_HERE/$(openssl rand -hex 32)/" backend/.env

# 2. Top-level compose env — used by docker-compose.yml to pull values into containers
cat > .env <<'EOF'
DB_NAME=sit_happens
APP_PUBLIC_URL=https://sit-happens.yourdomain.com
RESEND_API_KEY=re_your_resend_key_here
ADMIN_NOTIFICATION_EMAIL=youremail@example.com
JWT_SECRET=use-the-same-one-as-backend/.env
REACT_APP_BACKEND_URL=
EOF
```

**Keep both `.env` files identical for shared values.** The backend reads its own;
docker-compose reads the root one. Put the same JWT_SECRET in both.

> **Important:** leave `REACT_APP_BACKEND_URL` blank for single-origin setups. The
> React app will call relative `/api/*` URLs and nginx will route them. If you want
> separate domains for frontend/backend (don't, unless you have a reason), set it
> to your backend URL.

### Step 4 — Build and start the stack (~10 min first time)

```bash
docker compose build
docker compose up -d

# Watch logs to confirm everything came up:
docker compose logs -f --tail 50

# When you see "Application startup complete" on the backend, you're up.
# Verify: curl http://localhost:8080/api/health → should return {"status":"ok"}
```

If you need to restart later: `docker compose restart`
If you need to nuke and rebuild: `docker compose down && docker compose up -d --build`

### Step 5 — Expose to the internet via Cloudflare Tunnel (~20 min)

1. **Buy a domain** (Namecheap, Cloudflare Registrar, whatever — ~$12/yr)
2. **Add it to Cloudflare** (free tier) — Cloudflare will give you 2 nameservers
   to point your domain to from the registrar
3. **Install cloudflared on the host** (NOT in Docker — runs as a system service):
   ```bash
   # Ubuntu/Debian
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
   sudo dpkg -i cloudflared.deb
   ```
4. **Authenticate + create a tunnel**:
   ```bash
   cloudflared tunnel login                                    # opens browser; pick your domain
   cloudflared tunnel create sit-happens                       # creates a tunnel, prints UUID
   ```
5. **Configure the tunnel** — edit `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: YOUR-TUNNEL-UUID-FROM-PREVIOUS-STEP
   credentials-file: /home/YOUR-USER/.cloudflared/YOUR-TUNNEL-UUID.json

   ingress:
     - hostname: sit-happens.yourdomain.com
       service: http://localhost:8080
     # Catch-all rule (required)
     - service: http_status:404
   ```
6. **Point your domain at the tunnel**:
   ```bash
   cloudflared tunnel route dns sit-happens sit-happens.yourdomain.com
   ```
7. **Install as a system service** (auto-starts on boot):
   ```bash
   sudo cloudflared service install
   sudo systemctl start cloudflared
   sudo systemctl enable cloudflared
   ```
8. **Verify**: `https://sit-happens.yourdomain.com` → you should see the login page.

That's it. HTTPS is automatic (Cloudflare's edge cert), no Let's Encrypt setup,
no port-forwarding, no static IP needed.

### Step 6 — Migrate your existing data from Emergent (~5 min)

From Emergent's preview, open **Settings → Backup & Restore → Download Backup
(.json)**. Then on your PC:

```bash
# Copy the downloaded file to your server
scp ~/Downloads/sit-happens-backup-*.json user@your-server:/opt/sit-happens/backups/

# Restore via the admin UI: log in to your self-hosted instance,
# go to Settings → Backup & Restore → Restore from file, pick the JSON. Done.
```

### Step 7 — Nightly backup to external storage (~5 min)

```bash
sudo nano /etc/cron.daily/sit-happens-backup
```
Paste:
```bash
#!/bin/bash
set -e
TS=$(date +%F)
docker exec sit-happens-mongo mongodump --quiet --archive=/backups/sit-happens-${TS}.archive --db=sit_happens
# Keep last 30 days only
find /opt/sit-happens/backups -name 'sit-happens-*.archive' -mtime +30 -delete
# Optional: rsync to NAS or external drive
# rsync -a /opt/sit-happens/backups/ /mnt/nas/sit-happens-backups/
```
```bash
sudo chmod +x /etc/cron.daily/sit-happens-backup
# Test it now:
sudo /etc/cron.daily/sit-happens-backup && ls -lh /opt/sit-happens/backups/
```

## Day-to-day operations

| Task                          | Command                                        |
|-------------------------------|------------------------------------------------|
| See container status          | `docker compose ps`                            |
| Tail logs (all)               | `docker compose logs -f --tail 100`            |
| Tail logs (backend only)      | `docker compose logs -f backend --tail 100`    |
| Pull latest code + rebuild    | `git pull && docker compose up -d --build`     |
| Restart all                   | `docker compose restart`                       |
| Stop everything               | `docker compose stop`                          |
| Start everything              | `docker compose start`                         |
| Manual backup right now       | `sudo /etc/cron.daily/sit-happens-backup`      |
| Open a Mongo shell            | `docker exec -it sit-happens-mongo mongosh sit_happens` |

## Updating the app (after Emergent makes more changes you want)

Two options:

**A.** Keep using Emergent's preview for development. When you're happy with a change:
1. Save to GitHub from Emergent
2. On your server: `cd /opt/sit-happens && git pull && docker compose up -d --build`
3. ~2 min downtime during build

**B.** Just stop using Emergent and develop on your own machine. Both work.

## What you give up by self-hosting

- **Emergent's preview environment** — gone (you'd dev directly against your server,
  or set up a second Docker stack on a non-prod port for testing)
- **Their automatic deployments / rollbacks** — replaced by `git pull && up -d`
- **Their hosted Mongo** — replaced by yours, with the nightly cron above

## What you keep

- Same codebase, same UI, same data, same features
- Same `MONGO_URL` / `REACT_APP_BACKEND_URL` env-var pattern (the reason this works)
- Cloudflare Tunnel gives you DDoS protection + global edge caching for free as a side effect

## Troubleshooting

**`docker compose build` fails on the frontend with out-of-memory:** node 20 wants 2GB+
during the React build. If your PC has 8GB+ you're fine. If less, add a swap file:
```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Cloudflare Tunnel shows the page but `/api/*` returns 502:** check the backend
container is healthy: `docker compose logs backend --tail 50`. The most common
cause is a typo in `backend/.env`'s `MONGO_URL` — for compose it should be
`mongodb://mongo:27017` (not `localhost`).

**You change `.env` and nothing seems to take effect:** restart needed.
`docker compose restart backend` after backend/.env changes,
`docker compose up -d --build frontend` after root `.env` changes that affect the build.

**Mongo container won't start:** check disk space. `docker system df`. If your data
dir is full, expand the volume or delete old backups.

**You want to roll back to Emergent's hosted version temporarily:** just `docker
compose stop`. Your Emergent preview at `https://sit-happens-crm.emergent.host`
keeps running independently. You can stop Cloudflare Tunnel and aim your DNS at
the Emergent URL via a CNAME if you want zero-downtime fallback.

---

When you finish setup, the **only ongoing cost is your domain (~$12/yr).** Your CRM, your data, your hardware. That's it.
