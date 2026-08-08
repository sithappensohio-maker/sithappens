# Register Phase 3 — Reporting, Tax, Exports, and Reconciliation

Safe upgrade. No destructive database migrations. Existing clients, dogs, credits, bookings, retail sales, expenses, and closeouts are preserved.

## Added

- Register range summary endpoint: `GET /api/admin/register/range`
- Closeout history endpoint: `GET /api/admin/register/closeouts`
- Register CSV exports: `GET /api/admin/register/export.csv`
  - `kind=activity`
  - `kind=payment-methods`
  - `kind=closeouts`
  - `kind=expenses`
  - `kind=tax-summary`
- Register reports tab in the Register screen.
- Closeout history list in Register reports.
- Register sanity warnings:
  - money activity without saved closeout
  - closeout method differences over $5
  - negative sales not marked as refunds
  - refund rows missing a reason/description
  - paid bookings missing payment method
  - booking marked paid but still showing balance due
- Money Audit now includes register-first totals and register warnings.
- Quarterly Tax response now includes register-basis method totals for visibility.

## Important accounting behavior

- Credit pack sales count as cash income when sold.
- Credit redemptions are tracked as operational usage and are not counted again as new cash income.
- Register exports use the same sources as the dashboard/register view.
- Completed bookings are read from both active bookings and archived bookings where supported.
- Sales tax remains separated from Schedule C income estimate.

## Safety

- No collection deletes.
- No client/dog/credit rewrites.
- No forced migration.
- Existing legacy screens still work.
- CSV exports require admin export/finance permissions.
