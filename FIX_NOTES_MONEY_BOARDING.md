# Money / Boarding Fix Notes

This patch cleans up the problems where boarding dates, booking cost, payment status, and profit reporting were mixed together.

## What changed

### Boarding date math
- Added explicit `presence_dates()` behavior for kennel board / run sheet / capacity.
- Added explicit `billable_boarding_nights()` behavior for pricing.
- Billing now treats pickup date as exclusive:
  - July 1 → July 2 = 1 billable night
  - July 1 → July 4 = 3 billable nights
- New boarding bookings still reject zero-night stays.
- Boarding capacity is checked against every presence date in the stay, not only the drop-off date.

### Booking pricing fields
- Kept the old `cost` field only as legacy daycare-credit cost.
- Added clearer booking fields:
  - `credit_units_required`
  - `estimated_price`
  - `actual_price`
  - `amount_paid`
  - `balance_due`
  - `cash_revenue`
- New bookings now store a backend-calculated `estimated_price` so boarding is no longer created with money showing as zero.

### Checkout / payments
- Checkout now finalizes money fields separately:
  - `actual_price` = what the visit was charged/worth
  - `amount_paid` = what was collected
  - `balance_due` = what is still owed
  - `cash_revenue` = what should hit profit/cash reports
- Partial payments now keep cash received separate from the remaining balance.
- Credit redemptions no longer count as cash revenue unless actual extra cash was collected on top.

### Profit / income reporting
- Quarterly tax service income now uses cash-basis revenue instead of blindly summing `actual_price`.
- P&L report helper now uses cash-basis revenue for paid / partial / unpaid bookings.
- Income transaction API now returns `cash_revenue` and `balance_due` for each row.
- Income screen grouped totals and footer totals now use cash received, not the full charged/owed price.
- Income screen still shows the charged price, but adds a small cash/due line under it.

### Portal estimate
- The booking estimate component no longer picks the cheapest active service automatically.
- It uses the configured default service first, then falls back to the first active service.

## Checks run

- `python -m compileall -q backend` passed.

## Not fully run here

The full live pytest suite and React production build were not run in this container because they require the app services/dependencies to be running like your normal Emergent/Bazzite setup.
