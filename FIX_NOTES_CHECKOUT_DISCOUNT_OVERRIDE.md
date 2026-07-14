# Checkout Discount Override

## Scope

Adds an optional, reason-required discount during individual or household checkout.

## Integrity rules

- The override changes only the dollar amount due at checkout.
- Existing pricing calculations remain the source of the original total.
- Legacy credits and credit-lot deductions are unchanged.
- A discount cannot reduce the total below the value already covered by credits.
- Pure-credit checkouts cannot receive a cash discount.
- Sales tax is calculated after the discount.
- A fully discounted cash balance is recorded as a comped checkout.
- Household discounts are distributed only across each booking's cash portion.
- The original total, final total, amount, reason, actor, and timestamp are retained on the booking.
- Reopening a checkout clears the prior checkout discount with the rest of the checkout financial state.

## Validation performed

- Backend Python compilation passed.
- Production frontend build passed with only pre-existing project warnings.
- Legacy-only, lot-only, mixed-credit, half-credit, partial-credit, boarding, and household credit paths remain unchanged.
- Cash-only, mixed credit/cash, full comp, household distribution, tax-after-discount, and over-limit rejection scenarios passed.
