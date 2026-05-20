# Moving Sit Happens to a New PC

Tested for the case where your Bazzite PC dies, you upgrade hardware, or you
just want to move the app to a different machine. Total downtime: ~10 minutes.

> Your Cloudflare Tunnel + domain (`sithappens.app`) follow you automatically —
> they live in Cloudflare's network, not on the PC. The same URL will route to
> the new PC the moment cloudflared starts there.

## What gets moved

| Thing | Where it lives now | How it moves |
|---|---|---|
| App source code | `~/sit-happens/` | tar in the backup file |
| Mongo database (clients, dogs, bookings, photos, …) | Docker volume `sit-happens_mongo_data` | dumped to tar in the backup |
| Cloudflare Tunnel config + creds | `/etc/cloudflared/` | included in the backup |
| Resend API key, JWT secret, all .env values | `~/sit-happens/.env` | inside `app_src.tar.gz` |

## Step 1 — On the OLD PC: take a backup

```bash
cd ~/sit-happens
./migrate-export.sh
```

This will:
1. Briefly stop the stack (~30 sec of downtime)
2. Snapshot the Mongo volume
3. Snapshot the code + cloudflared config
4. Bundle everything into one file at `~/sit-happens-FULL-BACKUP-YYYY-MM-DD_HHMM.tar.gz`
5. Restart the stack so clients can keep using it

> **Tip:** run `./migrate-export.sh` monthly anyway as a safety backup. Stash the
> latest file on Google Drive / Dropbox / an external SSD. It's the only thing
> standing between you and "fire / theft / dead drive."

## Step 2 — Transfer the file to the NEW PC

Pick the easiest option:

- **USB stick** — `cp ~/sit-happens-FULL-BACKUP-*.tar.gz /run/media/$USER/USB_NAME/`
- **scp** (if both PCs are on your network) — `scp ~/sit-happens-FULL-BACKUP-*.tar.gz garrett@NEWPC.local:~/`
- **Cloud storage** — upload to Drive on old PC, download on new PC

## Step 3 — On the NEW PC: install Docker

Run the steps from `BAZZITE_SETUP.md` Section 1:

```bash
rpm-ostree install moby-engine docker-compose
systemctl reboot
# After reboot:
sudo systemctl enable --now docker
grep '^docker:' /usr/lib/group | sudo tee -a /etc/group
sudo gpasswd -a $USER docker
sudo reboot
# After reboot, verify:
docker ps   # should show empty header, no permission error
```

## Step 4 — On the NEW PC: restore the backup

1. Copy `migrate-import.sh` to the new PC (it's in the tarball, but you need it
   *before* extracting — so save it separately too, or grab it from this repo).

2. Run:
   ```bash
   chmod +x migrate-import.sh
   ./migrate-import.sh ~/sit-happens-FULL-BACKUP-YYYY-MM-DD_HHMM.tar.gz
   ```

3. The script will:
   - Unpack the source into `~/sit-happens/`
   - Restore the Mongo data into a fresh Docker volume
   - Restore + start the Cloudflare Tunnel (if `cloudflared` is installed; the
     script will tell you the exact install command if it isn't)
   - Build & start the Docker stack

## Step 5 — Verify everything

```bash
docker compose ps                   # all 3 containers Up
sudo systemctl status cloudflared   # active (running)
```

Then test:
- **On the new PC**: `http://localhost:8080` → login screen ✅
- **From your phone on mobile data**: `https://sithappens.app` → login screen ✅
- Log in, glance at Clients / Dogs / Bookings — your real data should be there.

If both work, **shut down the old PC** so you're not running two copies of the
backend writing to two different databases.

## Step 6 — Clean up

- Delete the backup tarball off the USB stick (it contains your JWT secret and
  Resend key — treat it like a password).
- Test that `./migrate-export.sh` works on the new PC too, so you can do this
  again next time.

## Common gotchas

### "cloudflared not installed" warning
The migrate script will print the exact install command. Run it, then
`sudo systemctl enable --now cloudflared` — done.

### `sithappens.app` still hits the old PC after migration
If both PCs are running cloudflared with the same tunnel ID, Cloudflare will
load-balance. Shut down cloudflared on the old PC:
```bash
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
```
DNS doesn't need any changes — the tunnel ID is what matters.

### "Permission denied" on docker volume restore
Run the import script with the same user that owns Docker (`docker ps` should
work without sudo first — see Section 1 in BAZZITE_SETUP.md).

### Photos appear broken after migration
Photos are stored base64-encoded inside Mongo documents, so they ride along
with the volume snapshot. If they're broken, the Mongo restore didn't complete
fully — check `docker compose logs mongo` for errors.

## What to do *before* the move (recommended)

1. Take a backup **the day before** as a safety copy.
2. Take the **real migration backup** during a quiet hour (early morning).
3. Let clients know in advance only if downtime > 10 min is expected — usually
   they won't even notice.
