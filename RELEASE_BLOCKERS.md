# Release Blockers

Tracks every legacy backend test failure investigated during the Critical
Backend Repair phase: what fails, why (classified), whether production is
affected, what was done about it, and the current isolated result. Every
row was verified by running that file alone against a freshly reset,
index-correct test database (see `backend/tests/release_critical_reset.py`)
— never against accumulated/shared state.

Classification legend:
- **Production defect** — real code fixed, regression test added.
- **Stale assertion** — test updated to match confirmed-intentional current behavior.
- **Missing fixture** — test's own setup was incomplete (e.g. missing a required field, missing an `override_capacity` flag already used elsewhere in the suite).
- **Undocumented seed dependency** — test assumes a specific pre-existing account/record/external-service credential that only ever existed on a long-lived, manually-onboarded database.
- **Test-order/cross-file pollution** — fails only because many files share one server process/IP in a single run; passes standalone.
- **Platform-specific** — correct behavior on the real deployment target (Linux/Docker), not reproducible off it.

## Mechanical infrastructure fixes (Phase 1)

| Test file | Failing scenario | Classification | Production affected? | Fix / fixture required | Current isolated result |
|---|---|---|---|---|---|
| 14+ files (`test_claim_passwordless_login.py`, `test_iter15/16/17_*.py`, `test_pipeline_multi_enroll.py`, `test_homework_*.py`, `test_meet_greet_request.py`, `test_backend_permission_checkpoint.py`, etc.) | `429 "Too many attempts. Please wait and try again."` at fixture setup | Test-order/cross-file pollution | No — the rate limiter itself is correct and untouched | `backend/tests/conftest.py`: new `_reset_auth_rate_limits` fixture (module-scoped, autouse) clears `db.auth_rate_limits` between files when `MONGO_URL`/`DB_NAME` are set. Never touches `_enforce_rate_limit`'s logic, limits, or windows. | Pending full-suite recount |
| `test_pos_hardware_authorization.py` | `400 "Open the register before taking cash payments."` | Missing fixture | No — register enforcement correctly rejected a test that never opened one | `admin_headers` fixture now detects a `409` (day already closed by another file) and calls `POST /admin/register/reopen-day` before retrying open-drawer | 21/23 passing (was 9/23). Remaining 2 (`test_group_checkout_real_cash_component_yields_drawer_token`, `test_group_receipt_never_invents_tendered_or_change`) fail on `cash_total == 0` — separate issue, likely missing default daycare pricing seed; not yet investigated further |
| `test_staff_portal_p0.py`, `test_care_log_on_booking.py` | `400 "Please select a time for this grooming service."` | Missing fixture | No — grooming is a genuinely time-slotted service; validation is correct | Added `"time": "10:00"` to both files' grooming-booking fixtures, plus `"override_capacity": True` (same-time-slot collision between the two files, same pattern already used elsewhere in the suite) | `test_care_log_on_booking.py`: 5/5 clean. `test_staff_portal_p0.py`: 9/12 (3 remaining failures below, different causes) |
| `test_disk_and_auto_backup.py::test_disk_usage_returns_mountpoints` | `mountpoints: []` | Platform-specific | No — `GET /admin/disk-usage` intentionally probes a curated Linux/Docker path list (`/app`, `/data`, `/proc/mounts`); correctly empty off that platform | Added `@pytest.mark.skipif(sys.platform != "linux", ...)` with an explanatory reason | Skipped on Windows; 2/2 other tests in the file pass |
| ~20 files hardcoding `testclient@sithappens.com`/`test1234` (`test_dog_trivia.py`, `test_multi_date_bookings.py`, `test_homework_*.py`, `test_iter15/16/17_*.py`, etc.) | Login fails outright, or every subsequent call 403s (`must_change_password`) | Undocumented seed dependency | No | `tests/conftest.py`: new `_seed_legacy_named_fixtures` session fixture creates the portal client account through the real `POST /clients` + `POST /clients/{id}/portal-account` endpoints if missing, then completes the real forced-password-change round trip so the final credential genuinely works | Verified via `test_dog_trivia.py`, `test_owner_self_pay.py`, `test_owner_csv_exclusion.py` |
| `test_owner_csv_exclusion.py`, `test_owner_self_pay.py` | `StopIteration` — no employee `alex@sithappens.com` | Undocumented seed dependency | No | Same fixture seeds `alex@sithappens.com` via the real `POST /admin/employees` if missing (never logged in as, so `must_change_password` is irrelevant) | Both files 100% clean |
| `test_dog_trivia.py` (question-generation tests), `test_backup_coverage.py::test_backup_v3_contains_today_data` | `400 "EMERGENT_LLM_KEY not configured"` / `Expected ≥21 trivia questions, got 0` | Undocumented seed dependency | No | Same fixture runs `backend/seed_curated_trivia.py`'s existing idempotent 21-question seed (already in the repo, just never invoked automatically) when DB access is available | `test_dog_trivia.py`, `test_backup_coverage.py`, `test_owner_self_pay.py`, `test_owner_csv_exclusion.py` together: 38/38 clean |

