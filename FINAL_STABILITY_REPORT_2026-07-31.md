# Final Stability Report — Sit Happens Backend/Frontend

**Date:** 2026-07-31
**Scope:** Booking-cancellation incident recovery confirmation, background database-write reliability fix, Shop-management cleanup (safe deletion/archiving + grandfathered pricing), and Shopify merchandise linking.

---

## 1. Booking-Cancellation Incident Recovery

**Status: Confirmed complete and clean.** (Full detail: `backend/incident_reports/2026-07-30_booking_cancellation/FINAL_RECOVERY_REPORT.md`)

- **Recovery completed:** Yes. A targeted, document-level recovery (not a full collection restore) replaced exactly the 1,149 incident-affected booking documents in the live database with their verified pre-incident versions, matched by stable `id`, via `replace_one(upsert=False)` — never able to create a new document, only repair an existing one.
- **Affected bookings restored:** Of the 1,149 touched bookings, 187 had actually been wrongly flipped from `approved` → `cancelled` by the incident; those 187 are now back to `approved`. The other 962 were already legitimately `cancelled` and only differed in a stale `cancelled_at` timestamp, which was also corrected to the original value. Post-recovery validation compared all 1,149 repaired documents field-for-field against the backup: **0 mismatches**.
- **Production untouched:** Only the `bookings` collection was touched. An independent document-count check across `users`, `settings`, `shop_categories`, `pos_products`, `credit_lots`, `payments`, `payment_ledger`, `invoices`, and `audit_log` showed identical counts before and after. A full-collection diff (all 7,445 bookings) confirmed zero documents outside the preserved 1,149-ID list changed at all — no collateral edits.
- **Evidence and audit history preserved:** The damaged-state backup, the incident's affected-ID list, and its 3,000-entry audit trail were never modified by either the incident response or the recovery — the `audit_log` collection's document count is identical before and after this recovery. All incident artifacts remain in the `incident_reports/` folder.

This session independently re-verified these numbers against the recovery-source database rather than trusting the written report at face value; the re-check matched exactly (0 mismatches, 187/962 split confirmed).

---

## 2. Background Database-Write Reliability Fix

**Root cause:** Under this environment's Motor 3.3.1 / Python 3.12 combination, `db.<collection>.insert_one(...)` (and other write calls) return an already-scheduled `asyncio.Future`, not a plain coroutine — confirmed via isolated repro (`asyncio.iscoroutine()` False, `asyncio.isfuture()` True). The existing `_spawn_background_db_write` helper called `asyncio.create_task()`, which only accepts coroutines, so every background write raised `TypeError: a coroutine was expected, got <Future ...>`.

**Central fix implemented:** `_spawn_background_db_write` (`backend/server.py:36380`) now uses `asyncio.ensure_future()` instead of `asyncio.create_task()` — this accepts both plain coroutines and already-scheduled Futures without double-wrapping or creating an un-awaited coroutine. One fix, one call site; no other caller in the codebase needed touching (every other `asyncio.create_task(...)` site wraps a genuine local `async def` coroutine, never a Motor return value, so none of those were at risk).

- The returned task is tracked in a module-level `_BACKGROUND_DB_TASKS` set.
- A done-callback awaits `.result()` inside try/except: a failure is logged via `logger.exception(...)` and never re-raised, and `asyncio.CancelledError` is swallowed — this is what prevents Python's own "Task exception was never retrieved" warning while still surfacing failures in logs.
- App shutdown (`backend/server.py:20732`) now drains `_BACKGROUND_DB_TASKS` via `asyncio.wait(..., timeout=5.0)` before closing the Mongo client, logging a warning (and cancelling) anything still pending past the timeout — so a fast shutdown can no longer silently drop an in-flight background write.

**Audit-log behavior:** The one existing caller of `_spawn_background_db_write` — the audit-log middleware — now completes its background insert successfully. A failed audit write is logged and does not roll back or block the triggering request, matching the "best-effort, never fire-and-forget-silently" requirement.

