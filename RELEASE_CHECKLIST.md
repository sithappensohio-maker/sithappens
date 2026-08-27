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
git ls-files | grep -iE '\.env$|\.env\.|\.sqlite|\.db$|mongodump|\.bson$|backup|\.zip$|node_modules|^frontend/dist/'
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

**Backend test suite — focused/ad hoc tests (isolated test database)**
```bash
cd backend
"./.venv_local_test/Scripts/python.exe" -m pytest test_pos_catalog.py test_pos_checkout_integrity.py test_front_desk_checkin.py test_shop_manager_polish.py -v
cd ..
```
These four files run against a dedicated, disposable database
(`sit_happens_test_disposable`, or `$SIT_HAPPENS_TEST_DB_NAME` if set) —
never the real local dev database (`sit_happens_local_test`). Every file
starts with `import _test_env` before `import server`; that import claims
`DB_NAME` before `server.py`'s own `load_dotenv()` call can set it from
`.env`, then synchronously drops the disposable database so every run
starts from a guaranteed-empty state — no manual clearing, no dependency on
leftover data or run order. `_test_env.assert_safe_test_db_name()` refuses
to treat any name without `test` in it (and a short list of real/reserved
names) as disposable, so a misconfiguration can never point destructive
cleanup at real data. `_test_loop.py` then replicates the production
`startup()` index creation (including the unique indexes several
idempotency guards depend on) against the fresh database, since calling
`server`'s functions directly never goes through FastAPI's lifespan.
All 41 tests must pass.

**Backend test suite — full suite (includes the legacy `tests/` directory)**

Unlike the four ad hoc files above, `backend/tests/*.py` are HTTP-based —
they call a real, separately running `uvicorn` server rather than importing
`server.py` in-process, so they need that server up first, pointed at a
test database, with `BACKUP_ROOT` set to a disposable directory (never the
real local dev database or the real backup folder):
```bash
cd backend
export MONGO_URL="mongodb://127.0.0.1:27017"
export DB_NAME="sit_happens_test_disposable"        # never sit_happens_local_test
export JWT_SECRET="$(grep -E '^JWT_SECRET=' .env | cut -d= -f2-)"
export BACKUP_ROOT="$(pwd)/_local_test_backups"      # isolated test dir, not /app/backups
export TEST_BACKEND_URL="http://127.0.0.1:8010"      # a port not used by your normal dev server
nohup "./.venv_local_test/Scripts/python.exe" -m uvicorn server:app --host 0.0.0.0 --port 8010 > /tmp/test_server.log 2>&1 &
"./.venv_local_test/Scripts/python.exe" -m pytest -v
kill %1   # stop the test-only server when done
cd ..
```
`tests/test_sprint_110di_25.py`'s backup-snapshot check reads `BACKUP_ROOT`
from the environment the same way `server.py` does — it will look in
whatever directory the server above was actually started with, so the two
must agree. All tests should pass. If any fail, do not deploy — fix or
explicitly document the failure and its cause first (see the release report
format for what "explicitly document" means: reproduce it, name the file
responsible, never wave it off as "unrelated" without doing that).

**Backend test suite — release-critical gate**

The full legacy `tests/` suite (previous section) has ~150 files, many of
which assume a long-lived, already-onboarded dev database (specific
settings, specific named employees, historical seed content) that a
genuinely clean database doesn't have — that's real, separate technical
debt, not something this phase attempts to fix wholesale. The
release-critical gate is a curated subset: every file in it is verified to
pass 100% clean from a byte-fresh, isolated database, so it's the command
to actually trust before shipping.

