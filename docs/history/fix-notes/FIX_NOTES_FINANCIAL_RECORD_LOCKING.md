# Financial Record Locking and Controlled Corrections

This pass protects paid, partially paid, credited, completed, refunded, comped, and charged-cancellation booking records from silent edits or deletion.

## Server-side financial lock

A booking is treated as financially locked when it has any of the following:

- An explicit `financial_locked` flag
- A checkout timestamp
- Paid, partially paid, refunded, or comped status
- Cash collected
- Credits deducted or a credit value attached
- A non-zero charged-cancellation fee
- A completed service with an actual price

The lock is enforced by the API. Hiding controls in the browser is not the security boundary.

Locked records cannot be silently:

- Deleted
- Cancelled or rejected
- Rescheduled
- Reassigned to another service, dog, or client
- Repriced
- Have add-ons changed
- Have payment, tax, credit, or balance fields overwritten

Care notes, report cards, feeding logs, medication logs, and staff assignments remain editable because they do not rewrite the financial record.

## Controlled correction actions

The Income screen now exposes an **Adjust** action for locked rows in both the normal table and the default grouped-by-date view.

Available actions:

1. **Add charge** — raises the invoice total and client balance.
2. **Discount** — reduces only the unpaid portion.
3. **Write off** — reduces only the unpaid portion while retaining the audit reason.
4. **Refund** — creates a separate negative cash event without rewriting the original checkout.
5. **Reopen checkout** — allowed only when no money, credits, or prior refunds are attached.

Every action requires a reason. Refunds also require the refund method.

## Append-only audit history

Corrections are written to `booking_financial_events` with:

- Booking, client, and dog IDs
- Action type
- Amount
- Reason
- Payment method where applicable
- Before and after financial snapshots
- Acting staff member
- Timestamp

The original checkout remains intact.

## Concurrency and rollback safety

Financial corrections, refunds, reopen actions, checkouts, and cancellations share booking-level and client-level locks across backend workers.

If a correction fails partway through, the code restores:

- The original booking
- Client account balance
- Payment-ledger rows
- Register/refund rows
- Financial audit rows

This prevents duplicate refunds, crossed checkouts, and half-saved adjustments.

## Charged cancellations

A non-zero cancellation fee is now a real locked unpaid invoice rather than a mutable note:

- `actual_price` is set to the cancellation fee
- `payment_status` is `unpaid`
- `balance_due` is set to the fee
- The client account balance is increased
- An append-only ledger charge is created
- A financial audit event is created

The entire operation rolls back if any required write fails. Zero-dollar cancellation tiers remain ordinary cancellations.

## Legacy protection

Old paid/completed records are dynamically recognized as locked even when they predate the explicit lock fields. Existing cash-only legacy rows are refundable based on their saved cash revenue when `amount_paid` was not populated.

## Validation performed

- All backend Python files parsed and compiled.
- All frontend JavaScript/JSX files parsed with Babel.
- 514 API routes checked with no duplicate method/path pairs.
- Static financial-lock regression script passed.
- Income grouped and ungrouped correction entry points were verified.

## Environment limitation

A live MongoDB transaction/concurrency smoke test was not available in this workspace. The production frontend bundle also could not be run because the uploaded project has no lockfile and the partial dependency install did not provide CRACO. Source parsing passed, but deployment should still be followed by a live checkout/refund/adjustment smoke test.
