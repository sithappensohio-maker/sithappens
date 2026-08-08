# Combined Multi-Dog Household Checkout

## What changed

- Daycare and boarding dogs with the same owner and matching visit dates are detected as one household checkout.
- Clicking checkout on either dog opens one modal listing every dog included.
- The modal shows one combined total while retaining each dog's own line item and the 50% additional-dog price.
- One confirmation checks out every included dog.
- The backend locks all included bookings and the client's financial record before changing anything.
- A failure restores all booking, credit-lot, client-balance, and checkout-ledger changes instead of leaving one dog completed and another unfinished.
- A single `checkout_groups` record stores the household total, payment method, dogs, booking IDs, and operator.
- Each dog retains `checkout_group_id`, `checkout_group_total`, and `checkout_group_cash_total` for audit/report linkage.
- Existing add-ons stay attached to their dog. New add-ons selected in the modal apply to the dog whose checkout button was clicked.
- Boarding stay extensions apply to all dogs on the matching household stay.
- Partial/on-tab payments remain separate-checkout only so one combined payment is never incorrectly copied to both dogs.
- Legacy separately entered daycare/boarding bookings are grouped when owner, service, and visit dates match, even if they do not have a historical `group_id`.
- `checkout_groups` is included in standard and critical backups.

## Validation

- `python -m py_compile backend/server.py` passed.
- Frontend production build passed with `CI=false`; only the repository's existing hook/source-map warnings remain.
- Added `backend/tests/test_combined_multi_dog_checkout.py` to lock the one-click/two-dog checkout contract.
