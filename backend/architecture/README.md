# Backend architecture boundary

Phase 4 freezes `backend/server.py` as the compatibility/application-composition
root. Existing behavior may be fixed there when necessary, but substantial new
backend features and new API routes belong under `backend/domains/`.

The freeze is intentionally one-way:

- routes may be **removed from** `server.py` as they are extracted;
- existing route implementations may be corrected for regressions;
- **new** `@api.*` routes must not be added to `server.py`;
- the file must not grow back into a larger feature container.

`server_route_freeze.json` records the route set that still remained in
`server.py` at the end of Phase 4. The architecture test rejects any new route
not present in that baseline while allowing future extraction to shrink it.

Training and School are the first extracted domains. Their production wiring is
explicit and happens before `app.include_router(api)`. `app_entry.py` only
exports the already-composed application; it no longer patches helpers or
FastAPI route call targets after import.

## Phase 5 financial domains

Bookings, pricing, register, and POS HTTP route ownership now lives under
`backend/domains/`. The proven transaction implementations remain available in `server.py` as a
compatibility layer, but booking creation, booking checkout, and POS sale
entrypoints now pass through stable domain-service seams before invoking those
implementations. Route registration is explicit in the domains. This deliberately separates routing extraction from transaction
rewrites in the highest-risk financial area.

The canonical client-price resolver, price-history lifecycle selection, booking
base-price quote, add-on pricing snapshots, exact booking service selection,
register-open/rollover rules, register catalog, and unified POS cart-pricing
kernel now live in the Booking/Pricing/Register/POS domain service modules. Compatibility helpers in `server.py` delegate to
those services, so Quick Check-In, booking creation, checkout refresh, credit
packs, register catalog, POS preview, and POS checkout continue to share the
same pricing source of truth.

`phase5_financial_route_manifest.json` records the 91 HTTP registrations moved
out of `server.py`. Phase 5 route-parity checks compare the complete API
method/path set before and after extraction; URLs and methods must remain
identical.
