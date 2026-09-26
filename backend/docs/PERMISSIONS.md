# Permission model reference

This document is the source of truth for which permission key gates each
admin-facing functional area. Written during the two-part backend
authorization checkpoint (frontend `can()` fix → backend enforcement →
final cleanup of the remaining admin areas). Update it whenever a new
admin endpoint is added or a permission mapping changes.

## Core model

- `role` (top level): `admin` (reaches the AdminShell/staff sidebar),
  `employee` (Staff Portal), `client` (client portal).
- `staff_role` (the permission row for a staff account): `owner`, `manager`,
  `trainer`, `daycare_staff`, `boarding_staff`, `front_desk`, `read_only`.
  `PUT /staff/{id}/role` sets it on `role: employee` accounts only. An
  employee with no `staff_role` resolves to `read_only`.
- **Only staff hold staff permissions.** `_perms_for` returns all-false for
  any account whose `role` is not `admin` or `employee` — clients included,
  whatever the Read-only row says (audit #6, 2026-09-26: clients used to fall
  back to `read_only` *with its overrides*, so ticking Messages for Read-only
  opened every client thread to every client).
- A **true owner** is `role == "admin"` with either no `staff_role` at all
  (legacy implicit owner) or `staff_role == "owner"` — the only account
  type that bypasses the permission matrix entirely. This bypass is
  computed the same way on the frontend (`isOwner()` in `lib/auth.js`) and
  the backend (`_is_owner()` / `_perms_for()` in `server.py`) — they must
  never drift apart.
- Every other `staff_role` resolves its effective permissions from
  `ROLE_PERMISSIONS[staff_role]`, with admin-editable overrides layered on
  top (`_apply_role_overrides`, persisted in `settings.staff_role_permissions`,
  edited via `PUT /staff/roles/{role}/permissions`).
- `GET /me/permissions` is what the frontend reads to build `can()`.
  `GET /staff/roles` is the full matrix (owner-only to view/edit).

## Backend enforcement pattern

Two dependency helpers exist (defined near `require_admin`, ~line 480,
*before* `PERMISSION_KEYS`/`_perms_for` are defined — see the comment on
`require_admin_and_permission` for why the key-validity check lives inside
the inner `_dep`, not the outer factory):

- `require_admin_and_permission(key)` — composes `require_employee_or_admin`
  (broad account-type gate, keeps clients out) with a specific permission
  check. Use this for the vast majority of admin endpoints.
- `require_permission(key)` — the same shape (it also composes
  `require_employee_or_admin`); used by the staff messaging routes.
- `require_owner(user)` — for the handful of actions that must never be
  delegatable via any override: editing the permission matrix itself
  (`GET/PUT /staff/roles*`), reassigning a `staff_role` (`PUT /staff/{id}/role`),
  and exporting/importing raw password hashes.

Two older inline helpers, `_shop_org_perm_ok` / `_require_take_payments`,
had the exact same "any `role == admin` bypasses the check" bug the whole
checkpoint was about — fixed in place, same call sites, same permission
keys as before.

Clients resolve to no permissions at all, so an in-body `_perms_for`
check can no longer be satisfied by a client. Still compose an account-type
gate on new endpoints rather than relying on that alone.

## Permission keys and what they gate

