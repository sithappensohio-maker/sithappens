# Money Integrity Pass

This build preserves the earlier register focus fix, configurable boarding pickup cutoff, corrected boarding pickup-day pricing, second-dog pricing, and per-service booking rules.

## Corrected

### Extra boarding nights
- Removed the dead `booking_rules.boarding_rate` fallback that could make uncovered extra nights cost $0.
- Uses, in order:
  1. Staff-entered rate override.
  2. The reservation's saved unit price.
  3. The client's current effective price for the selected boarding service.
- Refuses checkout instead of silently charging $0 when no valid rate can be resolved.
- Additional-dog extensions continue to bill at 0.5 unit per night.

### Checkout safety
- Added an atomic booking checkout lock to block double-click and duplicate-request checkouts.
- Added a per-client financial checkout lock so two dogs from the same household cannot mutate the same credits simultaneously.
- Added stale-lock recovery after 15 minutes.
- Added compensating rollback for failed checkouts. A failure restores:
  - The original booking.
  - Client credit balances.
  - Client account/tab balance.
  - Exact credit-lot quantities.
  - Ledger rows created by the failed operation.
- Partial-payment ledger failure now fails and rolls back checkout instead of leaving the booking and client tab inconsistent.

### Credit lots
- Credit-lot consumption now uses conditional atomic updates.
- Simultaneous checkouts can no longer spend the same remaining lot quantity.
- Each booking records the exact quantity consumed from each lot.
- Cancellation and checkout rollback restore credits to the exact lots used.

### Checkout totals
- Existing booking add-ons remain included in Charged Today.
- Partial credit shortfalls are shown and included before checkout.
- Extra-night credit shortfalls are shown and included.
- Additional cash adjustments are stored separately from the base service price, preventing tips/overages from replacing the service charge.
- Additional cash adjustments are not included in the second-dog discount calculation.

### Seasonal, late-pickup, and tax pricing
- Holiday/peak and late-pickup rules now apply to ordinary saved-price reservations, not just legacy fallback bookings.
- Boarding lateness uses the pickup date rather than the drop-off date.
- Pickup times are interpreted in the business timezone (`America/New_York`).
- A grouped reservation's late fee is charged only on the primary dog row.
- Added a checkout pricing-rule preview endpoint so the screen and saved total use the same rule.
- Sales tax is shown before confirmation.
- Mixed credit-and-cash checkout taxes only the cash portion, avoiding double tax on prepaid credits.

### Closed bookings
- Add-ons cannot be attached after a booking is completed, cancelled, rejected, or checked out.

## Validation performed
- All backend Python files compiled successfully.
- All 199 frontend JavaScript/JSX files passed TypeScript transpile syntax checking.
- 511 API routes were checked; no duplicate method/path pairs were found.
- Boarding pricing assertions passed:
  - Friday to Sunday pickup after cutoff = 3.0 billing units.
  - Friday to Sunday pickup before cutoff = 2.5 billing units.
- Late-pickup timezone assertions passed.
- Exact credit-lot consume/restore assertions passed.

## Environment limitation
A live Mongo/API integration run was not possible in this container because the project's Python runtime dependencies and live database were not available. The included changes should still be smoke-tested on the local Bazzite deployment before production use.
