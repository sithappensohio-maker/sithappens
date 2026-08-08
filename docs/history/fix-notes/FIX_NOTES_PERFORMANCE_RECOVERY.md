# Performance Recovery Pass

This pass is non-destructive. It does not delete, migrate, rewrite, or recalculate client, dog, booking, register, credit, payment, tax, settings, or backup records.

## Problems found

1. The dashboard starts many authenticated API requests in parallel. Every request separately reloaded the same user document from Mongo.
2. The Clients endpoint performed one portal-user lookup per client, producing an N+1 query pattern.
3. The Clients endpoint loaded the dog collection twice for the same response.
4. Successful write requests waited for the audit-log Mongo insert before returning to the browser.
5. The Dashboard ran its full multi-endpoint refresh every 30 seconds and also ran a second independent P&L refresh every 30 seconds.
6. The Audit Log endpoint accidentally executed its main query twice.
7. Local-network bundle and JSON delivery did not explicitly enable gzip; public images and fonts were not cached.

## Fixes

- Added a five-second, bounded authenticated-user cache per backend worker.
- Added request single-flight so simultaneous requests for the same signed-in user share one Mongo lookup.
- Cache invalidation is immediate after password changes, password resets, account deactivation, and employee password resets.
- Batched portal-user rows for the Clients screen into one query.
- Reused one dog batch for client summaries and setup/compliance badges.
- Added indexes for `users.client_id`, active client name lists, and active dogs by owner.
- Audit rows remain enabled, but their best-effort insert now runs after the response is ready instead of delaying the form save.
- Removed the duplicate Audit Log database query.
- `/auth/me` and `/me/permissions` now start in parallel during app launch.
- Dashboard full refresh changed from every 30 seconds to every 60 seconds.
- Removed the second duplicate 30-second P&L polling loop.
- Hidden P&L, register, and rewards widgets no longer request their optional dashboard data.
- Enabled nginx gzip for JS, CSS, JSON, XML, and SVG.
- Added safe 30-day caching for public images and fonts while keeping the HTML shell uncached.
- Added `Server-Timing` and `X-Response-Time-Ms` headers.
- API requests taking at least one second now log as `SLOW API ...` in backend logs.

## Data and security behavior

- No database migration is required.
- No collection is dropped, cleared, or rewritten.
- Login throttling, token-version checks, account deactivation, financial locks, backup verification, booking capacity locks, and audit logging remain enabled.
- The authenticated-user cache defaults to five seconds and is bounded to 512 users per worker.
- Security-sensitive account changes explicitly invalidate the cache immediately.

## Validation

- All backend Python files compiled and parsed.
- All frontend JavaScript/JSX files parsed with the TypeScript parser.
- nginx configuration syntax passed after substituting the Docker-only `backend` hostname with localhost for the syntax test.
- Dedicated performance-integrity checks passed.
- ZIP integrity was verified.

## Live verification

After deployment, run:

```bash
docker compose logs -f backend | grep --line-buffered "SLOW API"
```

Any remaining endpoint over one second will identify itself in the log so it can be optimized directly rather than guessed at.
