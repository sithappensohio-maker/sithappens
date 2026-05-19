# Self-Hosting Sit Happens on Bazzite — Step by Step

This guide takes you from "I have a Bazzite PC" to "my clients are booking on
the internet at https://app.mydomain.com". No prior Linux experience required.
Every command is spelled out; just copy and paste.

> **Time budget:** ~1 hour for the first run, ~5 minutes for any future update.

You will end up with:

```
[Your clients]  →  Cloudflare  →  Your home Bazzite PC  →  Sit Happens CRM
                  (HTTPS magic)    (always on, in your closet)
```

Your laptop / phone access the same URL from anywhere.

---

## What you'll need before you start

- A Bazzite PC that's plugged into power and ethernet (Wi-Fi works but ethernet is more reliable).
- A monitor + keyboard plugged in for the first setup. (After it's running you can unplug them.)
- A free Cloudflare account: https://dash.cloudflare.com/sign-up
- A domain name (~$10/year). Buy from Cloudflare Registrar so DNS just works: https://dash.cloudflare.com → Domain Registration → Register Domains.
- Your Resend API key (you have one — it's in `/app/backend/.env` on Emergent).

---

## Section 1 — Prep the Bazzite PC

### 1.1 Open a terminal

Press the **Super key** (Windows key on a normal keyboard) → type `Terminal` → hit Enter.

A black window opens. This is where all the commands go. **Copy each command, paste it (Ctrl+Shift+V in the terminal), then hit Enter.**

### 1.2 Update Bazzite

```bash
ujust update
```

Wait until it finishes. If it tells you to reboot, do it:

```bash
systemctl reboot
```

After the reboot, open the terminal again and continue.

### 1.3 Turn on Docker

Bazzite has a built-in helper for this. Type:

```bash
ujust setup-docker
```

It will ask you to confirm. Say **yes**. When it finishes, **reboot one more time**:

```bash
systemctl reboot
```

After reboot, open the terminal and verify Docker is alive:

```bash
docker --version
docker compose version
```

You should see two version numbers (e.g. `Docker version 27.x.x`). If you see "command not found", Docker didn't install — run `ujust setup-docker` again.

### 1.4 Add yourself to the docker group

So you don't have to type `sudo` every time:

```bash
sudo usermod -aG docker $USER
```

**Log out and log back in.** (Click your name top-right → Log Out → log in again.) Without logging out, the change doesn't take effect.

Verify:

```bash
docker ps
```

You should see a header row (`CONTAINER ID    IMAGE    ...`) and no error. If it says "permission denied", you didn't log out/in.

---

## Section 2 — Get the Sit Happens code onto your Bazzite PC

### Option A (easier) — From GitHub

If you've pushed your CRM to GitHub from Emergent (using the "Save to GitHub" button), clone it:

```bash
cd ~
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git sit-happens
cd sit-happens
```

Replace `YOUR-USERNAME/YOUR-REPO` with whatever your GitHub repo is called.

### Option B — From a USB stick

If you've copied the `/app` folder onto a USB drive:

1. Plug in the USB stick. A file manager will open.
2. Drag the folder to your home (`/home/your-name/`) directory.
3. Rename it to `sit-happens`.
4. Back in the terminal:

```bash
cd ~/sit-happens
```

### Verify you're in the right place

```bash
ls
```

You should see files like `docker-compose.yml`, `start.sh`, `Dockerfile.backend`, `frontend/`, `backend/`.

---

## Section 3 — Configure your secrets (`.env` file)

### 3.1 Create the file

```bash
cp .env.example .env
```

### 3.2 Generate a JWT secret

This is a long random string used to sign login tokens.

```bash
openssl rand -hex 32
```

You'll see a long string like `7a3f9d...`. **Copy it** (right-click → Copy in the terminal).

### 3.3 Edit the file

Open it in a text editor:

```bash
nano .env
```

You'll see all the settings. Use arrow keys to move around. Replace these values:

| Variable | What to put |
|---|---|
| `JWT_SECRET` | The long hex string you just generated |
| `RESEND_API_KEY` | Your Resend key (starts with `re_`) |
| `ADMIN_NOTIFICATION_EMAIL` | Your email — where booking notifications go |
| `APP_PUBLIC_URL` | Leave empty for now. You'll set this in Section 5. |

Leave `DB_NAME`, `REACT_APP_BACKEND_URL`, and `EMERGENT_LLM_KEY` alone for now.

**Save and exit nano:** press `Ctrl+O`, then `Enter`, then `Ctrl+X`.

---

## Section 4 — First run

```bash
./start.sh
```

**This first run takes about 5 minutes** because Docker has to download base images and build the app. Future starts are instant.

When it's done, you'll see:

```
✅  Sit Happens is up!
   On this PC:  http://localhost:8080
```

### Verify it works

On the Bazzite PC, open a browser (Firefox/Chrome) and go to:

```
http://localhost:8080
```

You should see the Sit Happens login screen.

🎉 The app is running. It's just not reachable from outside the PC yet. That's Section 5.

### If something went wrong

```bash
docker compose logs --tail=80 backend
docker compose logs --tail=80 frontend
```

These show what happened. Most likely cause: a typo in `.env`. Fix it and run `./start.sh` again.

---

## Section 5 — Cloudflare Tunnel (make it reachable from the internet)

This is what lets your clients book at `https://app.sithappens.com` without you having to mess with your home router. Cloudflare handles HTTPS certificates for free.

### 5.1 Point your domain at Cloudflare

If you bought the domain through Cloudflare Registrar, this is already done. Skip to 5.2.

If you bought it elsewhere (Namecheap, GoDaddy, etc.):

1. Cloudflare dashboard → **+ Add a Site** → enter your domain → Free plan.
2. Cloudflare will show you two **nameservers** like `kate.ns.cloudflare.com`.
3. Log into your domain registrar → find the nameserver settings → replace them with Cloudflare's two.
4. Wait up to an hour. Cloudflare will email you when it's active.

### 5.2 Install cloudflared on Bazzite

Back in the Bazzite terminal:

```bash
mkdir -p ~/cloudflared
cd ~/cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
./cloudflared --version
```

You should see a version number.

### 5.3 Log into Cloudflare from the terminal

```bash
./cloudflared tunnel login
```

A URL will print. Copy it, paste it into your browser. Cloudflare will show you a list of your domains — click yours, click **Authorize**. Come back to the terminal — it'll say "You have successfully logged in."

### 5.4 Create the tunnel

```bash
./cloudflared tunnel create sithappens
```

It prints a tunnel ID like `1a2b3c4d-...`. **Copy that ID** — you'll need it.

### 5.5 Tell Cloudflare which subdomain to route to your PC

Pick the subdomain your clients will use. I recommend `app.yourdomain.com`.

```bash
./cloudflared tunnel route dns sithappens app.yourdomain.com
```

(Replace `yourdomain.com` with your actual domain.)

### 5.6 Create the tunnel config file

```bash
nano ~/cloudflared/config.yml
```

Paste in:

```yaml
tunnel: PASTE-YOUR-TUNNEL-ID-HERE
credentials-file: /home/YOUR-LINUX-USERNAME/.cloudflared/PASTE-YOUR-TUNNEL-ID-HERE.json

ingress:
  - hostname: app.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

Replace:
- `PASTE-YOUR-TUNNEL-ID-HERE` (twice) with the ID from step 5.4
- `YOUR-LINUX-USERNAME` with your actual Linux username (run `whoami` if unsure)
- `app.yourdomain.com` with your actual subdomain

Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

### 5.7 Start the tunnel (foreground test)

```bash
./cloudflared --config ~/cloudflared/config.yml tunnel run sithappens
```

You should see lines like "Registered tunnel connection" four times. **Leave this window open** and open a browser → go to `https://app.yourdomain.com`. You should see the Sit Happens login.

If it works, press `Ctrl+C` to stop the test, and we'll make it run automatically next.

### 5.8 Make the tunnel start on boot

```bash
sudo ./cloudflared service install
sudo cp ~/cloudflared/config.yml /etc/cloudflared/config.yml
sudo cp ~/.cloudflared/*.json /etc/cloudflared/
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

The last command shows it's "active (running)". Press `q` to exit.

### 5.9 Update the app URL in `.env`

```bash
cd ~/sit-happens
nano .env
```

Set:
```
APP_PUBLIC_URL="https://app.yourdomain.com"
```

Save, then restart the app:

```bash
docker compose up -d --build backend
```

Done. Clients can now book at `https://app.yourdomain.com`.

---

## Section 6 — Make the CRM auto-start on reboot

Docker already restarts the containers when the PC reboots (the `restart: unless-stopped` in compose handles that). You don't have to do anything else.

To verify, reboot the PC and check:

```bash
docker compose ps
```

All three services should say `Up` after a reboot.

---

## Section 7 — (Optional) Access from a phone on your home Wi-Fi

If you also want a quick local URL like `http://192.168.1.50:8080` from your laptop on the couch (no internet round-trip):

```bash
cd ~/sit-happens
nano docker-compose.yml
```

Find the `frontend:` section, change:

```yaml
ports:
  - "127.0.0.1:8080:80"
```

to:

```yaml
ports:
  - "8080:80"
```

Save (`Ctrl+O Enter Ctrl+X`). Then restart:

```bash
docker compose up -d frontend
```

Find your PC's local IP:

```bash
ip -4 addr | grep inet
```

Look for one starting with `192.168.` or `10.` — that's your LAN IP. Open `http://THAT-IP:8080` on your phone.

> **Heads up:** if you skip this and only use the Cloudflare URL, you're slightly safer (Mongo and the API are not exposed on your LAN at all).

---

## Section 8 — Day-to-day commands

| What you want | Command |
|---|---|
| **Start everything** | `cd ~/sit-happens && docker compose up -d` |
| **Stop everything** | `cd ~/sit-happens && docker compose down` |
| **See live logs** | `cd ~/sit-happens && docker compose logs -f` |
| **See logs for just the backend** | `docker compose logs -f backend` |
| **Restart just the backend** | `docker compose restart backend` |
| **Update to a newer version of the code** | `cd ~/sit-happens && git pull && docker compose up -d --build` |

---

## Section 9 — Backups (do this)

You already have a **"Download Backup"** button inside the app (Settings → Backup & Restore). Use it weekly and store the file on Dropbox/Google Drive/an external SSD.

For nightly automated Mongo dumps as well:

```bash
nano ~/sit-happens/backup.sh
```

Paste:

```bash
#!/usr/bin/env bash
set -e
cd ~/sit-happens
mkdir -p backups
TS=$(date +%Y-%m-%d_%H%M)
docker compose exec -T mongo mongodump --archive --gzip --db=sit_happens > backups/sit-happens-${TS}.gz
# Keep last 30
ls -1t backups/sit-happens-*.gz | tail -n +31 | xargs -r rm
echo "Backup saved: backups/sit-happens-${TS}.gz"
```

Make it executable and schedule:

```bash
chmod +x ~/sit-happens/backup.sh
crontab -e
```

If it asks which editor, pick **nano**. Add this line at the bottom:

```
0 3 * * * /home/YOUR-LINUX-USERNAME/sit-happens/backup.sh >> /home/YOUR-LINUX-USERNAME/sit-happens/backups/cron.log 2>&1
```

(Replace `YOUR-LINUX-USERNAME` with your actual username.) Save and exit.

Every night at 3 AM the database gets dumped to `~/sit-happens/backups/` and the last 30 are kept.

---

## Section 10 — Troubleshooting

### "I open the URL and get a connection error"

```bash
docker compose ps
```

If any service shows `Exited` or `Restarting`, look at its logs:

```bash
docker compose logs --tail=50 SERVICE_NAME
```

Replace `SERVICE_NAME` with `backend`, `frontend`, or `mongo`.

### "Login works but I can't see my old data"

You're looking at a fresh empty database. To import your Emergent backup:

1. From the Emergent preview, go to Settings → Backup & Restore → Download Backup.
2. Copy the `.json` file to your Bazzite PC (USB stick or scp).
3. On the Bazzite PC, log into the new self-hosted CRM as admin → Settings → Backup & Restore → upload the JSON.

### "Cloudflare Tunnel says the connection is registered but the page won't load"

```bash
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
```

99% of the time it's a typo in `config.yml`. Edit `/etc/cloudflared/config.yml`, fix it, then `sudo systemctl restart cloudflared`.

### "Disk full"

Docker images pile up over time. Clean them:

```bash
docker system prune -af
```

(This is safe — it only removes images you're not currently using.)

### "Resend emails aren't sending"

Open the new "Server Errors" tab in Settings — any Resend 401s will show up there with the traceback.

### Still stuck?

```bash
docker compose logs --tail=200 > ~/sit-happens-logs.txt
```

That file has 200 lines of recent logs from every container. Share it with whoever's helping you debug.

---

## Quick reference — what each piece does

| Container | What it does |
|---|---|
| `sit-happens-mongo` | The database. Stores everything. Has a persistent disk volume so it survives restarts. |
| `sit-happens-backend` | The FastAPI server. Handles login, bookings, emails. |
| `sit-happens-frontend` | nginx serving the React app, also reverse-proxying `/api/*` to the backend. |
| `cloudflared` (on host, not in Docker) | Tunnels traffic from `app.yourdomain.com` → `localhost:8080` on this PC. |

That's it. You've replaced the Emergent-hosted deployment with a PC under your desk. The CRM, the data, the URL — all yours.
