# Business Money / Tax / Health Audit Patch

Safe, non-destructive production-audit upgrade.

## Added

- Admin → Staff → **Money Audit** tab
  - Cash collected vs Schedule C income
  - Sales tax held separately
  - Booking AR / unpaid balances
  - Credit-pack sales, credit redemptions, outstanding credits
  - Ledger sanity checks

- Admin → Settings → Backup & Restore → **Production Health** panel
  - Mongo ping
  - last in-app backup run
  - disk pressure
  - email env vars
  - JWT/admin seed credential warnings
  - core collection counts

- End-of-Day closeout snapshot
  - Saves reviewed end-of-day state into `daily_closeouts`
  - Optional cash/card/Venmo-PayPal totals and notes
  - Does not change bookings or payments

- Booking history endpoint
  - `/api/bookings/{booking_id}/history`
  - Pulls audit rows + ledger rows for a booking

## Money/tax changes

- Quarterly tax estimator now separates sales tax collected from Schedule C income.
- Sales tax collected is still visible as a liability/held amount.
- Cash-basis logic remains:
  - paid booking = amount collected
  - partial booking = amount paid
  - unpaid booking = $0 cash + AR
  - credit redemption = operational usage, not new cash
- Updated 2026 defaults:
  - IRS business mileage rate: $0.725/mile
  - SSA taxable maximum/wage base: $184,500
- Existing installs using the old placeholder defaults are auto-bumped; custom owner-entered values are preserved.

## Data safety

- No clients/dogs/bookings/credits are deleted.
- No credit balances are recalculated.
- No historical bookings are rewritten.
- New collection added to backup list: `daily_closeouts`.

## Still recommended later

- True duplicate-client/dog merge wizard with dry-run preview.
- Bank/POS reconciliation import from Clover/Venmo/PayPal CSV.
- Sales tax filing export by jurisdiction if Sit Happens collects taxable sales.
