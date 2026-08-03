# Production Deploy Runbook — Shop Appearance, Public Storefront & Guest-to-Account Cart Flow

Status: **runbook only — nothing in this document has been executed.** No code was
changed to produce it. Follow it command-by-command; do not skip the verification
line under any command.

This runbook is built directly from what's actually in this repository today:
`BAZZITE_SETUP.md`, `RELEASE_CHECKLIST.md`, `docker-compose.yml`, `update.sh`,
`backup-now.sh`, `install.sh`, `frontend/nginx.conf`, and the real `git remote`/
branch of this checkout. Where a value cannot be derived from the repo, it's
marked `⟦PLACEHOLDER: ...⟧` — fill it in before running that line.

## Machines used in this runbook

| Label | What it is |
|---|---|
| **DEV** | This Windows checkout — `C:\Users\Sit Happens\Documents\GitHub\sithappens` (Git Bash) |
| **PROD** | The Bazzite production PC, reached via PuTTY/SSH as `⟦PLACEHOLDER: BAZZITE_SSH_USER⟧@⟦PLACEHOLDER: BAZZITE_HOST_OR_IP⟧` |

Every command below is labeled **Machine:** and **Directory:**. Commands
labeled PROD assume you are already connected over SSH and `cd`'d as shown.

## Facts this runbook relies on (confirmed by reading the repo just now)

