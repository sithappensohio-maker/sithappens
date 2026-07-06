# Register / Cash Drawer Phase 1

Safe scope: this patch adds a POS-style register layer without replacing the existing checkout, income, credit, or expense systems.

## Added

- New admin register endpoint: `GET /api/admin/register/day?date=YYYY-MM-DD`
  - Pulls expected payment totals from existing completed booking checkout records and retail/manual sales rows.
  - Separates Cash, Check, Venmo, PayPal, Clover/Credit Card, legacy transfer, and Other.
  - Calculates expected cash drawer: opening cash + cash payments - expenses marked as paid from drawer.

- New drawer opening endpoint: `POST /api/admin/register/open-drawer`
  - Stores daily opening cash in `cash_drawer_sessions`.
  - If no opening cash is set, the register can fall back to the previous closeout's counted cash as a helper default.

- New Staff tab: `Staff → Register`
  - Shows incoming recorded totals.
  - Shows expected cash drawer.
  - Shows payment method breakdown.
  - Lets admin set the opening drawer amount.

- Closing Routine now shows expected register totals and saves separate closeout fields for:
  - Cash counted
  - Clover batch
  - Venmo total
  - PayPal total
  - Check total

- Expenses now support:
  - Vendor/store
  - Tax deductible flag
  - Paid out of cash drawer flag

- Quarterly tax estimator now uses only deductible expenses for tax expense deductions while still preserving total expense tracking.

- Payment method labels/options were cleaned up to match actual business methods:
  - Cash
  - Check
  - Venmo
  - PayPal
  - Clover / Credit Card
  - Other

## Backward compatibility

- Legacy payment methods `card` and `transfer` are still accepted by the backend.
- Existing rows are not rewritten.
- Existing income, expense, booking, credit, and client data are preserved.
- `cash_drawer_sessions` was added to app backup collections.

## Not included yet

This is Phase 1 only. It does not remove the old Income → Log Sale workflow. It does not yet build a full POS sale screen or refund workflow. Those should come next after this runs clean.