## Full-suite recount

After the mechanical fixes above (rate-limiter isolation, register reopen,
grooming-time fixtures, disk-usage skip, legacy-account seeding), before
any cluster-specific fixes below:

| | Before | After mechanical fixes |
|---|---|---|
| Passed | 975 | 1105 |
| Failed | 232 | 160 |
| Skipped | 64 | 52 |
| Errors | 101 | 55 |
| Duration | 482.59s | 526.44s |

A further recount is pending after the cluster fixes below land.

## Critical-cluster repair (Phase 2)

### Cluster 1 — Authentication and permissions

| Test file | Failing scenario | Classification | Production affected? | Fix | Current isolated result |
|---|---|---|---|---|---|
| `test_permission_matrix.py::test_get_staff_roles_returns_full_matrix` | `assert len(permission_keys) == 14` fails (actual: 27) | Stale assertion | No — 13 additional permission keys (`manage_receipt_settings`, `audit_log`, `sell_credits`, shop-category tiers, training/engagement content, staff scheduling, communications) were deliberately added across this project's own earlier permission-matrix rollout phases | Assert `>= 14` plus presence of representative old+new keys instead of an exact count that needs bumping on every future addition | 6/6 clean |
| `test_roles_permissions.py::test_roles_matrix_endpoint` | Same `== 14` stale count | Stale assertion | No | Same fix pattern | — |
| `test_roles_permissions.py::test_assign_role_and_permission_endpoint` | `/me/permissions` → `KeyError: 'staff_role'` (actually a 403 body — must_change_password gate) | Missing fixture | No | Complete the real forced-password-change round trip before using the employee's token | 3/3 clean |
| `test_backend_permission_checkpoint.py::*` (2 tests) | `429` at fixture setup | Test-order/cross-file pollution | No | Fixed by the shared `_reset_auth_rate_limits` fixture (Phase 1) | — |
| `test_staff_portal_p0.py::test_staff_can_log_incident`, `test_staff_incident_rejects_unknown_dog` | `403 "Missing permission: incidents"` | Missing fixture | No — a freshly created employee correctly defaults to `staff_role="read_only"` (excludes `incidents` by design) | `staff_headers` fixture now calls `PUT /staff/{id}/role` to assign `daycare_staff` before login, matching how a real floor worker would actually be onboarded | 10/10 clean |

### Cluster 2 — Booking creation and approval

