# Security Hardening — Data-Safe Pass

This pass is intentionally non-destructive. It does not delete, rewrite, or migrate client, dog, booking, payment, credit, register, or settings data.

## Authentication protection

- Added Mongo-backed failed-login throttling shared by all backend workers.
- Added public registration, forgot-password, claim-link, and password-change throttling.
- Rate-limit records store hashes rather than raw email addresses or reset tokens.
- Added a TTL index so rate-limit rows remove themselves automatically.
- Successful normal logins do not consume the failed-login allowance.

## Session safety

- JWTs now carry a backward-compatible token version.
- Legacy users and legacy tokens both resolve to version `0`, so deployment does not log everyone out.
- Password changes and resets increment the account token version and invalidate older sessions.
- Deactivating a client or employee invalidates their existing sessions.
- The password-change endpoint returns a replacement token so the current browser remains signed in safely.

## Temporary passwords

- New employee passwords and admin-created client portal passwords are marked temporary.
- Temporary-password accounts can only access identity and password-change endpoints until the password is replaced.
- Added a first-login password-change screen.
- New and changed passwords require at least 8 characters; existing shorter passwords still continue to log in until voluntarily changed.
- Fixed the employee portal password screen, which previously sent the wrong request shape.

## Default admin safety

- Fresh installs no longer silently create an admin using `admin123`.
- The installer asks for a unique admin password.
- Direct first-run startup refuses a known default password before writing any admin record.
- Existing installations are preserved even if the admin email in Mongo no longer matches `ADMIN_EMAIL` in `.env`.
- Existing admin passwords are never overwritten unless `FORCE_ADMIN_PASSWORD_SYNC=true` is explicitly used.

## Browser and HTML safety

- Removed wildcard CORS from the normal same-origin deployment.
- Explicit split-domain origins remain supported through `CORS_ORIGINS` or `APP_PUBLIC_URL`.
- Added `nosniff`, frame blocking, referrer, permissions, and no-store auth headers.
- Added a dependency-free HTML sanitizer for payment agreements and email previews.
- Existing rich formatting remains supported while scripts, event handlers, unsafe URLs, iframes, forms, SVG/MathML, and executable markup are removed.
- Rich-text paste is converted to plain text before formatting, preventing pasted executable HTML.

## Update data protection

- `update.sh` now runs `backup-now.sh` before `git pull`, build, or container restart.
- If the Mongo + `.env` backup fails, the update stops before changing code or containers.
- The backup archive remains outside the project folder so replacing the repository does not remove it.
- Emergency bypass is possible only by explicitly setting `SKIP_PREUPDATE_BACKUP=1`.

## Production health visibility

The production-health report now verifies:

- The active admin is not using a known default password.
- CORS is same-origin or restricted to explicit origins.
- Login/reset throttling is enabled.

## Validation performed

- Parsed all backend Python files.
- Parsed all frontend JavaScript/JSX files.
- Checked 514 unique API routes with no duplicates.
- Parsed `docker-compose.yml`.
- Checked shell syntax for installer and updater.
- Ran `scripts/security_integrity_check.py` successfully.
- Verified the output ZIP integrity.

## Deployment behavior

No database migration is required. Existing records and existing login passwords remain unchanged. The first normal update using `./update.sh` will create a full Mongo + `.env` backup before rebuilding.

A live Docker/Mongo smoke test should still be run on the Bazzite server after deployment.
