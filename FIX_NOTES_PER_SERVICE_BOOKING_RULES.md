# Per-Service Booking Rules

## What changed

Booking rules can now be configured for every active, independently bookable service in the service catalog instead of only broad categories such as Training or Grooming.

The existing category rules remain in place as safe defaults. An exact service inherits its category defaults until an override is saved for that service.

## Exact-service controls

Each active base service now supports its own:

- Client online booking enabled/disabled
- Require approval
- Instant confirmation
- Same-day booking allowed
- Minimum lead time in hours
- Maximum advance-booking window in days

The Settings screen automatically discovers active catalog services, so newly created services appear without adding code. Add-ons are intentionally excluded because they attach to a base reservation rather than being booked by themselves.

## Booking flow changes

- Client and admin booking forms now carry the selected catalog `service_id` through pricing, availability, repeat bookings, multi-date bookings, and group bookings.
- The backend validates that the selected service is active, is not an add-on, and matches the submitted service category.
- A service disabled for client online booking is removed from the client picker and also rejected server-side if someone attempts a direct request.
- Exact-service rules override category defaults; omitted values continue to inherit safely.
- Partial settings updates no longer erase existing exact-service rules.

## Approval behavior corrected

The previous controls displayed Require Approval and Instant Book options, but final booking status still relied mainly on the global auto-approval setting. Booking status now follows the exact service rule first, then the category/global fallback.

## Appointment duration

Time-slot lookup and conflict checking now use the selected service's configured duration. For example, a 30-minute nail service and a 90-minute training session no longer share one generic category duration.

## Backward compatibility

- Existing category-level rules continue to work.
- Existing bookings without a catalog service ID continue to use category defaults.
- The previously completed register focus fix, boarding pickup-day pricing, multi-dog pickup-day pricing, configurable pickup cutoff, grandfathered pricing, and add-on total fixes are preserved.

## Validation

- Python syntax compilation passed for the backend and new regression test file.
- All 199 frontend JavaScript/JSX files parsed successfully.
- The complete frontend entry bundled successfully with esbuild.
- A pre-existing CSS `@import` ordering warning remains and is unrelated to this change.
- Live API/database integration tests require the normal local backend and MongoDB services and were not available in this workspace.
