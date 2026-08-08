# Admin Booking Estimate Patch

This patch adds a live estimated-price panel to the admin booking modal.

## What changed

- Admin-created bookings now call the backend `/api/pricing/quote` endpoint before saving.
- The estimate updates when admin changes:
  - client/dog
  - service type
  - date or boarding pickup date
  - selected add-ons
  - extra dogs in a group booking
  - multi-date selections
- Boarding estimates use the backend billable-night math, not separate frontend math.
- The panel shows:
  - base estimate
  - add-ons total
  - estimated total
  - relevant client credit balance and credit units needed
- This is read-only and does not create bookings or spend credits.

## Safety

No database migration. No destructive changes. Existing clients, dogs, credits, bookings, vaccines, payments, and backups are untouched.