| Test file | Failing scenario | Classification | Production affected? | Fix | Current isolated result |
|---|---|---|---|---|---|
| `test_sithappens.py` (5 tests: `test_rabies_expired`, `test_insufficient_credits`, `test_client_create_and_admin_approve`, `test_availability`, `test_portal_me_client`) | `403` on every `client_h`-authenticated call | Missing fixture | No | `portal_user` fixture now completes the real forced-password-change round trip | — |
| `test_sithappens.py::test_client_create_and_admin_approve` | Booking created via portal client comes back `"approved"` not `"pending"` | Stale assertion | No — `catalog_service_booking_rules` (a later phase) makes daycare specifically instant-book by design (`require_approval: False`); every other service type still requires approval | Switched the test's service_type from `daycare` to `boarding` (still correctly demonstrates the pending→approve workflow this test is named for) | — |
| `test_sithappens.py::test_insufficient_credits` | Same instant-book daycare mismatch | Stale assertion | No | Test's real point (per its own comment) is "0-credit client can still book," not the status value — updated the assertion to `"approved"` | 20/20 clean |
| `test_sprint3.py::test_auto_approve_for_clients`, `test_cancellation_cutoff_for_client` | `403` must_change_password | Missing fixture | No | `s3_portal` fixture completes the real forced-password-change round trip | — |
| `test_sprint3.py::test_create_training_booking`, `test_dashboard_training_today` | `400 "Please select a time for this training service."` | Missing fixture | No — training is genuinely time-slotted | Added `"time": "10:00"` | — |
| `test_sprint3.py::test_dashboard_training_today` | `409` time-slot conflict with another file's grooming booking at the same "10:00" slot | Test-order/cross-file pollution (self-inflicted by adding a shared literal time across files) | No | Added `override_capacity: True`, same established pattern used elsewhere | — |
| `test_sprint3.py::test_daycare_capacity_enforced` | `400 "Daycare is closed on that day."` | Stale fixture | No — `business_hours` (a later feature) closes daycare on Sundays by default; the fixed `+15 days` offset happened to land on a Sunday | Walk the target date forward past Sunday instead of using a fixed offset | — |
| `test_sprint3.py::test_daycare_capacity_enforced` | Capacity-full rejection returns `409` not `400` | Stale assertion | No — `_capacity_error` deliberately returns 409 Conflict with a structured `{code, message, display_message, resource, waitlist_allowed}` body; a state conflict, not a malformed request | Updated the assertion to `409` | 18/18 clean |
| `test_sprint3.py::test_auto_approve_for_clients` | `400 "Daycare is closed on that day."` at `+8 days` | Stale fixture | No — same Sunday-default-closed issue | Same walk-forward-past-Sunday fix | — |

### Cluster 2 correction (found during Cluster 3 cross-verification)

While sanity-checking that Cluster 3's fixes didn't disturb Clusters 1/2,
running `test_sithappens.py` and `test_sprint3.py` alone against a truly
fresh reset (not combined with other files) showed both had silently
regressed to failing even in isolation — the previously-recorded "clean"
result no longer reproduced. Root cause and fix:

| Test file | Failing scenario | Classification | Production affected? | Fix | Current isolated result |
|---|---|---|---|---|---|
| `test_sithappens.py::TestBookings` (3 tests: `test_rabies_expired`, `test_insufficient_credits`, `test_client_create_and_admin_approve`), `test_sprint3.py::test_auto_approve_for_clients` | `400 "No active {service_type} service is available for online booking."` | Undocumented seed dependency | No — `_resolve_base_service_for_booking` (server.py ~3360) correctly requires at least one active, non-addon service of the requested type before a CLIENT can book online with no explicit `service_id`; a byte-fresh test DB has zero services | Both files' `admin_h` fixture now calls `POST /services/seed-standard` (idempotent) right after login, same pattern used in `test_multi_dog_discount.py` and `test_catalog_service_booking_rules.py` | `test_sithappens.py`: 20/20 clean. `test_sprint3.py`: 18/18 clean |

### Cluster 3 — Multi-dog pricing and combined checkout

