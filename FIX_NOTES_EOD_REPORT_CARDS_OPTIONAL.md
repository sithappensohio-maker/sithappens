# End-of-Day Report Cards Optional Hotfix

## What changed

- End-of-day closeout no longer treats missing report cards as a blocker.
- `all_clear` now only depends on hard operational blockers:
  - dogs still on premises
  - unpaid booking balances
- Report cards are still listed as optional follow-up when the non-clear branch is visible, but they do not prevent saving or all-clear status.
- The report-card detector now counts any saved report-card content as present:
  - note
  - photos
  - mood tags
  - created timestamp
- Action Center no longer creates attention items just because optional report cards are missing.
- End-of-day UI copy was updated so the red/orange bottom warning only refers to safety/money blockers, not report cards.

## Why

Report cards are useful, but they are not mandatory for every client. They should not block end-of-day closeout or make the day look unresolved when cash, checkouts, and safety items are handled.

## Data safety

No client, dog, booking, credit, payment, vaccine, message, or report card data is deleted or rewritten.