| Key | Owner | Manager | Trainer | Daycare | Boarding | Front Desk | Read-only | Functional area |
|---|---|---|---|---|---|---|---|---|
| `settings` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | App Settings (read+write), email-settings, review-links, auto-backup config |
| `finance_reports` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Transactions, P&L, expenses, retail sales, mileage, quarterly/payroll tax, payment plans, credit-pack sales/adjustments/audit, register reads, Stripe payment ledger |
| `pricing` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Price overrides, credit-pack definitions (create/edit/delete), POS product catalog, POS discount/custom-item lines (checked *inside* the cart-pricing handler, not just the route) |
| `clients_view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Read clients |
| `clients_edit` | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | `POST /clients`, `PUT /clients/{id}` (Phase 4 gap closure — was bare `require_admin` before); **also** intake templates + intake submissions (reused — the frontend already gates one "Intake Forms" screen with this key for both) |
| `dogs_view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Read dogs |
| `dogs_edit` | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | `POST /dogs`, `PUT /dogs/{id}` (Phase 4 gap closure — was bare `require_admin` before) |
| `incidents` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | `POST /incidents`, `PUT /incidents/{id}` (Phase 4 gap closure — was bare `require_admin` before) |
| `care_complete` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | Care Board completion |
| `booking_edit` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | `POST /bookings`, `POST /bookings/group` for staff (Phase 4 gap closure — a client booking their own dog is untouched; that gate only fires for `role == "admin"`). **Staff cancel** — `DELETE /bookings/{id}` for `role` admin *and* employee, checked before the booking's money lock (`guards.require_cancel_rights`); clients keep the own-booking/cutoff rules; any other role is refused |
| `sell_credits` | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | `POST /clients/{id}/sell-pack`, `/sell-packs`, `/sell-program` (Phase 4 gap closure — previously gated by `finance_reports`, which also unlocks P&L/finance dashboards; front_desk needed to sell without that broader access) |
| `payroll` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Employee records (`/admin/employees*`, `/admin/owner`) |
| `data_export` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Backup export/restore-config, disk usage, auto-backup run/history, backup-safety, generic CSV export |
| `delete_records` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Deletes/reversals: transaction/expense/retail-sale delete, POS/payment void, Stripe refund, financial-adjustment/refund, installment reversal, till-adjustment delete |
| `messages` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | One-to-one client message threads (already enforced via `require_permission` before this checkpoint) |
| `take_payments` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | Checkout, POS sale completion, invoice top-up, **cancel with a cancellation charge** (`DELETE /bookings/{id}?forfeit=true`, together with `booking_edit` — the fee lands on the client's tab) |
| `view_shop_categories` / `manage_shop_categories` / `reorder_shop_categories` / `delete_shop_categories` | ✓/✓/✓/✓ | ✓/✓/✓/✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Shop category/subcategory taxonomy |
| `manage_receipt_settings` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Receipt config, preview, test-print |
| `audit_log` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | `GET /audit-log` |
| `manage_communications` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Announcements, bulk email (filters/recipients/send/history/templates), email templates, destructive delete on communications-log/review-request entries |
| `manage_staff_scheduling` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Admin-side `/admin/tasks*`, `/admin/shifts*`, `/admin/shift-templates*`, `/admin/time-off` review, punch-correction decisions, staff readiness. **Not** an individual's own self-service views (`/employee/my-tasks`, `/employee/my-shifts`, own time-off/punch-corrections) — those stay on `require_employee_or_admin` |
| `manage_training_content` | ✓ | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ | Training programs, homework templates, curriculum commands, training tips, trainer scorecard. Trainer gets this by explicit override — building curriculum is a trainer's job. **Not** per-dog operational actions (training-session logging, curriculum score updates, homework day submit/review) — those remain on `require_admin` only, unchanged from before this checkpoint |
| `manage_engagement_content` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Dog-facts/trivia/photography-gallery/trophy-catalog **writes** (create/edit/delete/generate/import/toggle-active). Reads (leaderboard, questions list, recent-winners) and operational actions (milestone redeem, trophy award) are intentionally left open to any staff |
| `manage_shop_media` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | `POST /shop/media`, `DELETE /shop/media/{id}` — deliberately separate from `pricing`/`manage_shop_categories` so it never grants pricing/order/refund access |

## Owner-only, un-delegatable (`require_owner`, not a matrix key)

- `GET /staff/roles`, `PUT /staff/roles/{role}/permissions` — the matrix itself.
  It has no other writer: `PUT /settings` drops `staff_role_permissions`, and
  `POST /backup/restore-config` keeps the live matrix unless the owner runs it
  (a manager holds `data_export` by default and could otherwise restore a file
  granting their own row every key).
- `PUT /staff/{user_id}/role` — staff_role assignment
- `GET /admin/users/export-with-hashes`, `POST /admin/users/import-with-hashes` — raw password hashes
- `POST /backup/restore` — full destructive backup restore

## Deliberately left on broad `require_admin` only (no fine-grained gate)

Lower-stakes, no explicit ask, no existing frontend permission consumer —
would require inventing new keys with no UI to back them:
trivia/dog-facts/trophy **operational** actions (award, redeem), photography
hours settings, service catalog (`/services*`), credit-pack catalog reads,
communications/review-requests **routine** CRUD (create/list/update/resolve
— only their destructive deletes are gated), per-dog training/homework
operational endpoints, `/shop/media` was the one exception fixed this
checkpoint.

## Frontend wiring

- `frontend/src/lib/auth.js` — `can(key)` / `isOwner()`.
- `frontend/src/components/RolesPanel.jsx` — read-only quick-reference
  matrix + role-assignment dropdowns (owner-only fetch/edit; a manager
  sees the employee list read-only, matching the backend's `require_owner`
  gate).
- `frontend/src/screens/Settings.jsx` (`PermissionMatrixPanel`) — the
  actual matrix editor, `PERM_META` array.
- `frontend/src/App.js` — `navItems[].perm` gates the sidebar; `Announcements`
  and `Bulk Email` use `manage_communications`, `Audit Log` uses `audit_log`.

**Known frontend/backend gaps** (documented, not fixed this checkpoint):
Homework/Programs/Pipeline screens mix content-management actions
(`manage_training_content`-gated on the backend now) with per-dog
operational actions (unchanged) in one screen with no nav-level split —
a restricted-but-not-front_desk role could see a "create template" button
the backend will 403. Same for the trivia/dog-facts/photography admin
panels living inside Settings. Splitting these needs a per-button
`can()` audit inside each screen, deferred as a distinct follow-up.

`Clients.jsx`'s per-client-row "Sell Credit Pack" / "Sell Training Program"
menu items (`ClientActionsMenu`) are not gated by `can("sell_credits")` on
the frontend — they're unconditionally shown to anyone who can open a
client card, same as before the Phase 4 gap closure. The backend 403 is the
real enforcement; a role without `sell_credits` sees the option, opens the
modal, and gets a clear rejection on submit rather than a silent no-op.
Adding a frontend gate here would be a small, low-risk follow-up.
