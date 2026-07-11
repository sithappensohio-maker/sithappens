# Register Opening Cash / Rollover Persistence Fix

## Reported symptom

The register opened at $15 every day even after a different closing cash count or opening amount was saved.

## Root causes corrected

1. The dashboard Start Day component kept its React form state while the PWA/browser tab remained open. After the business date changed, yesterday's opening value (commonly $15) could be submitted as today's opening amount.
2. The backend trusted any existing `cash_drawer_sessions.opening_cash` row before the confirmed prior closeout, including legacy/stale rows that had no valid override reason.
3. The full Register screen could remain pointed at the previous date across midnight.

## New behavior

- The prior active closeout's explicit `rollover_cash` is the source of truth; legacy closeouts safely fall back to `cash_counted`.
- A different opening amount is accepted only when the session is marked as an override and contains a meaningful reason.
- A stale/legacy opening amount without a valid reason is automatically ignored for drawer calculations and the confirmed closeout rollover is restored.
- The UI displays a warning when an old stale amount was recovered.
- Start Day always rehydrates from the current server state when loaded or opened.
- Start Day refreshes the business day and rollover immediately before saving, preventing an overnight-stale tab from posting yesterday's amount.
- After closeout, the Start Day form state is cleared instead of being carried into the next day.
- The Register screen advances to the new day when a live tab crosses midnight or regains focus, while intentionally selected historical dates remain unchanged.
- Existing reasoned owner/bank/recount overrides are preserved and remain auditable.

## Regression checks completed

- No session + previous closeout uses the closeout rollover.
- Matching session and rollover remains unchanged.
- Legacy $15 session without an override reason recovers to the confirmed rollover.
- Valid reasoned override remains in effect.
- Invalid/too-short override reason is rejected as stale.
- Explicit `rollover_cash` takes priority over legacy `cash_counted`.
- All backend Python files parse successfully.
- Modified JSX files have balanced parentheses, braces, and brackets.

A live Mongo/API smoke test should still be run after deployment by closing one day with a non-$15 cash count and confirming the following day's opening.
