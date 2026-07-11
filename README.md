# 🐾 Sit Happens — Self-Hosted Dog Daycare CRM

Run your own daycare/boarding/training business on your own PC. No monthly fees, your data stays with you.

**Features:** Client portal, schedule, bookings (with credits), dog profiles, vaccine tracking, photo report cards, training homework, income tracking, gamification trophies, and PWA support so it feels like a native app.

---

## 🚀 Quick install (Bazzite / Fedora / RHEL)

If you can copy and paste, you can do this. **Total time: ~15 minutes** (most of it is Docker downloading stuff).

### 1️⃣ Install Docker (one-time, requires reboot)

```bash
rpm-ostree install moby-engine docker-compose
systemctl reboot
```

When the PC comes back, give your user access to Docker:

```bash
sudo systemctl enable --now docker
sudo gpasswd -a $USER docker
# (Bazzite quirk — if the next line fails, ignore it)
grep '^docker:' /usr/lib/group | sudo tee -a /etc/group >/dev/null
# Log out and back in (or just reboot) so the group takes effect.
```

### 2️⃣ Clone the app

```bash
cd ~
git clone https://github.com/sithappensohio-maker/sithappens.git sit-happens
cd sit-happens
```

### 3️⃣ Run the installer

```bash
./install.sh
```

It walks you through:
- ✅ Confirming Docker is set up correctly
- ✅ Creating your `.env` (with auto-generated JWT secret)
- ✅ Asking for your **Resend API key** (for emails — get one free at [resend.com/api-keys](https://resend.com/api-keys))
- ✅ Asking for your **admin email** (where booking notifications go)
- ✅ Building containers and starting everything

When it finishes, open `http://localhost:8080` in your browser.

**First login:** `admin@sithappens.com` / `admin123` → **change this immediately** in Settings → Account.

---

## 🌐 Make it accessible from anywhere (optional)

So you can use it on your phone outside the house, and clients can log in.

Follow `BAZZITE_SETUP.md` Sections 5–8 for the Cloudflare Tunnel walkthrough. You'll need:
- A domain you own (~$10/year — Cloudflare sells `.app`, `.com`, etc.)
- 10 minutes

After setup: `https://yourdomain.app` works from any device, anywhere.

---

## 🔄 Daily commands

```bash
cd ~/sit-happens

./update.sh        # Backup Mongo + .env, then pull, rebuild, and health-check
./backup-now.sh    # Run a backup right now (local + Google Drive)
```

For everything else (logs, troubleshooting, advanced commands) → see **TERMINAL_COMMANDS.md** in this repo.

---

## 💾 Auto-backups (recommended)

One-shot setup of nightly backups to Google Drive:

```bash
./setup-auto-backup.sh
```

Runs every night at 3 AM, keeps 14 nights locally, uploads everything to Drive.

---

## 🏃 Moving to a new PC

On the old PC:
```bash
./migrate-export.sh
```
That creates one big `.tar.gz` containing everything (code + database + Cloudflare config). Copy it to a USB stick.

On the new PC (after Step 1️⃣ above):
```bash
./migrate-import.sh ~/sit-happens-FULL-BACKUP-2026-MM-DD_HHMM.tar.gz
```

That's it. Same domain, same data, same everything.

---

## 📚 Reference docs in this repo

| File | What's in it |
|------|--------------|
| `BAZZITE_SETUP.md` | Long-form setup walkthrough (Cloudflare Tunnel, LAN access, etc.) |
| `TERMINAL_COMMANDS.md` | Every command you'll ever need, grouped by job |
| `install.sh` | Interactive installer (Step 3 above) |
| `update.sh` | One-command updater |
| `migrate-export.sh` / `migrate-import.sh` | Move to a new PC |
| `backup-now.sh` | Manual backup |
| `setup-auto-backup.sh` | Nightly Google Drive backup installer |

---

## ❓ Something not working?

1. Check the logs: `docker compose -p sit-happens logs -f backend`
2. Restart everything: `docker compose -p sit-happens restart`
3. See `TERMINAL_COMMANDS.md → Recovery Scenarios` for specific fixes
4. Last resort: restore from your most recent backup (`./migrate-import.sh`)

---

Built with FastAPI + React + MongoDB. Runs in 3 Docker containers. ~6 MB Mongo footprint per 100 clients.