```bash
cd backend
mkdir -p _test_release_critical_backups
export MONGO_URL="mongodb://127.0.0.1:27017"
export DB_NAME="sit_happens_test_release_critical"     # never sit_happens_local_test
export JWT_SECRET="$(grep -E '^JWT_SECRET=' .env | cut -d= -f2-)"
export STRIPE_WEBHOOK_SECRET="$(grep -E '^STRIPE_WEBHOOK_SECRET=' .env | cut -d= -f2-)"
export ADMIN_EMAIL="admin@sithappens.com"
export ADMIN_PASSWORD="admin123"                        # legacy suite hardcodes this
export BACKUP_ROOT="$(pwd)/_test_release_critical_backups"
export TEST_BACKEND_URL="http://127.0.0.1:8011"          # a port not used by your normal dev server
nohup "./.venv_local_test/Scripts/python.exe" -m uvicorn server:app --host 127.0.0.1 --port 8011 > /tmp/rc_server.log 2>&1 &
sleep 4

# The four ad hoc files (see above) — always run these too, they're the
# other half of release-critical coverage (checkout atomicity/idempotency,
# multi-dog household checkout, cash-register-day enforcement, stock
# movements) and don't need this server.
"./.venv_local_test/Scripts/python.exe" -m pytest test_pos_catalog.py test_pos_checkout_integrity.py test_front_desk_checkin.py test_shop_manager_polish.py -v

# The 16-file curated legacy set — a single command, resets the database
# (including rebuilding indexes) before every file:
"./.venv_local_test/Scripts/python.exe" tests/run_release_critical.py

kill %1   # stop the test-only server when done
cd ..
```

`tests/release_critical_reset.py` rebuilds indexes after every reset
because dropping the database also drops the unique `idempotency_key`
indexes several checkout/payment tests rely on to detect a duplicate
request — those indexes only get created by a real app's FastAPI startup
lifespan, which the HTTP-based legacy suite's server process runs exactly
once, not once per test file. Skipping this step causes false idempotency
failures that look like real bugs but aren't (found and fixed during this
gate's construction — `test_pos_register.py`, `test_shop_checkout.py`, and
`test_pos_inventory.py` all went from failing to 100% clean once this was
corrected).

Current release-critical coverage, all passing clean (232 legacy tests
across 16 files + 41 ad hoc tests — see `tests/run_release_critical.py`
for the exact file list):
- Authentication and permissions
- Client and dog records (partial — `test_dogs_endpoint_coercion.py`)
- Check-in and checkout, multi-dog household checkout (ad hoc suite)
- Cash register enforcement
- Credits and credit lots
- Shop catalog and checkout, online-order fulfillment
- Inventory reservations
- Backups and restore validation
- Data export

**Known gap — not covered by a clean-database run today** (tracked as a
separate test-infrastructure follow-up, not silently skipped or hidden):
booking creation/approval (`test_sithappens.py::TestBookings`,
`test_sprint3.py`'s auto-approve/cutoff/training-booking tests),
invoices and payments (`test_invoice_foundation.py`,
`test_invoice_topup_payments.py`, `test_partial_payment.py`,
`test_payment_plans.py`), Stripe/webhook integrity
(`test_stripe_online_payments.py` — 39/45 tests need Stripe-specific
fixtures a clean database doesn't provide), boarding/daycare pricing edge
cases and shop category management (`test_stay_pricing.py`,
`test_shop_categories.py`), and a few permission-matrix-shape assertions
(`test_permission_matrix.py`, `test_roles_permissions.py`). All of these
were spot-checked to fail even in complete single-file isolation with a
correctly-indexed database — they're not cross-file pollution, they
genuinely assume pre-existing settings/services/data that only exist on a
long-lived, manually-onboarded database. Closing this gap means building
proper seed fixtures for these areas — real, worthwhile work, but a
separate effort from this release-readiness pass.

**Frontend test suite**
```bash
cd frontend
yarn test:ci
cd ..
```

**Production frontend build**
```bash
cd frontend
yarn build
cd ..
```
`CI=true` turns build warnings into hard failures — this is the same gate a
real CI pipeline would apply. A clean run prints no warnings and ends with
a successful Vite build in `frontend/dist/`.

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
  `backup`/`dump` archive, `node_modules/`, `frontend/dist/`, and `.git/`
  are **absent**. `git archive` naturally excludes untracked and
  gitignored files, but verify the listing directly rather than trusting
  that — an archive is the thing that actually gets deployed.

Do not paste real passwords, API keys, or tokens into this checklist, a
commit message, or the release report. Reference *where* a secret lives
(e.g. "backend/.env, gitignored"), never its value.
