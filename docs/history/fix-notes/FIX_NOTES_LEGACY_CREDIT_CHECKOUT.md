# Legacy Credit Checkout Fix

## Problem
Clients whose displayed daycare, boarding, or training credits predated `credit_lots` could check out without their balance being reduced. Checkout consumed only lot-backed credits and silently fell back to money when no lot existed.

## Fix
- Client credit balances remain the source of truth.
- Matching credit lots are consumed first for FIFO/audit tracking.
- Any remaining valid balance is consumed as legacy/manual/reward credit.
- Bookings store `legacy_credits_deducted` separately from lot redemptions.
- Credit deduction now fails closed if the balance changes unexpectedly instead of completing without deduction.
- Mixed lot/legacy redemptions retain the full service value.
- Boarding stay extensions also consume legacy boarding credits.
- Existing pre-deducted legacy bookings are recognized by `credits_deducted`, preventing double deduction.
- Switching from credits to cash and compensating checkout rollback restore both the client balance and exact lot quantities.

## Scope
Only `backend/server.py` checkout credit handling and the Booking response field were changed. No frontend, service pricing, register, P&L, booking creation, or existing credit balances were migrated or altered.

## Isolated validation
Passed:
- Legacy-only daycare credit
- Lot-only daycare credit
- Mixed lot + legacy credit
- Half-credit deduction
- Partial legacy credit + cash remainder
- Boarding legacy credits with pickup-day units
- Additional-dog half credit
- Extra boarding-night legacy credits
- Switch mixed credit checkout to cash and restore
- Failed-checkout compensating rollback
- Compilation of all backend Python files
