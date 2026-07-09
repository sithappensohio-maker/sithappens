# Persistent Verified Backups

## What changed

- The backend now bind-mounts the host `./backups` directory at `/app/backups`.
- In-app backups and pre-restore snapshots survive backend container rebuilds.
- Backup paths are restricted to `/app/backups` or a subfolder beneath it.
- Unsafe legacy paths are automatically reset to the persistent backup root.
- A Mongo-backed lease prevents both Uvicorn workers from running the same backup simultaneously.
- Scheduled backups are deduplicated by Eastern business date while failed runs remain retryable.
- Collection export no longer silently stops at 50,000 documents.
- Backups are written to a temporary file, read back, checksum verified, document-count verified, then atomically published.
- Successful runs save SHA-256, verification status, collection counts, and total document counts.
- The Backup Settings screen displays persistent-path guidance and VERIFIED status.
- Manual validation compares the file to the checksum recorded at creation.
- Full and configuration restores now stop if their emergency pre-restore snapshot cannot be written and verified.
- The internal worker lease is excluded from exported `app_settings` data.

## Deployment behavior

Docker Compose maps:

```text
host ./backups  ->  backend /app/backups
host ./backups  ->  mongo /backups
```

The host-level `backup-now.sh` and the in-app JSON backup can safely share the host backup directory because they use different filenames/subdirectories.

## Validation performed

- All 18 backend Python files compiled.
- All 199 frontend JavaScript/JSX files parsed with Babel.
- 511 API routes inspected; no duplicate method/path definitions.
- 11 dedicated backup-integrity release checks passed.
- `docker compose config` could not be executed in this environment because Docker is not installed.
- A production frontend bundle could not be completed because dependency installation timed out; source parsing passed.
