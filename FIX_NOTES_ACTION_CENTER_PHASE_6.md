# Phase 6 — Action Center / Admin Inbox

Adds a first-class Action Center screen and expands the existing Today's Brain queue into a broader admin inbox.

## Added
- Sidebar item: Action Center.
- Full-screen Action Center with urgent / needs attention / FYI filters.
- Refresh, open, hide, and clear-all controls.
- Uses existing task dismissal logic so hidden items reappear when the underlying state changes.

## New checks added to the action queue
- Pending vaccine certificate uploads awaiting review.
- New client help requests / feedback.
- Open quote requests.
- Referral rewards ready to grant.
- Trivia rewards pending redemption.
- Unpaid booking balances / client tabs.
- Missing closeout for yesterday when register activity exists.
- Stuck check-ins whose scheduled stay already ended.
- Recent completed visits missing report cards.

## Safety
- No destructive data changes.
- No migrations.
- Existing Dashboard Today's Tasks remains in place.
- Existing dashboard vaccine/quote/help panels remain in place as fallback/action surfaces.
