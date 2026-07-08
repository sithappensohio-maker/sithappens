# Register Cash Drawer Audit

Completed a register-first audit of every money path that can affect the physical cash drawer.

## Fixed

- Service payments now enter the register on the **America/New_York business date when payment was collected**, rather than only on the booking's service date.
- Cash paid today for a future appointment now increases today's expected drawer.
- Partial booking payments are read from payment-ledger events and are not double-counted against the booking row.
- Legacy completed bookings without modern payment timestamps still use the old service-date fallback so historical income does not disappear.
- Mixed **credits + cash** checkouts now save the cash portion separately with its real tender method.
  - Credit redemption remains non-cash.
  - Cash add-ons, overages, tips, and uncovered extra boarding charges increase the cash drawer when paid in cash.
- Checkout now shows and submits the payment-method selector whenever any cash is due alongside credits.

## Verified money paths

- Manual register sales
- Booking/service payments
- Partial booking payments
- Credit-pack sales
- Training-program sales
- Client tab payments
- Payment-plan installments
- Cash refunds
- Cash drawer business expenses
- Till additions and removals
- Mixed credit/cash checkouts

## Drawer formula

`Expected cash = opening cash + net cash payments - cash drawer expenses + till additions - till removals`

Cash refunds are negative cash payments. Credit redemptions do not enter the drawer unless a separate cash portion was collected.

## Regression coverage

Added tests for:

1. A manual cash sale increasing cash-in and expected drawer cash.
2. A future service paid in cash today entering today's drawer, not the future service date.
3. A credit checkout with a cash add-on increasing only the cash portion of the drawer.
4. Till additions and owner draws changing drawer reconciliation without changing income or expenses.