**Shop/receipt outbox behavior:** Shop checkout and receipt-email outbox creation do **not** go through `_spawn_background_db_write` — they were already synchronous/awaited required writes, and remain that way; this fix did not change their durability semantics. Separately, a real (unrelated) bug was found and fixed here: the shop-order admin-notification path had `except Exception: pass` silently swallowing all failures — changed to `logger.exception(...)` so failures are visible. The apparent outbox failures seen early in testing were traced to a genuinely pre-existing environment gap (`ADMIN_NOTIFICATION_EMAIL` unset in this environment's `.env`), not the Future/coroutine bug — fixed by setting the variable and adding a warning log for future visibility.

**Idempotency and duplicate protection:** Unchanged by design — the fix only altered how a background task is scheduled and awaited, never touching transaction, payment, fulfillment, or idempotency-key logic anywhere in the checkout/webhook/outbox paths.

**Focused test results:** `test_background_write_reliability.py` — **6/6 passed**, proving: a real Motor Future is accepted without the TypeError and its write lands; a plain coroutine is still accepted; a failed background write is logged, not raised; no unhandled-task-exception warnings occur; the shutdown drain logic waits for pending writes; and the audit-log write itself survives the fix.

A broader regression pass taken after this fix (180 existing tests across booking/credit/payment/audit/permission suites) came back **180 passed, 2 failed** — both failures (`test_front_desk_cannot_edit_email_template`, `test_front_desk_cannot_create_announcement`) are pre-existing permission-check edge cases unrelated to Shop, receipts, audit, or payments, giving high confidence this fix introduced zero regressions.

---

## 3. Shop-Management Improvements

**Archive, restore, safe delete, and duplicate:**
- `DELETE /pos/products/{id}` now checks `_pos_product_has_history()` (Shop orders, POS sales, inventory movements) — a product with zero references is permanently deleted; a referenced one gets a 409 directing the admin to archive instead.
- `POST /pos/products/{id}/archive` snapshots the product's prior `active`/`show_online` state, then hides it from POS/register/client Shop without touching stock, order history, or reservations.
- `POST /pos/products/{id}/restore` reverses this exactly from the snapshot — never guesses, never alters `stock_on_hand`.
- `POST /pos/products/{id}/duplicate` (new) copies a listing into a fresh row with its own id, zero stock/history, and `show_online: false` by default so an admin reviews before it goes live.

**Historical-order protection:** Order lines, receipts, and reports snapshot the product name/price at the moment of sale and are never rewritten by a later archive, restore, or price-rule edit — verified by dedicated tests (archived/referenced products keep their original order/receipt data intact).

**Individual client pricing:** Extended the existing `price_overrides` mechanism to accept `target_kind: "pos_product"` (previously service/credit_pack only), plus an optional `starts_on` date alongside the existing `expires_on`. Attached by stable product ID, never name, so a rename never breaks an override.

**Grandfathered pricing tiers:** New lightweight `pricing_tiers` + `pricing_tier_prices` collections let an admin group clients (e.g. "Grandfathered Clients") and set one fixed price per item per tier. A client holds at most one tier at a time (by design, matching the "no client should be in two tiers" requirement) and is never auto-assigned — only an explicit admin action moves a client into a tier. Tiers are deactivated, never hard-deleted, so historical orders keep an accurate tier-name snapshot.

**Server-side price resolution and precedence:** `resolve_client_price()` is the single resolver used everywhere pricing is decided — Shop cart, checkout, `GET /shop/catalog`, and credit-pack/service pricing all call the same function. Precedence is: (1) active individual override, (2) active tier price (only if the tier itself is active), (3) standard list price. A browser-submitted price is never trusted — the cart and checkout always re-resolve server-side.

**Checkout and receipt price snapshots:** Every order line freezes `list_unit_price`, `pricing_source`, `price_override_id`, `has_price_override`, `pricing_tier_id`, and `pricing_tier_name` at the moment of purchase — later edits to an override or tier price never alter a previously completed order, receipt, or report.

---

## 4. Shopify Merchandise Linking

**Internal versus Shopify External behavior:** A new `sales_destination` field (`internal` | `shopify_external`, defaulting to `internal`) marks a product as either using the Sit Happens cart/checkout or as a display-only link to a Shopify product page. All pre-existing products remained `internal` with no behavior change (verified by test).

**URL validation:** Only a well-formed `https://` URL is accepted for `shopify_product_url` — `javascript:`, `data:`, plain `http:`, `ftp:`, and scheme-less strings are all rejected with a 400, both when creating and editing a listing.

**Admin fields and controls:** `ManageProductsPanel.jsx` gained a Sales Destination toggle that hides internal-only fields (register group, cost, starting stock, track-inventory, low-stock warning) and reveals Shopify-only fields (URL, optional displayed price, "From price" toggle, an admin note that the Shopify price may vary by variant) when External is selected. A generic `featured` flag and Duplicate/Archive/Restore/Delete actions apply to both destinations. Shop Organization labels these rows "Shopify Merchandise" distinctly from ordinary products.

**Client Shop behavior:** A Shopify-linked item appears in the same categories/subcategories/search as internal items, showing a "Fulfilled by Shopify" badge, an optional "From $X" price, and a "View Options" button — never "Add to Cart". Verified live in-browser: clicking opens the configured Shopify URL in a new tab on desktop, and navigates same-tab on mobile (confirmed via `window.matchMedia`), with the destination clear before the client leaves the Portal.

**Internal-cart guardrails:** A Shopify-linked product can never enter the Sit Happens cart or checkout — `_price_shop_cart` rejects it with a 400 at the single choke point every cart/checkout path goes through, so no internal order, invoice, payment, receipt, inventory deduction, credit grant, or fulfillment record can ever be created for one. Client-specific and tier pricing are also rejected for Shopify-linked products at the API level (not just hidden in the UI), since Shopify alone controls that price.

**Click tracking:** `POST /shop/merch-click` records a lightweight, nonfinancial event (product id, client id if authenticated, timestamp, and a destination domain derived from the product's own stored URL — never trusted from the request). No Shopify checkout or payment detail is ever collected, and a click is never represented as an order or revenue.

---

## 5. Final Verification

- **Regression (Shop/pricing/checkout/category suites):** `test_shop_management.py` + `test_price_overrides.py` + `test_shop_checkout.py` + `test_client_shop_catalog.py` + `test_shop_categories.py` — **168 passed, 0 failed**.
- **Shop-management feature tests:** `test_shop_management.py` — **19/19 passed** (safe deletion/archiving, individual + tier pricing precedence, cart/checkout re-resolution, snapshot integrity, rename/edit safety).
- **Shopify-merch feature tests:** `test_shopify_merch.py` — **17/17 passed**, covering all 12 required scenarios (mobile/desktop navigation was additionally confirmed by live browser verification, since it's a client-side branch with no server behavior to assert).
- **Background-write reliability tests:** `test_background_write_reliability.py` — **6/6 passed**; broader regression taken after that fix — **180 passed, 2 failed** (both pre-existing and unrelated, detailed in Section 2).
- **Frontend production build:** Clean — `npm run build` compiles successfully. (Running with `CI=true`, which promotes ESLint warnings to hard errors, fails — but that happens on the pre-existing `main` branch too, from `react-hooks/exhaustive-deps` warnings scattered across dozens of files never touched by this work; none of the files changed in this session introduced a new warning.)

**Genuinely remaining known issues:**
1. **Test-database seed documentation** — the earlier request for a "clear reusable setup command or fixture documentation" for a deterministic test-DB seed process was not produced this session. The tests still rely on the established but undocumented convention (a live local backend at `localhost:8001`, a fresh `AsyncIOMotorClient` per direct-Mongo test, JWT-minted test accounts). This remains open and would need a dedicated pass.
2. **`test_group_rollback_when_any_dog_fails`** and 3 client-portal-plan tests fail for pre-existing, unrelated reasons (validation-order and a `must_change_password` gate on freshly-created test accounts) — not introduced by any work in this report.
3. No Shopify API integration exists (by design — this is a display-only link), so there is nothing to keep in sync if a linked product is renamed or removed on the Shopify side; an admin is responsible for keeping the URL current.

No further code changes were made after this report, and no additional full regression was run, per instruction. The application is left in its current verified state.
