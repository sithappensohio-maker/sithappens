# Register Till Adjustments

Added a dedicated physical cash adjustment workflow that is separate from sales, refunds, and expenses.

## What changed

- New **Till Adjustment** tab in the Register.
- Supports cash **added to** or **removed from** the till.
- Required reason field and optional notes.
- Adjustment types:
  - Owner draw
  - Change fund
  - Bank deposit
  - Cash count correction
  - Other
- Till adjustments update expected cash drawer math and recent register activity.
- Owner draws and other till movements do **not** inflate revenue or business expenses.
- Register range reports, CSV exports, and the tax packet now include a separate till-adjustment audit file.
- Till adjustments are included in backups and backup-safety collection checks.

## Drawer formula

`Expected cash = opening cash + cash payments - cash business expenses + till additions - till removals`
