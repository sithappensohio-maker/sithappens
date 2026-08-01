# Sit Happens — Release Checklist

Run through this in order before deploying a build. Every command below is
run from the repo root (`sithappens/`) unless a `cd` is shown. Windows users
running these outside Claude Code's Bash tool: use Git Bash, not PowerShell
or cmd — the syntax below is POSIX shell.

## 1. Before deployment

**Working tree and branch**
```bash
git status --porcelain=v1
git branch --show-current
git log --oneline -5
```
- `git status` should show exactly the files you intend to release — nothing
  stray, nothing half-finished.
- Confirm the branch is `main` and the commit log matches what you expect to
  ship.

**No secrets, local data, or build artifacts are tracked**
```bash
git ls-files | grep -iE '\.env$|\.env\.|\.sqlite|\.db$|mongodump|\.bson$|backup|\.zip$|node_modules|^frontend/build/'
```
This should print **nothing**. If it prints anything, stop — do not deploy
until it's removed from tracking (`git rm --cached <path>` + add it to
`.gitignore` if it isn't already).

**Fresh host backup**
- Run whatever this host's existing backup job is (see `backend/server.py`'s
  auto-backup settings, or trigger one manually from Settings → Backups in
  the admin app) *before* touching anything else.
- Confirm the new backup file actually landed and has a non-trivial size —
  don't trust a job that "ran" silently.

**Backend test suite**
```bash
cd backend
"./.venv_local_test/Scripts/python.exe" -m pytest -v
cd ..
```
All tests should pass. If any fail, do not deploy — fix or explicitly
document the failure and its cause first (see the release report format for
what "explicitly document" means: reproduce it, name the file responsible,
never wave it off as "unrelated" without doing that).

**Frontend test suite**
```bash
cd frontend
CI=true npx craco test --watchAll=false
cd ..
```

**Production frontend build**
```bash
cd frontend
CI=true npx craco build
cd ..
```
`CI=true` turns build warnings into hard failures — this is the same gate a
real CI pipeline would apply. A clean run prints no warnings and ends with
"The build folder is ready to be deployed."

## 2. Core workflow smoke test

Do this against a real running instance (local or staging), not just the
test suite — the tests prove the code is correct, this proves the *deployed
app* actually works end to end. Use a disposable test client/dog where
possible; note anything real that had to be exercised (e.g. an unavoidable
live register open).

- [ ] Admin login
- [ ] Client login
- [ ] Open register (Front Desk → Open Register)
- [ ] Scheduled daycare check-in (Front Desk → Today's Visits → Expected → Check In)
- [ ] Quick Check-In / walk-in (Front Desk → Today's Visits → Quick Check-In / Walk-In)
- [ ] Ongoing boarding dog stays visible in Today's Visits (On-Site tab, a stay that started before today)
- [ ] Single-dog checkout (Today's Visits → Check Out → confirm in CheckoutModal)
- [ ] Multi-dog household checkout (two checked-in dogs from the same household → combined CheckoutModal, combined-discount applied)
- [ ] Cash payment (checkout with a cash tender — confirms the register-open gate is enforced for real)
- [ ] Stripe/card payment
- [ ] Credit-covered visit (a client with a prepaid pack — checkout deducts a credit instead of charging)
- [ ] Physical product sale (Front Desk retail cart → checkout)
- [ ] Client Shop checkout (client portal → Shop → cart → Stripe Checkout)
- [ ] Online-order pickup (Front Desk Online Orders or Shop Manager Online Orders → Mark Ready → Mark Picked Up)
- [ ] Receipt verification (view/print/email a receipt from a completed sale)
- [ ] Close register (Finance/Register → close the day, confirm the closeout summary)
- [ ] Money Health review (Finance dashboard shows sane totals for the day's activity above)
- [ ] Backup completion verification (re-check the backup from step 1 completed without error)

## 3. Source checkpoint

```bash
# Commit whatever release-readiness changes are staged (test fixes, docs —
# never feature work in this step).
git add <files>
git commit -m "chore: release readiness — <short description>"

# Push
git push origin main

# Annotated tag
git tag -a <tag-name> -m "<short description of what's in this release>"

# Push the tag
git push origin <tag-name>

# Generate a source archive from the tagged commit (not the working tree —
# this guarantees the archive matches exactly what's on the tag, nothing
# uncommitted sneaks in).
git archive --format=zip -o <archive-name>.zip <tag-name>
```

**Inspect the archive before shipping it anywhere:**
```bash
unzip -l <archive-name>.zip | less
```
- Confirm every file you expect is present (application code, this
  checklist, any new helper/test files from the release).
- Confirm `.env`, `.env.local`, any `.db`/`.sqlite`/`.bson` file, any
  `backup`/`dump` archive, `node_modules/`, `frontend/build/`, and `.git/`
  are **absent**. `git archive` naturally excludes untracked and
  gitignored files, but verify the listing directly rather than trusting
  that — an archive is the thing that actually gets deployed.

Do not paste real passwords, API keys, or tokens into this checklist, a
commit message, or the release report. Reference *where* a secret lives
(e.g. "backend/.env, gitignored"), never its value.
