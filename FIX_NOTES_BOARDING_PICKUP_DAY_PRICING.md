# Boarding Pickup-Day Pricing Fix

## Issue
Boarding reservations could underquote Friday morning → Sunday evening multi-dog stays because the pricing logic was not consistently applying the pickup-day boarding charge to every dog in the household group.

Example expected Sit Happens rule:
- Boarding base rate: $50 per night / billable boarding day for the first dog
- Additional dog: 50% of the same unit price ($25)
- Pickup before 5:00 PM: add a half boarding day for each dog
- Pickup at or after 5:00 PM: add a full boarding day for each dog
- Bath: $20
- Nail trim: $10

For Friday morning → Sunday evening with 2 dogs, 1 bath, and 1 nail trim:
- First dog: 3 × $50 = $150
- Second dog: 3 × $25 = $75
- Add-ons: $20 + $10 = $30
- Correct total: $255

## Fix
- Added/standardized backend boarding helpers:
  - `_billable_boarding_nights()` for overnight count only.
  - `_boarding_pickup_day_units()` for before/after 5 PM pickup day rule.
  - `_billable_boarding_units()` for total billable boarding units.
- Updated `/api/pricing/quote` to include pickup day units, multi-dog discount, add-ons, credits, and cash due from the same source-of-truth calculation.
- Updated booking creation and group booking pricing snapshots so each dog row stores the correct billable units and the second dog keeps the 50% discount on pickup day too.
- Updated checkout fallback/correction logic so old boarding bookings that were missing pickup-day pricing are corrected at checkout using the stored unit rate.
- Updated checkout display so pre-attached add-ons are included in the displayed charged-today total.

## Regression Coverage
Added API-level coverage for the exact case:
Friday → Sunday, pickup after 5 PM, 2 dogs, bath, nail trim = $255.

Also verified helper math locally:
- Friday → Sunday, 4:30 PM pickup = 2.5 units
- Friday → Sunday, 5:00 PM pickup = 3.0 units
- Friday → Sunday, 6:00 PM pickup = 3.0 units
