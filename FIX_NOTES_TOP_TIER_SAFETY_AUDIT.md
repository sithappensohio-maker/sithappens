# Top-tier safety audit patch

This patch is designed as a safe upgrade for the self-hosted Bazzite install. It does **not** wipe MongoDB data and does **not** change the Docker volume.

## Fixed

### 1. In-app backup coverage expanded
The JSON backup now includes newer business-critical collections that were previously missing, including:

- payment_ledger
- waitlist
- intake_form_templates / intake_submissions
- client_communications / client_message_threads
- bulk_email_templates / bulk_email_history
- help_requests
- announcements / announcement_reads
- review_requests
- training_tips
- program_enrollments / training_session_log
- punch_corrections
- vaccine_uploads
- audit_log

Backup version is now `6`. Older v1-v5 backups are still accepted.

### 2. Deactivated accounts are actually blocked
Users with `active: false` can no longer log in or continue using old saved JWT tokens. Legacy users with no `active` field still work.

### 3. Client/dog delete is now soft-delete
The client and dog delete endpoints no longer hard-delete business records.

- Clients are marked with `deleted_at`, `deleted_by`, `active: false`.
- Their dogs are marked with `deleted_at`, `deleted_by`, `active: false`.
- Linked portal users are set `active: false`.
- Normal client/dog lists hide soft-deleted records.
- Existing credits, bookings, payments, notes, history, and tax records remain in MongoDB.

### 4. Delete endpoints now check delete permission
Client/dog delete endpoints require `delete_records` permission in addition to admin role.

### 5. Destructive scripts now have stronger guards
`backend/reset_db.py` and `backend/cleanup_test_data.py --confirm` now require:

```bash
SIT_HAPPENS_ALLOW_DATA_WIPE=YES_I_HAVE_A_BACKUP
```

`reset_db.py` also requires `--confirm-reset`.

### 6. Docker env forwarding cleaned up
`docker-compose.yml` now forwards admin/CORS env settings into the backend container and documents that the root `.env` is the source Compose reads.

## Validation performed

```bash
python -m compileall -q backend
bash -n update.sh backup-now.sh migrate-export.sh migrate-import.sh install.sh setup-auto-backup.sh
python -m py_compile backend/server.py backend/reset_db.py backend/cleanup_test_data.py
```

Frontend production build was not run in this environment because dependencies/node_modules are not installed here.

## Deployment reminder

Before pulling this onto the live Bazzite machine:

```bash
cd ~/sit-happens
./backup-now.sh
```

Then deploy from a branch, not directly over `main`, until verified.