| Test file | Failing scenario | Classification | Production affected? | Fix | Current isolated result |
|---|---|---|---|---|---|
| `test_multi_dog_discount.py` (whole file) | `KeyError: 'actual_price'` on every checkout | Missing fixture | No | `admin_headers` now opens the register day (with 409-reopen-retry), matching the pattern established in `test_pos_hardware_authorization.py` | — |
| `test_multi_dog_discount.py` (whole file) | Still `KeyError: 'actual_price'` after opening the register | Missing fixture | No — checkout correctly rejects an un-arrived dog (`check_out`'s "check the dog in first" guard, added after this test was written) | `two_dog_client` fixture now calls `POST /bookings/{id}/check-in` after approving each booking | — |
| `test_multi_dog_discount.py::test_second_dog_gets_discount_percent` (and the whole `two_dog_client` fixture) | Discount always exactly 50% no matter what the test's own settings say | Stale test premise | No — `_multi_dog_discount_config_for` hardcodes daycare/boarding's additional-dog discount at a fixed 50%, deliberately ignoring settings (a later, documented "Sit Happens fixed business rule") | Switched the fixture's bookings from `daycare` to `grooming`, a non-core service type where the settings-driven discount is still the real, live code path | — |
| `test_multi_dog_discount.py::test_second_dog_gets_discount_percent` | `discount-preview` → `eligible: False` after switching to `training` | Stale test premise | No — Sprint 110ar deliberately never auto-suggests a catalog price for training in the preview ("package-paid") | Switched from `training` to `grooming` instead (no such exclusion); seeded the standard service catalog via `POST /services/seed-standard` so grooming has a resolvable default price on a byte-fresh DB | 9/9 clean (incl. new regression test below) |
| `test_multi_dog_discount.py::test_per_service_discount_config` | Configured impossible daycare/boarding per-service tiers | Stale test premise | No — per-service config for daycare/boarding is structurally unreachable now (see above) | Rewrote to configure grooming (enabled) vs. training (disabled) tiers, matching the fixture's actual service type | — |
| `_multi_dog_discount_config_for` (server.py ~6119) | Non-core service types with a non-empty `multi_dog_discount_by_service` that simply has no entry for the current service type got **no discount at all**, instead of falling back to the legacy flat fields | **Production defect** | **Yes** | Added the missing legacy-flat-config fallback branch (was returning `None` the moment `per_service.get(service_type)` came back falsy, even though the function's own docstring promised to "preserve the older configurable behavior" for non-core services) | Fixed; new regression test `test_legacy_flat_config_still_works_when_service_missing_from_by_service` added and passing |
| `test_combined_multi_dog_checkout.py::test_same_owner_same_service_checks_out_as_one_ticket` | `checkout-group-preview` → `count: 0` | Missing fixture | No — `_active_household_checkout_rows` deliberately requires `checked_in_at` (Front Desk household-checkout fix, task #192): a booked-but-never-arrived dog must never be swept into another dog's combined ticket | Added a `POST /bookings/{id}/check-in` call for each dog after approval | 1/1 clean |
| `test_stay_pricing.py::test_boarding_cutoff_can_be_changed` | `pricing_snapshot` came back `None` entirely from `GET /bookings/{id}` | **Production defect** | **Yes** — `BookingOut` (server.py ~785) never declared a `pricing_snapshot` field, so FastAPI's `response_model` silently stripped it from every booking API response, even though it's written correctly to the database at booking creation. `CheckoutModal.jsx` (lines 155, 333, 335) reads `booking.pricing_snapshot?.unit_price` and `?.group_dog_index` directly off the API response for grandfathered per-booking pricing and additional-dog-row detection in the live checkout UI — both silently always evaluated as unset | Added `pricing_snapshot: Optional[Dict[str, Any]] = None` to `BookingOut` | Fixed; new regression test `test_get_booking_exposes_pricing_snapshot` added and passing |
| `test_stay_pricing.py::_backdate_checkin` (shared test helper) | New regression test above initially hit a `500` — `ResponseValidationError` on `status` | Missing fixture (stale test helper) | No — the real check-in endpoint never changes `status` away from `"approved"`; the helper's own direct-Mongo write of `status: "checked_in"` is a value that has never existed in production and isn't in `BookingOut`'s status enum | Removed the incorrect `status` write from `_backdate_checkin`, leaving only `checked_in_at` | — |
| `test_catalog_service_booking_rules.py::test_exact_service_rules_round_trip_and_partial_category_put_preserves_them` | `StopIteration` — no active, non-addon service exists | Undocumented seed dependency | No | Seeded the standard service catalog via `POST /services/seed-standard` before looking up a base service | 2/2 clean |

Combined Cluster 3 result (4 files run together against one freshly reset DB): **20/20 passing.**

### Cluster 4 — Invoices, partial payments, top-ups, payment plans

| Test file | Failing scenario | Classification | Production affected? | Fix | Current isolated result |
|---|---|---|---|---|---|
| `test_invoice_foundation.py` (most tests) | `400 "Open the register before taking cash payments."` | Missing fixture | No | `admin_headers` fixture now detects a `409` (day already closed by another file) and reopens before retrying, same established pattern | — |
| `test_invoice_foundation.py::test_group_checkout_produces_one_canonical_invoice_with_discount`, `test_multi_dog_discount_line_item_present` | Group checkout with an empty body (no explicit price) silently priced the visit at $0, so no invoice was created — same rule `test_zero_dollar_visit_creates_no_invoice` deliberately exercises | Missing fixture | No — a byte-fresh DB has no services at all, so the default-price fallback correctly found nothing | Seeded the standard catalog via `POST /services/seed-standard` in `admin_headers` | 13/13 clean |
| `test_invoice_topup_payments.py` (majority) | Same `400 "Open the register..."` plus the same $0-default-price gap | Missing fixture | No | Same two fixes: 409-reopen-retry register open (with `opening_cash: 0.0` matching the fresh-DB rollover baseline) + `POST /services/seed-standard` | 35/35 clean |
| `test_partial_payment.py` (majority) | Same `400 "Open the register..."` | Missing fixture | No | Same register-open fix (`opening_cash: 0.0` + 409-reopen-retry) | 16/16 clean (1 pre-existing unrelated skip) |
| `test_payment_plans.py::test_client_sign_activates_plan`, `test_cant_re_sign_active_plan`, `test_mark_paid_updates_status_and_auto_completes`, `test_client_can_only_see_own_plans` | `403 "Temporary password must be changed before continuing."` (the last one surfaced as a confusing `TypeError` because the test blindly indexed the 403 error body as if it were a list of plans) | Missing fixture | No | `fx` fixture now completes the real forced-password-change round trip before returning client headers, same established pattern | 11/11 clean |

Root cause note: every register-open failure in this cluster was actually
TWO overlapping issues — (1) the register day being left closed by another
file in this shared test DB (fixed by detecting `409` and reopening), and
(2) `opening_cash: 100.0` no longer matching a byte-fresh day's $0.00
expected rollover baseline, which 400s asking for an override reason
unless `opening_cash` is 0.0 or a reason is supplied. All four fixtures
now use `opening_cash: 0.0`.

Combined Cluster 4 result (4 files run together against one freshly reset
DB): **75/75 passing** (1 pre-existing skip). Zero production defects —
every failure was a missing fixture already established elsewhere in the
suite.

### Cluster 5 — Stripe online payments and webhook handling

| Test file | Failing scenario | Classification | Production affected? | Fix | Current isolated result |
|---|---|---|---|---|---|
| `test_stripe_online_payments.py` (39 of 45 tests) | `400 "Open the register before taking cash payments."` | Missing fixture | No | `admin_headers` fixture switched to `opening_cash: 0.0` (matching a byte-fresh day's $0.00 rollover baseline) plus the established 409-reopen-retry pattern | 45/45 clean |

Single fix resolved the entire file — no other issues found. Zero
production defects; the extensive webhook idempotency, replay,
concurrent-resume, and refund-reversal logic all held up correctly once
the fixture could actually reach checkout.

## Remaining clusters

Not yet started: shop category/schema compatibility.
