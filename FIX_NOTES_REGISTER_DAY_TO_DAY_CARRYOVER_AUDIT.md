# Register Day-to-Day Carryover Audit

## What was verified

- Closing cash is based on the **actual physical cash counted**, not the expected drawer amount.
- The confirmed counted amount is stored as `rollover_cash` and becomes the suggested/default opening for the next active business day.
- Skipped calendar days are safe: the next opening uses the most recent active closeout with a confirmed rollover.
- Reopened closeouts are excluded from rollover selection. A corrected replacement closeout becomes the new source of truth.
- A stale opening amount without a valid override reason is ignored in favor of the confirmed closeout rollover.
- Legitimate opening changes still require and preserve a reason.

## Additional fixes made

1. **Closeout is now tied to an explicit business date.**
   - The full Register screen could display a historical date but previously submitted a closeout without that date, which could close today's register instead.
   - Both the backend and Register screen now use the selected date consistently.

2. **Midnight stale-tab protection.**
   - The dashboard refreshes the business date immediately before saving a closeout.
   - If the date changed while the tab was left open, the closeout is stopped and refreshed instead of closing the wrong day.

3. **Auditable rollover chain.**
   - Drawer sessions now retain the closeout ID that supplied their suggested opening.
   - Closeout sessions retain the rollover cash and source closeout ID.
   - The register response exposes the rollover source ID for troubleshooting.

4. **Future-day protection.**
   - Opening, closing, or reopening a future register date is rejected.

## Validation completed

- All backend Python files compiled successfully.
- Existing register closeout guard audit passed.
- New rollover-chain audit passed.
- Confirmed the dashboard submits the reviewed date and prevents stale midnight closeout.
- Confirmed the full Register submits its selected date.

A live production smoke test is still recommended after deployment: close the drawer with a distinctive amount, then open the next business day and confirm that exact amount is prefilled.
