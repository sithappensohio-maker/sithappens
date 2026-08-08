# Read-only Credit Reconciliation Report

## Purpose

Adds an admin-only **Credit Audit** screen that compares each client's displayed credit balances with the records that support those balances.

This feature is deliberately read-only. It does not update clients, credit lots, adjustments, bookings, payments, or financial history.

## Sources compared

For each daycare, training, and boarding credit pool, the report shows:

- Displayed balance stored on the client record
- Remaining quantity across purchased credit lots
- Net manual credit adjustments
- Tracked total (`remaining lots + manual adjustment net`)
- Variance (`displayed balance - tracked total`)

## Flags

- **Matched**: displayed and tracked totals agree within one cent/credit tolerance.
- **Review**: totals differ. This may be a real mismatch or a legacy/imported balance from before lot tracking existed.
- **Needs attention**: negative balances, negative lots, lots exceeding their original quantity, or unknown service types.
- Orphan lot/adjustment groups are shown when their client ID no longer exists.

Archived clients are not falsely classified as orphaned when the normal report hides archived records.

## Detail view

The history button opens a read-only view of:

- Credit lots
- Manual credit adjustments
- Bookings that consumed credits

## Export

The screen can export the current reconciliation data to CSV in the browser. Exporting does not change server data.

## API endpoints

- `GET /api/admin/credits/reconciliation`
- `GET /api/admin/credits/reconciliation/{client_id}`

Both require admin access and perform no writes.

## Validation completed

- 161 backend Python files parsed successfully
- 203 frontend JavaScript/JSX files parsed successfully
- 516 API routes checked with no duplicates
- Read-only reconciliation calculation checks passed for matching, legacy variance, and structural-error cases
- Authentication runtime hotfix remains present (`asyncio.ensure_future` for Motor futures)
- ZIP integrity checked

## Important interpretation

A variance is not automatically proof that credits are wrong. Older or imported balances may pre-date credit-lot tracking. The report intentionally provides evidence without applying an automatic repair.
