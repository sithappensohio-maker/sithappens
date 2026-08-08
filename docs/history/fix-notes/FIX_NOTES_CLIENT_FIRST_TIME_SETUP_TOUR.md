# Client First-Time Setup + App Tour

## Goal
Make the existing client setup gate easier for normal clients to understand without changing booking, payment, dog, credit, or client data rules.

## Changes
- Upgraded the client portal setup checklist into a guided first-time setup flow.
- Adds a large "Next Step" panel so clients know exactly what to click next.
- Keeps the full checklist below for context.
- Adds plain-English explanations for owner info, dog profile, emergency contact, vaccines, waiver, and assigned forms.
- Pending vaccine review now says "Waiting Review" instead of looking like the client needs to keep uploading records.
- Adds a "Need Help?" message button when client messaging is enabled.
- After setup is complete, shows a one-time app tour explaining what the portal offers:
  - book services
  - view schedule/bookings
  - manage dog info
  - message Sit Happens
  - track credits/balances
  - rewards/trivia when enabled
- Uses a new localStorage dismissal key so existing ready clients can see the improved tour once.

## Safety
- No database migration.
- No hard deletes.
- No payment logic changes.
- No booking enforcement changes.
- The backend setup-status endpoint only received clearer labels/action text.
