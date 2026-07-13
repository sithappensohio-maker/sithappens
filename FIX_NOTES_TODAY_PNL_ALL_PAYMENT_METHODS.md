# Fix: Today's P&L includes every payment method

## Problem
Today's P&L rebuilt revenue from bookings whose service date was today. The register already used the correct cash-basis rule: income belongs to the business date the money was actually collected.

This mismatch could make Clover/card, Venmo, PayPal, check, tab payments, pack/program sales, or payments collected today for an earlier boarding stay appear in the register but not in Today's P&L.

## Fix
- Today's P&L now uses the register daily incoming total as its revenue source of truth.
- Cash, Clover/card, Venmo, PayPal, checks, legacy transfers, and other tenders reconcile exactly with the register.
- Payments are recognized on the date collected, not merely the booking's service date.
- Pack sales, training-program sales, manual sales, tab payments, and refunds stay included through the same register ledger.
- The expanded dashboard tile now shows revenue by payment method so discrepancies are visible immediately.
- Booking counts and legacy-pricing forecast details remain based on today's schedule and are unchanged.

## Verification
Added `backend/tests/test_today_pnl_register_reconciliation.py`, which asserts:
- Today's P&L revenue equals the register's daily incoming total.
- Every payment-method subtotal matches the register.
