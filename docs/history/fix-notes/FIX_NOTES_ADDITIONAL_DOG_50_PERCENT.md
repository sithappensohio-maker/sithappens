# Additional Dog 50% Discount Fix

This patch makes the Sit Happens additional-dog pricing rule explicit and visible:

- Daycare and boarding default to **50% off the base service price** for every dog after the first dog.
- First dog pays the normal base rate.
- Additional dog discount applies to the **base service price only**.
- Add-ons stay full price.
- Client booking estimates show the extra dog charge and the discount line.
- Admin booking estimates show the same discount line before creating the booking.
- Backend `/api/pricing/quote` now supports `dog_count` and returns multi-dog discount metadata.
- Checkout discount calculation now avoids discounting add-ons.
- Settings defaults now line up with the Sit Happens rule: daycare and boarding additional dogs default to 50% off.

Example:

- Daycare base rate: $50
- 2 dogs: first dog $50, second dog base $50, discount $25
- Estimated total before add-ons: $75

No destructive database change is included. Existing clients, dogs, credits, bookings, and payment records are preserved.
