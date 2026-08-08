# Configurable Boarding Pickup Cutoff

## Added
- Settings → Booking Rules → Stay-duration pricing now includes **Boarding full-day pickup starts at**.
- Default remains `17:00` (5:00 PM).

## Pricing rule
- Pickup before the configured cutoff: half boarding day.
- Pickup at or after the configured cutoff: full boarding day.
- The same rule applies to the first dog and every additional dog, with the existing 50% additional-dog rate.

## Covered paths
- Client booking estimate
- Admin booking estimate
- Booking creation
- Multi-dog group booking snapshots
- Boarding credit calculation
- Checkout preview
- Final checkout pricing
- Legacy boarding price correction

## Price stability
- New bookings store the cutoff used in `pricing_snapshot.pickup_cutoff_time`.
- Changing the cutoff affects new reservations and estimates.
- Existing reservations keep the cutoff that was active when they were booked.

## Validation
- Python backend files compile successfully.
- All 199 frontend JavaScript/JSX source files parse successfully with Babel.
- Added regression coverage for a changed cutoff (6:00 PM, with 5:30 PM still billed as a half pickup day).
