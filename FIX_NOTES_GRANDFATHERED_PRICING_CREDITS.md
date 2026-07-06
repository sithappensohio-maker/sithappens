# Grandfathered pricing + half-credit booking coverage

Safe upgrade. No destructive migrations. Existing clients, dogs, bookings, and credit balances are preserved.

## What changed
- `/pricing/quote` now returns preferred-client-rate metadata when a client has a price override.
- Client booking estimates show “Preferred client rate applied” when a grandfathered service rate is used.
- Admin booking estimates show the same preferred-rate note.
- Daycare/boarding credit math now mirrors the 50% additional-dog cash rule:
  - first dog = 1.0 credit per day/night
  - each additional dog = 0.5 credit per day/night
- Credit packs are still sold as whole credits, but balances can now spend down by 0.5.
- Client booking estimates now show credits used and remaining balance instead of leading with a dollar price when credits fully cover the booking.
- Partial credit coverage is estimated as credits used + cash shortfall.
- Multi-dog group booking rows snapshot the correct per-dog price/credits so checkout does not double-discount extra dogs.
- Checkout can now consume fractional credits from credit lots.

## Important
- Existing whole-number credit balances still work.
- Existing price override UI/endpoints are preserved. Use the client profile Legacy/Special Pricing button to set old rates by service or credit pack.
- No old bookings are recalculated. New bookings snapshot the rate used at creation.