- Git remote: `https://github.com/sithappensohio-maker/sithappens.git`, branch `main` (matches the URL hardcoded in `update.sh`'s recovery instructions).
- Production repo path convention: `~/sit-happens` (used throughout `BAZZITE_SETUP.md`, `update.sh`, `install.sh`).
- Containers (from `docker-compose.yml`): `sit-happens-mongo`, `sit-happens-backend`, `sit-happens-frontend`, `sit-happens-email-worker`. All `restart: unless-stopped`.
- Mongo data lives in the **named Docker volume** `sit-happens_mongo_data` — never touched by a source-code `git pull` or `docker compose build`.
- `.env`, `.env.*`, and `backups/` are all in `.gitignore` — a `git pull` cannot overwrite or delete them under normal operation (no merge conflicts are possible against untracked/ignored paths).
- There is **no separate uploads/media directory** on disk to worry about: shop images (`shop_media` collection), vaccine docs, and dog photos are all stored as base64 inside MongoDB documents, not as files on a bind-mounted volume. The only bind mounts are `./backups` (mongo dump staging + backend JSON backups).
- Health check: `GET /api/health` → `{"status":"ok"}`, and it actively pings Mongo (`backend/server.py`'s `/health` handler calls `db.command("ping")`), reachable at `http://localhost:8080/api/health` on the host (proxied by the frontend container's nginx). This is the ONE canonical "is the whole stack alive" check baked into `Dockerfile.backend`'s own `HEALTHCHECK` and used by both `install.sh` and `update.sh`.
- SPA routing: `frontend/nginx.conf` already has `try_files $uri $uri/ /index.html;` as the catch-all — `/shop` and `/shop/item/product/<id>` should already 200 on a hard refresh by design. This runbook verifies that is actually true in production rather than assuming it.
- Backup mechanism actually in the repo today is **`./backup-now.sh`**, not the older cron snippet in `BAZZITE_SETUP.md` §9 (that section is superseded — `backup-now.sh` + `setup-auto-backup.sh` are the current, more complete implementation: it mongodumps, stages `.env` + `docker-compose.yml` + an auto-written `RESTORE.md`, tars to `~/sit-happens-backups/sit-happens-backup-<timestamp>.tar.gz`, rotates to the newest 14, and best-effort uploads via `rclone` if configured).
- `update.sh` already refuses to proceed without a fresh backup (`SKIP_PREUPDATE_BACKUP` gate calling `backup-now.sh`) — this runbook does the same steps explicitly and individually so each one can be verified, rather than relying on the bundled script.
- Production domain: repository evidence (`migrate-import.sh`'s post-migration message, `pos_agent/README.md`'s documented `SIT_HAPPENS_API_BASE`/CORS origin, and `memory/PRD.md`'s `mail.sithappens.app` sender-domain notes) consistently point to **`https://sithappens.app`**. This is *derived*, not guessed — but confirm it's still your live domain before using it (Section 9.0 does that check).
- `.env.example` is referenced by `BAZZITE_SETUP.md`/`install.sh` but is **not actually tracked in this repo**. `install.sh` already tolerates this (falls back to writing a default `.env` inline). Don't stop to look for a file that isn't there.
- The public-shop settings toggle this release adds lives in the admin app at **Shop Manager → Shop Settings → Public Storefront** (checkboxes: "Enable Public Shop", "Allow Public Browsing"), backed by `PUT /api/settings` with `{"shop_page": {"public_shop_enabled": ..., "public_browsing_enabled": ...}}`. The UI path is what Section 10 uses; the API is shown only as the documented fallback per your instruction.
- New read-only public endpoints added this release: `GET /api/public/shop/catalog`, `GET /api/public/shop/taxonomy`, `GET /api/public/shop/item/{kind}/{item_id}`, `GET /api/public/shop/media/{media_id}`.

---

## 1. Record the current production commit and container state

**Purpose:** a clean "before" snapshot so any later step can be compared against it.

**1.1 — Current commit and branch**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
cd ~/sit-happens
git log -1 --format="%H  %ci  %s"
git status --porcelain=v1
git branch --show-current
```
- **Expect:** one commit line (hash, date, subject), **empty** output from `git status --porcelain` (clean tree — if not, stop and see Section 5), and `main`.
- **If it fails:** if `~/sit-happens` doesn't exist or isn't a git repo, you're not looking at the right host/path — confirm with whoever set up the Bazzite PC before continuing.

**1.2 — Container state**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
docker compose ps
docker compose images
```
- **Expect:** four rows (`sit-happens-mongo`, `sit-happens-backend`, `sit-happens-frontend`, `sit-happens-email-worker`), each `Up` (or `Up (healthy)` for backend). `docker compose images` lists the image ID currently running for each — write these down alongside the commit hash from 1.1; this is your full rollback reference point.
- **If it fails:** `docker: command not found` means you're not on the Bazzite host, or Docker isn't installed there (see `BAZZITE_SETUP.md` §1.3). A service showing `Exited`/`Restarting` means production is already unhealthy *before* you've touched anything — stop and diagnose that first (`docker compose logs --tail=80 <service>`); do not layer a deploy on top of an already-broken stack.

**1.3 — Save this snapshot to a file** (so you have it even if the PuTTY session drops)
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) pre-deploy snapshot ==="
  git log -1 --format="%H  %ci  %s"
  docker compose ps
  docker compose images
} | tee -a ~/sit-happens-deploy-log.txt
```
- **Expect:** the same output as above, appended to `~/sit-happens-deploy-log.txt`.
- **If it fails:** a permissions error on the tee target means `$HOME` isn't writable — check disk space (Section 2) first.

---

## 2. Confirm adequate disk space

**Purpose:** a backup, a rebuild, and Docker image layers all need real headroom. Don't start a deploy that can fail halfway through a `mongodump` or `docker compose build` from running out of disk.

**2.1 — Host-level free space**
- **Machine:** PROD
- **Directory:** (any — `~`)
```bash
df -h / $HOME
```
- **Expect:** comfortably more free space than 2× your current Mongo data size (see 2.2) plus a few GB headroom for new Docker image layers. As a floor: at least 5 GB free on whichever filesystem holds `/var/lib/docker` and at least 2 GB free on `$HOME` (where `~/sit-happens-backups` lives).
- **If it fails / space is tight:** do not proceed. Free space first — see 2.3.

**2.2 — Current Mongo volume size (so you know what the backup will need to hold)**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
docker system df -v | grep -A2 "sit-happens_mongo_data"
du -sh ./backups 2>/dev/null
du -sh ~/sit-happens-backups 2>/dev/null
```
- **Expect:** a size for the named volume, and sizes for the two backup directories (the second may not exist yet on a first deploy — that's fine).
- **If it fails:** `docker system df -v` with no matching line means the volume name differs from `sit-happens_mongo_data` — check `docker volume ls` and use the actual name.

**2.3 — If space is tight, reclaim safely (never touch the Mongo volume itself)**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
docker system prune -af
ls -1t ~/sit-happens-backups/sit-happens-backup-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -v
```
- **Expect:** `docker system prune -af` reports space reclaimed from unused images/build cache only (per `BAZZITE_SETUP.md`'s own troubleshooting note, this is safe — it never touches running containers or named volumes). The second line manually enforces the same 14-archive rotation `backup-now.sh` already does, in case it's fallen behind.
- **If it fails:** if you're still tight after this, you need more disk before continuing — do not proceed to Section 3 on a full disk.

---

## 3. Create and verify a timestamped MongoDB backup

**Purpose:** this is the backup Section 15 (rollback) restores from if anything goes wrong. Do not skip the verification sub-step.

**3.1 — Run the backup**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
./backup-now.sh
```
- **Expect:** a log sequence ending in `✅ Backup complete: /home/<user>/sit-happens-backups/sit-happens-backup-<YYYY-MM-DD_HHMMSS>.tar.gz (<size>)`. **Copy that exact filename** — you'll reference it explicitly in Section 15.
- **If it fails:**
  - `sit-happens-mongo container isn't running` → the stack isn't up; `docker compose up -d` first, then retry.
  - `mongodump didn't produce ./backups/_latest` → check `docker compose logs mongo` for a crash; do not proceed until a real dump succeeds.
  - Any other non-zero exit → **do not continue to Section 4.** Nothing about this deploy is safe to run without a verified backup.

**3.2 — Verify the archive is real and contains what it should**
- **Machine:** PROD
- **Directory:** `~/sit-happens-backups`
```bash
ARCHIVE=sit-happens-backup-⟦PLACEHOLDER: TIMESTAMP-FROM-3.1⟧.tar.gz
ls -lh "$ARCHIVE"
tar -tzf "$ARCHIVE" | head -20
tar -tzf "$ARCHIVE" | grep -E "^(mongo/|\.env$|docker-compose\.yml$|RESTORE\.md$)" | sort -u
```
- **Expect:** a non-trivial file size (not a few bytes — should roughly track the Mongo volume size from 2.2), and the last command should print exactly four lines: `.env`, `RESTORE.md`, `docker-compose.yml`, and at least one path starting `mongo/` (the dumped collections).
- **If it fails:** a missing `mongo/` entry means the dump didn't get staged — re-run 3.1; do not proceed on a backup that's missing the database.

---

## 4. Create the source checkpoint / archive required by `RELEASE_CHECKLIST.md`

**Purpose:** `RELEASE_CHECKLIST.md`'s "Source checkpoint" section normally bundles commit → push → tag → push-tag → archive together. Per your explicit instruction (Section 16 of this runbook), **the annotated release tag is deferred until after the production smoke test succeeds** — tagging asserts "this is a good release," which shouldn't be asserted before it's actually been proven in production. A candidate commit still has to be pushed before the Bazzite host can `git pull` it at all, so that part happens now; only the tag waits. So this section does the commit + push (required simply to make the code fetchable) and generates a plain archive from that commit for inspection now; the tag + tag-push happen in Section 16.

**4.1 — Confirm what's about to be committed**
- **Machine:** DEV
- **Directory:** `C:\Users\Sit Happens\Documents\GitHub\sithappens`
```bash
git status --porcelain=v1
git diff --stat
```
- **Expect:** the Shop Appearance/Public Storefront/Guest-cart files only (backend/server.py, the new backend test files, the frontend files this phase touched, the new PublicShop/GuestAuthModal/GuestCartMergeReview/shopGuestCart files) — nothing unrelated, nothing marked `??` that looks like a secret or a scratch file.
- **If it fails:** if you see files you don't recognize, stop and investigate before committing — do not blindly `git add -A`.

**4.2 — Stage and commit (add files explicitly, never `git add -A`)**
- **Machine:** DEV
- **Directory:** `C:\Users\Sit Happens\Documents\GitHub\sithappens`
```bash
git add backend/server.py backend/tests/test_shopify_merch.py \
  backend/test_public_shop_storefront.py backend/test_shop_appearance_settings.py backend/test_shop_checkout_eligibility.py \
  frontend/src/App.js frontend/src/lib/api.js frontend/src/lib/shopPolish.js frontend/src/lib/shopPolish.test.js \
  frontend/src/lib/shopGuestCart.js \
  frontend/src/components/CreditPacksSettings.jsx frontend/src/components/ItemThumbnail.jsx \
  frontend/src/components/ManageProductsPanel.jsx frontend/src/components/PortalShop.jsx \
  frontend/src/components/Programs.jsx frontend/src/components/ShopItemDetail.jsx \
  frontend/src/components/GuestAuthModal.jsx frontend/src/components/GuestCartMergeReview.jsx \
  frontend/src/screens/Portal.jsx frontend/src/screens/ShopManager.jsx frontend/src/screens/PublicShop.jsx

git status --porcelain=v1
```
- **Expect:** every line now starts with `A ` or `M ` (staged), nothing with `??` remaining from this feature's file list.
- **If it fails:** if a file you expected isn't listed, add it explicitly by name — never fall back to `-A`.

```bash
git commit -m "$(cat <<'EOF'
feat(shop): public no-account storefront, guest cart, checkout eligibility

Shop Appearance & Organization admin controls, a public /shop and
/shop/item/:kind/:id storefront reusing the existing authenticated
presentation, an explicitly-allowlisted public catalog/taxonomy/media API,
guest-cart localStorage persistence with a post-login merge review, and an
additive server-side checkout eligibility/duplicate-line-normalization
layer. No changes to checkout math, Stripe, POS, Shopify fulfillment,
inventory, entitlements, or financial reporting.
EOF
)"
git log -1 --format="%H  %s"
```
- **Expect:** a commit hash printed, subject line matching the first line above.
- **If it fails:** a pre-commit hook failure means something's actually wrong (lint/format) — fix it and re-run `git commit` with the same message; do not use `--no-verify`.

**4.3 — Push to `main`**
- **Machine:** DEV
- **Directory:** `C:\Users\Sit Happens\Documents\GitHub\sithappens`
```bash
git push origin main
```
- **Expect:** a normal fast-forward push summary ending in something like `main -> main`.
- **If it fails:** a non-fast-forward rejection means `origin/main` moved since your last pull — `git pull --rebase origin main`, resolve anything real, re-run the push. Do not force-push `main`.

**4.4 — Generate and inspect the archive** (mirrors `RELEASE_CHECKLIST.md`'s inspection step, using the commit instead of a tag since the tag isn't cut yet)
- **Machine:** DEV
- **Directory:** `C:\Users\Sit Happens\Documents\GitHub\sithappens`
```bash
COMMIT=$(git rev-parse --short HEAD)
git archive --format=zip -o "sit-happens-release-checkpoint-${COMMIT}.zip" HEAD
unzip -l "sit-happens-release-checkpoint-${COMMIT}.zip" | grep -iE '\.env|\.db$|\.sqlite$|\.bson$|backup|node_modules|frontend/build|\.git/'
```
- **Expect:** the `unzip -l` grep prints **nothing** — `git archive` only ever includes tracked files, so `.env`/backups/`node_modules`/`.git` cannot appear; this line is the direct verification rather than trusting that fact blindly.
- **If it fails:** if anything matches, stop — something is tracked that shouldn't be (fix the `.gitignore`/untrack it, re-commit, regenerate the archive).

```bash
rm "sit-happens-release-checkpoint-${COMMIT}.zip"
```
- **Expect:** silent success — this was just a local inspection artifact, not something to ship or keep.

---

## 5. Confirm the current production working tree is clean

**Purpose:** if someone hand-edited a file directly on the Bazzite box, a `git pull` in Section 6 could produce a merge conflict or, worse, silently discard a real fix nobody committed. Confirm clean before pulling.

**5.1 — Check for local modifications**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
git status --porcelain=v1
git stash list
```
- **Expect:** both commands print nothing.
- **If it fails:** if `git status` shows modified/untracked files, **do not discard them.** Inspect what they are:
  ```bash
  git diff
  ```
  If they're genuinely disposable (e.g. a stray log file), remove just that file by name. If they look like a real fix someone made directly on the server, stash it first so it isn't lost, and flag it — do not proceed with the deploy until you understand what it is:
  ```bash
  git stash push -u -m "pre-deploy-$(date +%Y%m%d)"
  ```

---

## 6. Fetch and deploy the approved code

**Purpose:** get the commit from Section 4 onto the Bazzite host without touching `.env`, the Mongo volume, or anything in `backups/`.

**6.1 — Fetch**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
git fetch origin main
git log HEAD..origin/main --oneline
```
- **Expect:** the second command lists the new commit(s) coming in, including the one from Section 4.2 with its "feat(shop): public no-account storefront..." subject.
- **If it fails:** empty output means the push in 4.3 didn't actually land — check `git remote -v` on PROD matches `https://github.com/sithappensohio-maker/sithappens.git` and re-run `git fetch`.

**6.2 — Pull (fast-forward only — never a merge you haven't reviewed)**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
git pull --ff-only origin main
git log -1 --format="%H  %s"
```
- **Expect:** the second line's hash matches the commit from Section 4.2 exactly.
- **If it fails:** `fatal: Not possible to fast-forward` means the local tree diverged (shouldn't happen after Section 5's clean check) — stop and investigate rather than force anything.

**6.3 — Confirm nothing that matters was touched**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
ls -la .env
docker volume ls | grep sit-happens_mongo_data
ls ./backups | head -5
```
- **Expect:** `.env` still present with its original timestamp (untouched — it's gitignored, `git pull` never writes to it), the named Mongo volume still listed, and the backups directory's staged dump content still there.
- **If it fails:** if `.env` is missing, restore it from the Section 3 backup archive immediately (it's included at the top level of that tarball) before doing anything else.

---

## 7. Rebuild and restart only the required services

**Purpose:** use the repo's own documented compose commands — the same ones `update.sh` runs — not ad-hoc Docker commands.

**7.1 — Rebuild images**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
docker compose build
```
- **Expect:** a build log for `backend` and `frontend` (cached layers skipped where unchanged), ending without an error, and a final shell prompt back.
- **If it fails:** read the last ~20 lines of build output — usually a dependency install failure (`pip install`/`yarn install`). Do not retry blindly; fix the underlying cause (e.g. a transient registry timeout is safe to just retry once).

**7.2 — Restart**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
docker compose up -d
```
- **Expect:** output listing each of the four services as `Started` or `Running` (unchanged services show `Running` without restarting them unnecessarily — `mongo` in particular should NOT restart here, since its image didn't change).
- **If it fails:** a port-bind error (`address already in use`) means something else is holding 8080/27017 — `docker compose ps` to check for an orphaned container, `docker compose down` (safe — does not remove the named Mongo volume) and retry `up -d`.

---

## 8. Show logs and health checks confirming backend, frontend, MongoDB, and Cloudflare Tunnel connectivity

**8.1 — Container status**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
docker compose ps
```
- **Expect:** all four services `Up`, backend showing `(healthy)` once its `HEALTHCHECK` has run at least once (allow up to ~50s: `start-period=20s` + up to 3×10s retries).

**8.2 — Backend + Mongo (one check, since `/health` pings Mongo)**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
curl -fsS http://localhost:8080/api/health
```
- **Expect:** `{"status":"ok"}`.
- **If it fails:** a 503 with `"mongo unreachable"` in the body means Mongo isn't answering — check `docker compose logs mongo`. Connection refused entirely means the backend container itself didn't start — check `docker compose logs backend`.

**8.3 — Frontend serving**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
curl -fsSI http://localhost:8080/
```
- **Expect:** `HTTP/1.1 200 OK` with an nginx `Server` header.
- **If it fails:** check `docker compose logs frontend` — usually a build artifact missing, meaning 7.1 didn't actually complete for that image.

**8.4 — Recent logs, all services**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
docker compose logs --tail=80 backend
docker compose logs --tail=80 frontend
docker compose logs --tail=40 mongo
```
- **Expect:** backend log ends with Uvicorn's "Application startup complete" and no tracebacks; frontend log shows nginx's startup lines; mongo shows "Waiting for connections".
- **If it fails:** a traceback in the backend log at startup (not from an old previous run) means something in this release doesn't import cleanly in the container's environment — this should already be impossible given the passing local test/build gates, but if it happens, do not proceed to Section 9 — go to Section 15 (rollback) instead.

**8.5 — Cloudflare Tunnel connectivity** (runs on PROD, outside Docker — `cloudflared` is a host service per `docker-compose.yml`'s own comment)
- **Machine:** PROD
- **Directory:** (any)
```bash
sudo systemctl status cloudflared --no-pager
```
- **Expect:** `Active: active (running)`, and log lines further up showing "Registered tunnel connection" (typically 4 of them, one per Cloudflare edge connection — see `BAZZITE_SETUP.md` §5.7).
- **If it fails:**
  ```bash
  sudo journalctl -u cloudflared -n 50 --no-pager
  ```
  Per `BAZZITE_SETUP.md`'s own troubleshooting note, this is almost always a typo in `/etc/cloudflared/config.yml` — fix it, then `sudo systemctl restart cloudflared`.

---

## 9. Deploy with `public_shop_enabled=false`, then verify the disabled state

**Purpose:** the deploy in Sections 6–8 landed with whatever the flag was already set to. Before touching it at all, confirm it's `false` and prove every disabled-state behavior is correct — routing, the public endpoints' disabled response, and that the authenticated shop is completely unaffected by the flag. Only once all of this is confirmed does Section 10 turn it on.

**9.0 — Confirm the domain before using it anywhere in this section**
- **Machine:** PROD (or your own machine — this is just a DNS/reachability check)
- **Directory:** (any)
```bash
curl -fsSI https://sithappens.app/api/health
```
- **Expect:** `HTTP/2 200`. If this is not your actual domain, replace every occurrence of `https://sithappens.app` in the rest of this runbook with `⟦PLACEHOLDER: your real production domain⟧` before continuing.

**9.1 — Confirm the flag is actually `false`** (read-only GET, no auth needed)
- **Machine:** PROD
- **Directory:** (any)
```bash
curl -s https://sithappens.app/api/settings/public | python3 -c "import json,sys; d=json.load(sys.stdin); sp=d.get('shop_page',{}); print('public_shop_enabled:', sp.get('public_shop_enabled')); print('public_browsing_enabled:', sp.get('public_browsing_enabled'))"
```
- **Expect:** `public_shop_enabled: False` and `public_browsing_enabled: False`.
- **If it fails:** if either prints `True`, it was left on from a prior session — turn it off now via **Shop Manager → Shop Settings → Public Storefront** in the admin app before continuing, so the rest of this section genuinely tests the disabled state.

**9.2 — `/shop` hard refresh reaches the SPA and shows the closed state**
- **Machine:** anywhere with internet access (your own laptop is fine)
- **Directory:** (any)
```bash
curl -fsSI https://sithappens.app/shop
```
- **Expect:** `HTTP/2 200` (nginx's SPA fallback hands back `index.html` regardless of app state — see "Facts" section). Then open `https://sithappens.app/shop` in an actual browser (a hard refresh, Ctrl/Cmd+Shift+R) and confirm the page renders React's "Shop is currently closed" screen, not a browser-level error page.
- **If it fails:** a `curl` 404 means the SPA fallback isn't taking effect — this is diagnosed precisely in 9.5 below, don't guess at it here.

**9.3 — `/shop/item/...` hard refresh reaches the SPA, not a server-level 404**
- **Machine:** anywhere with internet access
- **Directory:** (any)
```bash
curl -fsSI https://sithappens.app/shop/item/product/anything-here
```
- **Expect:** `HTTP/2 200` — this is the exact same client-side route as `/shop`, so nginx only ever needs to hand back `index.html`; the actual product id doesn't need to resolve to anything real for this check (React will render its own "item not available" state, not a routing failure). Confirm the same in a real browser with a hard refresh.
- **If it fails:** same as 9.2 — go to 9.5.

**9.4 — Public catalog/item/media endpoints return the expected disabled response**
- **Machine:** PROD
- **Directory:** (any)
```bash
curl -s https://sithappens.app/api/public/shop/catalog
curl -s https://sithappens.app/api/public/shop/taxonomy
curl -s https://sithappens.app/api/public/shop/item/product/anything-here
curl -s https://sithappens.app/api/public/shop/media/00000000-0000-0000-0000-000000000000
```
- **Expect:** all four return HTTP 404 with a real JSON body — the catalog/taxonomy/item calls with `{"detail":"Shop is not available."}` (the explicit disabled-state message), the media call with `{"detail":"Not found."}` (media authorization independently evaluates to false while the shop is off). All four proving the backend evaluated the request and correctly rejected it — not a connection failure.
- **If it fails:** a 404 with an nginx/Cloudflare error page instead of this JSON body means the request never reached the backend at all — recheck Section 6.3/7.2/8.2.

**9.5 — Confirm Cloudflare/direct-path SPA routing does not return a server-level 404**

This isolates *why* 9.2/9.3 would fail, if they did — distinguishing "the React app rendered its own not-found state" (fine) from "nginx/Cloudflare returned an actual HTTP 404" (a real routing bug).

- **Machine:** PROD
- **Directory:** (any)
```bash
# Direct to nginx, bypassing Cloudflare entirely
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/shop
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/shop/item/product/anything-here
```
- **Expect:** `200` both times — confirms `frontend/nginx.conf`'s `try_files ... /index.html` fallback is working at the container level.
- **If it fails:** the deployed `nginx.conf` doesn't match this repo's. Check:
  ```bash
  docker compose exec frontend cat /etc/nginx/conf.d/default.conf | tail -10
  ```
  Compare against `frontend/nginx.conf`'s last block. If it differs, the image wasn't rebuilt from current source — `docker compose build frontend --no-cache && docker compose up -d frontend`.

```bash
# Through Cloudflare
curl -s -o /dev/null -w "%{http_code}\n" https://sithappens.app/shop
```
- **Expect:** `200`, matching the direct check above.
- **If it fails while the direct check succeeds:** the problem is Cloudflare, not your server. Check the tunnel's `ingress` rules in `~/cloudflared/config.yml` / `/etc/cloudflared/config.yml` (`BAZZITE_SETUP.md` §5.6) — exactly one hostname rule pointing at `http://localhost:8080`, catch-all `http_status:404` after it; confirm no Cloudflare Page Rule/Worker is separately intercepting `/shop*` in the dashboard.

**9.6 — Signed-in `/shop` still opens the authenticated shop**
- **Machine:** your own browser, logged in as an existing client at `https://sithappens.app`
- Navigate to `https://sithappens.app/shop`.
- **Expect:** the *real* authenticated Portal shop view opens (real inventory counts, a working cart/checkout button) — completely unaffected by `public_shop_enabled` being `false`. This proves `ShopGate`'s authenticated branch never depends on the public-storefront flag at all.
- **If it fails:** if this shows the "closed" guest state instead of the real shop, something is wrong with token validation in `ShopGate`, not with the public-shop flag — do not proceed to Section 10 until this is understood; the disabled flag must never affect authenticated clients.

---

## 10. Enable the public storefront through Shop Settings

**Purpose:** the real, single, go-live toggle — done through the admin UI, never a direct Mongo write.

- **Machine:** your own browser, logged in as admin at `https://sithappens.app`
- Navigate: **Shop Manager → Shop Settings → Public Storefront** → check "Enable Public Shop" and "Allow Public Browsing" (and any of `show_public_prices`/`show_public_merch`/`show_public_prepaid`/`show_public_training`/`show_out_of_stock` you intend to ship with — confirm each reflects your actual intended launch configuration, not just "on") → Save.
- **Expect:** the settings screen confirms the save with no error banner.
- **If it fails:** check the browser console/network tab for the `PUT /api/settings` call's response; do not proceed to Section 11 until it visibly reflects the new value on reload.

**Documented fallback only** (per your instruction — use only if the UI itself is genuinely unavailable, e.g. the admin app won't load):
```bash
ADMIN_TOKEN=⟦PLACEHOLDER: real admin JWT⟧
curl -s -X PUT https://sithappens.app/api/settings -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"shop_page": {"public_shop_enabled": true, "public_browsing_enabled": true}}'
```

---

## 11. Verify the enabled state

**11.1 — Public catalog returns 200**
- **Machine:** PROD (or anywhere)
- **Directory:** (any)
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sithappens.app/api/public/shop/catalog
```
- **Expect:** `200`, with a real `{"items": [...]}` body if you drop the `-o /dev/null -w` and just run `curl -s https://sithappens.app/api/public/shop/catalog`.
- **If it fails:** re-check Section 10 actually saved; reload the Shop Settings screen and confirm both checkboxes show checked.

**11.2 — Public item detail returns 200**
- **Machine:** PROD
- **Directory:** (any)
```bash
curl -s https://sithappens.app/api/public/shop/catalog | python3 -c "import json,sys; items=json.load(sys.stdin)['items']; print(items[0]['kind'], items[0]['id']) if items else print('NO ITEMS — nothing publicly_visible yet')"
```
- **Expect:** a `kind id` pair. If it prints "NO ITEMS", mark at least one existing product/pack/program `publicly_visible` via its editor first (Shop Manager → Items) before continuing.
```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://sithappens.app/api/public/shop/item/⟦PLACEHOLDER: kind-from-above⟧/⟦PLACEHOLDER: id-from-above⟧"
```
- **Expect:** `200`.

**11.3 — Public media loads and ETag revalidation works**
- **Machine:** PROD
- **Directory:** (any)

Get a real media id (from the item above, if it has an `image_id`, or any category's `image_id` via the taxonomy endpoint):
```bash
curl -s https://sithappens.app/api/public/shop/taxonomy | python3 -c "import json,sys; cats=json.load(sys.stdin)['categories']; m=[c['image_id'] for c in cats if c.get('image_id')]; print(m[0] if m else 'NO CATEGORY IMAGES')"
```
```bash
MEDIA_ID=⟦PLACEHOLDER: id-from-above⟧
curl -sD - -o /dev/null "https://sithappens.app/api/public/shop/media/$MEDIA_ID" | grep -i etag
ETAG=$(curl -sD - -o /dev/null "https://sithappens.app/api/public/shop/media/$MEDIA_ID" | grep -i '^etag:' | cut -d' ' -f2 | tr -d '\r')
curl -s -o /dev/null -w "%{http_code}\n" -H "If-None-Match: $ETAG" "https://sithappens.app/api/public/shop/media/$MEDIA_ID"
```
- **Expect:** the first request returns a `200` with an `ETag` header; the conditional repeat with `If-None-Match` set to that exact value returns `304`.
- **If it fails:** a `200` again on the conditional request (never `304`) means ETag revalidation isn't matching — check the media id was copied exactly, quotes included.

**11.4 — Signed-out browsing checks**

All in a private/incognito browser window at `https://sithappens.app/shop`:

- **Category navigation and search:** click into a section/category card, then use the search box for a known item name.
  - **Expect:** real categories with correct item counts; search narrows to matching items only.
- **Public images:** open any category with a configured cover image.
  - **Expect:** the real image renders (not a broken-image icon); devtools network tab shows `200` from `/api/public/shop/media/<id>` with an `ETag` header (matches 11.3).
- **Shopify `View Options`:** find a Shopify-linked product, click **View Options**.
  - **Expect:** opens the Shopify listing in a new tab; `localStorage.getItem('sh_guest_cart')` in devtools never contains that item.
- **Guest cart:** add an eligible item to the cart, then hard-refresh the page.
  - **Expect:** the cart badge/count survives the refresh (backed by `localStorage["sh_guest_cart"]`).
- **Stale-token fallback:** in a *separate*, already-signed-in tab, run `localStorage.setItem('sh_token', 'invalid.stale.token')` in devtools, then hard-refresh `/shop`.
  - **Expect:** falls back to the guest storefront at the same `/shop` URL — no redirect, no crash.
- **Auth merge flow:** with an item still in the guest cart, click "Sign In / Create Account" and sign in (a real account, or one made for this check).
  - **Expect:** the guest-cart review dialog appears automatically showing requested/existing/adding quantities and real account pricing. You can either confirm the merge here (folding into Section 13 next) or dismiss it and confirm the cart survives in `localStorage["sh_guest_cart"]` for later.

---

## 12. Immediately disable it again if a blocking issue appeared

**Purpose:** a fast, deliberate off-switch — don't leave the public storefront live while you investigate something Section 11 turned up.

**What counts as blocking:** any of — a public endpoint 500s (not a clean 404/200), an image fails to authorize/load for a category that should be visible, the guest cart writes anything beyond `{kind, ref_id, quantity}` to `localStorage`, the merge-review dialog shows wrong quantities or a JS error, or anything in 11.1–11.4 simply didn't match its **Expect** line after a genuine retry.

- **Machine:** your own browser, logged in as admin at `https://sithappens.app`
- Navigate: **Shop Manager → Shop Settings → Public Storefront** → uncheck "Enable Public Shop" and "Allow Public Browsing" → Save.
- **Expect:** `curl -s https://sithappens.app/api/public/shop/catalog` (from anywhere) returns the 404-disabled response again, matching Section 9.4.
- **If it fails:** confirm the save actually took (reload the screen, checkboxes show unchecked) before doing anything else. If the admin UI itself is unreachable, use the fallback `PUT /api/settings` command from Section 10 with both flags set to `false`.

**If nothing blocking appeared**, proceed to Section 13 with the storefront still enabled.

---

## 13. Perform one controlled production flow

**Purpose:** the actual guest → sign-in → merge → checkout path, for real, once. Continues naturally from wherever 11.4's "auth merge flow" check left off — no need to restart from a fresh guest session if you already have an item in the cart and are signed in.

Use a **real credit card in Stripe's live mode** only if you intend an actual charge — if you want this to be a true zero-cost smoke test, use a low-value real item and be prepared to refund it in Stripe afterward, or coordinate a $0/test discount code if your setup has one. This runbook does not fabricate a "test mode" that doesn't exist in your Stripe configuration — check `STRIPE_ONLINE_ENABLED`/`STRIPE_SECRET_KEY` in your production `.env` to know which mode you're in before starting.

**13.1 — Guest opens the shop**
- Private/incognito window → `https://sithappens.app/shop` (skip if continuing from 11.4).
- **Expect:** storefront loads.

**13.2 — Adds eligible merchandise**
- Find an item whose card shows a real "Add to Cart" button (not "Sign In for Pricing"/"Contact Us"/"View Options") and add it (skip if already done in 11.4).
- **Expect:** cart badge increments; `localStorage["sh_guest_cart"]` contains `{kind, ref_id, quantity}` for that item.

**13.3 — Signs in**
- Click "Sign In / Create Account" → sign in (skip if already signed in from 11.4).
- **Expect:** the guest-cart review dialog appears automatically, showing requested/existing/adding quantities and real account pricing.

**13.4 — Reviews and merges the cart**
- Click **Add to Cart** in the review dialog.
- **Expect:** `localStorage["sh_guest_cart"]` is now empty; the authenticated cart shows the merged item/quantity.

**13.5 — Completes the existing authenticated checkout**
- Proceed to checkout as normal (Stripe Checkout).
- **Expect:** redirected to Stripe, completes payment, redirected back to `/shop?shop_order=<id>&stripe=success`, and the app shows the order as paid/processing per the existing return-status polling.

---

## 14. Verify the resulting records against a normal authenticated purchase

- **Front Desk → Online Orders** (or **Shop Manager → Online Orders**): the new order appears, correct line item, correct total.
- **Order fulfillment**: mark Ready → Picked Up (or confirm it auto-resolves for a non-physical item) exactly like any other Shop order — see `RELEASE_CHECKLIST.md`'s own "Online-order pickup" smoke-test line.
- **Inventory**: if the item tracks inventory, confirm `stock_on_hand` decremented by exactly the purchased quantity (Shop Manager → Items, or Front Desk register view) and exactly one `inventory_movements` row exists for this order (admin/API — same invariant `test_pos_inventory.py`/`test_shop_checkout.py` already assert locally).
- **Receipt**: open/print/email the receipt from the completed order — same as `RELEASE_CHECKLIST.md`'s "Receipt verification" line.
- **Reporting**: Finance/Register → Money Health (or the day's revenue view) includes this sale's amount, same as any other Shop order paid today.
- **Expect, overall:** every one of the above is indistinguishable from a purchase made by a client who was never a guest — no separate code path, no separate record shape, no missing line.
- **If it fails:** anything here that looks different from a normal authenticated Shop order is a real bug — stop, do not chase it live in production, and go to Section 15 (rollback) while you investigate against the local test suites.

---

## 15. Rollback — exact commands

Use this if Section 8, 9, 11, 13, or 14 turns up something wrong. Two independent things can need rolling back: the source code, and the database. Do the source rollback first (fast, safe, non-destructive), and only touch the database if you're certain the new code actually wrote something bad (a schema/data change — this release makes no such change, so in practice you should only need the source rollback).

**16.1 — Source rollback**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
git log --oneline -5   # confirm which commit you're rolling back FROM
git checkout ⟦PLACEHOLDER: the commit hash recorded in Section 1.1⟧
docker compose build
docker compose up -d
curl -fsS http://localhost:8080/api/health
```
- **Expect:** health check returns `{"status":"ok"}` running the previous commit's code.
- **Note:** this leaves the repo in a "detached HEAD" state at the old commit — that's fine for production (it's not a dev environment doing further commits), but to get back to tracking `main` cleanly afterward: `git checkout main`.

**16.2 — Database rollback** (only if you have concrete evidence the new code wrote bad data — this release adds no schema/migration, so this should not be needed)
- **Machine:** PROD
- **Directory:** `~/sit-happens-backups`
```bash
ARCHIVE=sit-happens-backup-⟦PLACEHOLDER: the exact timestamp from Section 3.1⟧.tar.gz
mkdir -p /tmp/sit-happens-restore
tar xzf "$ARCHIVE" -C /tmp/sit-happens-restore
cd /tmp/sit-happens-restore
ls   # confirm you see: mongo/  .env  docker-compose.yml  RESTORE.md
```
- **Expect:** those four entries present (matches the verification in 3.2).

```bash
cd ~/sit-happens
docker compose down
docker compose up -d mongo
docker cp /tmp/sit-happens-restore/mongo sit-happens-mongo:/restore-tmp
docker exec sit-happens-mongo mongorestore --drop /restore-tmp
docker exec sit-happens-mongo rm -rf /restore-tmp
docker compose up -d
curl -fsS http://localhost:8080/api/health
```
- **Expect:** `mongorestore` logs each collection restored, ending without errors; final health check returns `{"status":"ok"}`.
- **If it fails:** if `mongorestore` errors partway through, do **not** assume a partial restore is safe to run with — re-run the full sequence from `docker compose down` rather than layering a second restore attempt on top of a half-applied one.

```bash
rm -rf /tmp/sit-happens-restore
```
- **Expect:** cleanup of the scratch extraction directory — the archive itself in `~/sit-happens-backups/` is untouched and stays available.

**16.3 — After either rollback, turn public browsing back off** (it inherited whatever state the restored code/data had — don't assume it matches Section 9)
- Repeat the check in Section 9.1 and, if needed, the disable steps in Section 12.

---

## 16. Only after the production smoke test succeeds — commit, push, and tag the release

**Do not run this section unless Sections 8 through 14 all passed and no rollback was needed.**

**17.1 — Confirm you're tagging the commit that's actually deployed and verified**
- **Machine:** PROD
- **Directory:** `~/sit-happens`
```bash
git log -1 --format="%H"
```
- **Expect:** this hash matches the one from Section 4.2/6.2 exactly — you're about to tag the commit that was actually smoke-tested, not some other one.

**17.2 — Tag on DEV** (tags are normally created where you have full history/signing set up — this repo's `RELEASE_CHECKLIST.md` shows this as a DEV-side step)
- **Machine:** DEV
- **Directory:** `C:\Users\Sit Happens\Documents\GitHub\sithappens`
```bash
git log -1 --format="%H  %s"   # confirm this matches 17.1's hash before tagging
git tag -a ⟦PLACEHOLDER: e.g. v2026.08.03-public-shop⟧ -m "Shop Appearance, Public Storefront, and Guest-to-Account Cart Flow — verified in production"
git push origin ⟦PLACEHOLDER: same tag name⟧
```
- **Expect:** the push prints `* [new tag] <tag-name> -> <tag-name>`.
- **If it fails:** `git fetch --tags` first to make sure the tag name doesn't already exist; pick a different name rather than force-pushing over an existing tag.

**17.3 — Confirm the tag is visible on GitHub**
- **Machine:** DEV (or any browser)
```bash
git ls-remote --tags origin | grep ⟦PLACEHOLDER: your tag name⟧
```
- **Expect:** one line showing the tag's commit hash, matching 17.1.

This is the final step. The release is now: deployed, verified end-to-end in production, and tagged as the record of what shipped.
