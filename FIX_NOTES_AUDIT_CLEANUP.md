# Audit cleanup patch

This patch came from a production-style audit after the app appeared to be working well.

## Fixed

### Checkout now trusts the saved booking price snapshot
Before this cleanup, checkout could still fall back to the current service catalog price instead of the booking's saved `estimated_price` / `pricing_snapshot`.

That mattered for:
- grandfathered clients,
- bookings created before a price change,
- multi-dog group bookings where additional-dog rows already had the 50% discount applied.

Checkout now prefers the booking snapshot unless the admin manually types a price override.

### Half-credit balances are preserved in manual adjustments
Manual credit adjustment previously used `int(...)` in a few places. A client with `8.5` credits could accidentally be treated as `8` during adjustment/audit display.

Daycare and boarding manual credit adjustments now support `.5` steps.

### Dashboard credit balances no longer truncate decimals
Dashboard roster credit payload now returns decimal balances instead of integer-truncated balances.

### Boarding extra-night credits respect additional-dog half credits
If a multi-dog boarding row represents an additional dog, extra nights now use `0.5` boarding credit per extra night instead of forcing a full credit/night.

### Checkout modal shows snapshot-based totals
The checkout modal now previews the saved booking base estimate first, so admin-facing checkout matches the booking estimate for grandfathered and additional-dog rows.

## Not changed

- No client/dog/booking/credit data is rewritten.
- No destructive migration.
- No Mongo volume changes.
- Credit packs are still sold as whole packs; only usage can spend half credits.
