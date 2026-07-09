# Register Closeout & Rollover Guard

## What changed

- Actual cash counted is required before a day can be closed.
- Closeout now has a review-and-confirm step showing expected cash, counted cash, over/short, and the amount that will open the next business day.
- A **Use expected amount** action can fill the physical count, but it still requires confirmation.
- The next day suggests and defaults to the previous active closeout's counted cash.
- Changing that suggested opening balance requires a reason and records the override.
- A closed register day rejects new register money activity until an authorized user explicitly reopens it with a reason.
- Reopened closeouts remain in register reports and CSV exports with operator, timestamp, and reason.
- Legacy blank cash counts display as **Not entered** instead of `$0.00`.

## Drawer behavior

The rollover is based on the physically counted cash, not the expected amount. This prevents an expected balance from hiding a shortage, overage, or missed cash movement.

## Validation completed

- Backend Python compilation passed.
- Register closeout guard audit passed.
- Mobile viewport and modal scrolling audit passed.
- 199 frontend JavaScript/JSX files parsed with zero syntax errors.

A live API integration run and full production frontend build were not completed in this environment because the running database/backend services and installed frontend dependency tree were unavailable.
