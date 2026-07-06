# Client First-Time Setup Visible Hotfix

This hotfix makes the client first-time setup changes actually obvious to clients.

## What changed

- Disabled the old vaccine-only onboarding banner/modal so clients no longer see two competing setup systems.
- The main portal setup card is now the single source of truth.
- Updated the setup card language to be more direct:
  - "Start Here · New Client Setup"
  - "Finish These Steps, Then Book"
  - "Do This Next"
  - "Tap Here"
- Added a clear 3-part explanation:
  1. Do next step
  2. Sit Happens reviews vaccines
  3. Book services
- Made the next-step card more visually obvious.
- Bumped the setup-success tour localStorage key so already-tested clients will see the new portal-unlocked tour again.

## Safety

- No database changes.
- No booking rule changes.
- No payment or credit changes.
- No client/dog/booking data rewritten.
- Old onboarding components remain in the file but are disabled; they can be removed in a future cleanup.

## Testing

- Backend Python compile passed.
- Frontend production build not run in this container because node_modules are not present; Docker build on Bazzite is the real test.
