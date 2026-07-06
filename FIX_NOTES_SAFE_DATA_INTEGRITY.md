# Safe Data Integrity Patch — Archive, Vaccines, Quotes, Backups

This patch is designed as a safe upgrade for an existing Sit Happens install.
It does **not** drop, wipe, or migrate clients, dogs, credits, bookings, or users.
Existing MongoDB data remains in place through normal `git pull` / container rebuild updates.

## What changed

### 1. Archived bookings are included in reports/history/backups
Completed/cancelled/rejected bookings older than 90 days can be moved from `bookings` into `bookings_archive`.
Several reports previously read only `bookings`, which could make old income/history disappear after archiving.

Fixed areas now read hot + archived bookings:
- Income transactions list
- Weekly income summary
- Date-range summary
- Quarterly tax estimate
- Year-end income CSV
- Sales tax summary
- P&L report builder
- Dog lifetime stats
- Dog timeline
- Admin client portal snapshot
- Full backup export/auto-backup

`bookings_archive` is now included in `BACKUP_COLLECTIONS` and backup version is bumped to v5.
Older backups still restore; missing collections are left alone.

### 2. Client vaccine uploads are pending review
Client portal vaccine uploads no longer immediately overwrite `dog.vaccines`.
They now write to `dog.vaccine_certs.{vaccine}` with:
- `status: pending_review`
- `pending_expires_on`
- uploaded photo(s)

Admin approval now applies the expiry to `dog.vaccines` and marks the cert approved.
Rejecting a pending upload does not wipe an older approved expiry unless the rejected upload's expiry exactly matches the value currently on the dog.

### 3. Backend pricing quote endpoint
Added:

`POST /api/pricing/quote`

This is read-only and does not create bookings or spend credits.
It returns backend-calculated units, unit label, unit price, estimated price, add-ons, presence dates, and credit units required.

The portal booking estimate now uses this backend quote for normal single-dog single-date bookings, with the old React-side estimator kept as fallback for multi-dog/multi-date edge cases.

### 4. Upload guardrails
Vaccine upload photos are capped to avoid giant base64 blobs slowing MongoDB or hitting document limits.

### 5. Tests added/updated
Added `backend/tests/test_safe_data_integrity_patch.py` for:
- Backup includes `bookings_archive`
- Backend quote prices a 3-night boarding stay correctly
- Zero-night boarding quote is rejected
- Client vaccine upload stays pending instead of immediately approving

Updated backup coverage expectations to require `bookings_archive`.

## Validation performed here

Passed:

```bash
python -m compileall -q backend
python -m py_compile backend/server.py backend/pl_report.py
```

Frontend build could not be completed in this container because frontend dependencies are not installed here (`craco: not found`). Run your normal build on the Bazzite machine after pulling this branch.

## Safety notes for production

Before deploying on the Bazzite machine:
1. Run your normal Mongo backup/export.
2. Pull this on a test branch first.
3. Confirm clients, dogs, credits, and existing bookings still show.
4. Test one boarding quote, one checkout, and one vaccine upload/review.

No database wipe or reset command is included in this patch.
