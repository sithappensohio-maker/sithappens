# Phase 7 — Backup Restore Safety + Production Health Hardening

Added a pre-update safety panel in Settings → Backup & Restore.

## Added

- `/api/admin/backup-safety/report`
  - recent backup status
  - latest backup file existence and size
  - critical collection counts
  - disk pressure summary
  - pre-update go/no-go flag
  - update checklist reminders

- `/api/admin/backup-safety/validate-latest`
  - safely opens/parses the latest in-app backup
  - verifies critical collections are present
  - records validation history in `backup_restore_drills`
  - does not restore or mutate data

- `/api/admin/backup-safety/validations`
  - shows recent validation history

- Backup collection list now includes `backup_restore_drills`.
- Backup version bumped to v7.

## Safety notes

This phase does not delete clients, dogs, credits, bookings, payments, rewards, or register records.
It only adds read-only safety checks and stores backup validation history.

The host-level `./backup-now.sh` tarball remains important because it saves Mongo plus environment/config files on the Bazzite host.
