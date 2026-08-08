# 🐾 Sit Happens — Terminal Commands Cheat-Sheet

Every command you'll realistically need to run on your Bazzite PC, grouped by job.
Run them all from inside `~/sit-happens/` unless otherwise noted.

---

## 🚀 Daily Operations

| Goal | Command |
|---|---|
| Safely update (required backup first, then pull + rebuild) | `./update.sh` |
| Run a manual backup right now | `./backup-now.sh` |
| Start the app (if stopped) | `docker compose -p sit-happens up -d` |
| Stop the app cleanly | `docker compose -p sit-happens down` |
| Restart everything | `docker compose -p sit-happens restart` |
| See if all 3 containers are healthy | `docker compose -p sit-happens ps` |

---

## 🔍 Troubleshooting (when something feels off)

| Goal | Command |
|---|---|
| Tail live logs (all containers) | `docker compose -p sit-happens logs -f` |
| Just the backend logs | `docker compose -p sit-happens logs -f backend` |
| Just the frontend logs | `docker compose -p sit-happens logs -f frontend` |
| Mongo logs | `docker compose -p sit-happens logs -f mongo` |
| Last 100 backend lines (no tail) | `docker compose -p sit-happens logs --tail=100 backend` |
| Backend healthcheck | `curl http://localhost:8080/api/health` |
| Full container inspect | `docker ps` |
| Disk space (containers + volumes) | `docker system df` |

---

## 💾 Backups & Restore

| Goal | Command |
|---|---|
| Run a backup right now (saves locally + uploads to Drive) | `./backup-now.sh` |
| See your local backups | `ls -lah ~/sit-happens-backups/` |
| Next scheduled auto-backup | `systemctl --user list-timers sit-happens-backup` |
| Tail the auto-backup logs | `journalctl --user -u sit-happens-backup -f` |
| Disable nightly auto-backup | `systemctl --user disable --now sit-happens-backup.timer` |
| Re-enable nightly auto-backup | `systemctl --user enable --now sit-happens-backup.timer` |
| Export for moving to a new PC | `./migrate-export.sh` |
| Import on a new PC | `./migrate-import.sh /path/to/backup.tar.gz` |

---

## 🌐 Cloudflare Tunnel

| Goal | Command |
|---|---|
| Tunnel status | `sudo systemctl status cloudflared` |
| Restart tunnel | `sudo systemctl restart cloudflared` |
| Tail tunnel logs | `sudo journalctl -u cloudflared -f` |
| Stop tunnel temporarily | `sudo systemctl stop cloudflared` |
| Start tunnel | `sudo systemctl start cloudflared` |

---

## 🗄️ Direct MongoDB Access (advanced)

| Goal | Command |
|---|---|
| Open a Mongo shell | `docker exec -it sit-happens-mongo mongosh sit_happens` |
| Count clients | `docker exec sit-happens-mongo mongosh sit_happens --quiet --eval "db.clients.countDocuments()"` |
| Count bookings | `docker exec sit-happens-mongo mongosh sit_happens --quiet --eval "db.bookings.countDocuments()"` |
| Manual dump | `docker exec sit-happens-mongo mongodump --out=/backups/manual` |
| Manual restore | `docker exec sit-happens-mongo mongorestore --drop /backups/manual` |

Inside `mongosh` you can run things like:
```js
db.dogs.find({}, {name:1, breed:1}).limit(5)
db.bookings.find({status:"approved"}).count()
```

---

## 🧹 Maintenance & Cleanup

| Goal | Command |
|---|---|
| Free up unused Docker images | `docker image prune -a` |
| Free up unused volumes (CAREFUL — make a backup first) | `docker volume prune` |
| Reclaim everything not in use | `docker system prune -a` |
| Rebuild a single service from scratch | `docker compose -p sit-happens build --no-cache backend` |
| Force-recreate containers (after a config change) | `docker compose -p sit-happens up -d --force-recreate` |

---

## 🚨 Recovery Scenarios

### "The frontend won't load"
```bash
docker compose -p sit-happens logs --tail=80 frontend
docker compose -p sit-happens restart frontend
```

### "Backend returns 500s"
```bash
docker compose -p sit-happens logs --tail=80 backend
docker compose -p sit-happens restart backend
```

### "App is super slow"
```bash
docker stats          # see which container is eating CPU/RAM
df -h                 # check disk space
docker system df      # check Docker disk use specifically
```

### "I broke something — restore from last night's backup"
```bash
cd ~/sit-happens
docker compose -p sit-happens down
# pick the archive you want
ls -lah ~/sit-happens-backups/
./migrate-import.sh ~/sit-happens-backups/sit-happens-backup-2026-MM-DD_HHMMSS.tar.gz
```

### "Containers running but Cloudflare URL is dead"
```bash
sudo systemctl status cloudflared
sudo systemctl restart cloudflared
sudo journalctl -u cloudflared --since "5 minutes ago"
```

### "Reboot the whole PC cleanly"
```bash
sudo reboot
# Everything auto-starts: Docker → 3 containers → Cloudflare tunnel
```

---

## ⚙️ One-Time / Rare

| Goal | Command |
|---|---|
| Edit secrets (Resend key, JWT, etc.) | `nano ~/sit-happens/.env` (then `docker compose -p sit-happens up -d --force-recreate`) |
| Check what's listening on which port | `sudo ss -tlnp` |
| Show user systemd timers | `systemctl --user list-timers` |
| Show system timers (e.g., cloudflared) | `systemctl list-timers` |
| Disk usage of Docker volumes | `docker system df -v` |

---

## 💡 Pro Tips

- **Pin this file** in your terminal's bookmarks or print it. You'll use ~10 of these commands 95% of the time; the rest are rescue ropes.
- **Always use `-p sit-happens`** with `docker compose` so it attaches to the same project name (= same MongoDB volume). The wrapper scripts already do this — only matters when typing raw compose commands.
- **Anything you don't understand → don't run it.** When in doubt, ask first. Wrong `docker volume prune` = lost data.
