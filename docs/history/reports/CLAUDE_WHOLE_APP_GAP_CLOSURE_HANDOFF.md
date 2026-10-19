# CLAUDE QA HANDOFF — WHOLE-APP OPERATIONAL / PAYMENT RISK CLOSURE

## Branch / commits

Repository candidate was built from the user's latest uploaded ZIP.

- Baseline: `0d804d0` — `baseline latest uploaded app`
- Commit 1: `8d914b6` — `enforce booking safeguards and make settings truthful`
- Commit 2 / HEAD: `8aec113` — `close whole-app operational and payment risk gaps`
- Branch: `whole-app-gap-closure`
- Working tree at handoff: clean

**Do not deploy. Do not touch production MongoDB. Do not make any real Stripe charges/refunds.**
Use only the disposable test DB and mocked Stripe objects/network calls.

## Scope decision

This is a whole-app risk-closure pass, not a redesign.

**SMS / Twilio is deliberately OUT OF SCOPE.** The owner does not want to pay for SMS right now. Do not add it.

The intended work closes these gaps:

1. Day-to-Day settings that looked live but were not actually enforced.
2. Stripe disputes / chargebacks.
3. Online Shop line-aware refunds.
4. Owner/Admin authenticator MFA + recovery codes.
5. Versioned service/program agreements and immutable e-sign snapshots.
6. Stripe processing-fee and payout reconciliation.
7. Marketing-email unsubscribe/suppression (transactional email stays available).
8. Client intake/general document upload using existing `client_files`.
9. Overdue-medication escalation into Action Required.
10. A pre-existing first-open Care Board ID instability discovered while implementing #9.

Do not expand this into unrelated features.

---

# A. SETTINGS TRUTH / BOOKING SAFEGUARDS

Commit `8d914b6` makes the safety-critical controls real and makes unsupported controls visibly unsupported rather than pretending they are active.

Backend behavior to verify:

- `vaccines_per_service` is consumed by booking and check-in logic.
- A non-empty service-specific vaccine list overrides global `required_vaccines`.
- An empty/missing service-specific list falls back to global requirements.
- `block_bookings_if_vaccines_expired` actually controls booking enforcement.
- `block_on_expiry_day` semantics work as configured.
- `vaccine_doc_upload_required` requires an approved document when enabled.
- `auto_decline_if_balance_over` blocks a CLIENT booking when the configured balance threshold is exceeded.
- Staff/admin behavior remains intentional; do not accidentally apply a client-only booking guard where it does not belong.

Frontend:

- Unsupported Day-to-Day controls (e.g. tipping prompt / boarding deposit where runtime behavior still does not exist) must be clearly disabled/marked unsupported.
- Do not silently turn unsupported controls back into apparently-live settings.

### Hostile checks

Try service-specific vaccine overrides, pending vaccine docs, expiry-on-today both ways, and account balances immediately below/equal/above the threshold.

---

# B. AUTHENTICATOR MFA — NO PAID SERVICE

Backend additions:

- encrypted TOTP secret at rest (`mfa_secret_enc`)
- pending setup secret
- 6-digit TOTP verification with small clock drift window
- one-time recovery codes stored only as hashes
- short-lived `mfa_challenge` token
- login with MFA enabled returns the challenge instead of a normal access token
- `/auth/mfa/verify-login`
- `/auth/mfa/status`
- `/auth/mfa/setup`
- `/auth/mfa/enable`
- `/auth/mfa/disable`
- enabling/disabling increments token version and returns a replacement token

Frontend wiring:

- normal Login
- GuestAuthModal
- Settings MFA panel

### Required QA

Test:

1. normal non-MFA login unchanged
2. MFA-enabled password login does NOT issue normal access token before factor 2
3. correct TOTP succeeds
4. incorrect/expired code fails
5. challenge expiration / wrong token type fails
6. recovery code succeeds once and only once
7. recovery codes are not stored plaintext
8. TOTP secret is not stored plaintext
9. disabling requires current password + valid authenticator/recovery code
10. token-version invalidation works after enable and disable
11. inactive account still cannot use MFA challenge to log in
12. existing claim-account / reset / change-password / set-password flows remain green
13. existing employee/client role behavior remains green

Operational note to review/document: MFA encryption derives from `JWT_SECRET`. Rotating `JWT_SECRET` invalidates old access tokens and would also make stored MFA secrets undecryptable. Do not casually redesign this during QA; just flag if you believe a dedicated secret is mandatory before release.

---

# C. VERSIONED SERVICE / PROGRAM AGREEMENTS

New canonical collections:

- `agreement_templates`
- `agreement_signatures`

Behavior:

- scopes: `general`, `service_type`, `program_id`
- required/active flags
- changing title/body/scope meaning increments template version
- old signature remains immutable with exact `template_snapshot`
- current required version must be signed
- client signature captures typed name, version, snapshot, timestamp, IP, user-agent
- unique client/template/version signature invariant
- client can only tag a dog they own

Enforcement:

- applicable client booking requires relevant agreement(s)
- applicable Online School program purchase checks program agreement eligibility
- legacy general waiver remains separate; do not merge/delete it in this release

Frontend:

- Settings → Service & Program Agreements
- service type uses a selector
- training program uses existing programs selector
- client Portal agreement card/modal

### Required QA

- create v1, sign, verify booking/purchase allowed
- edit meaningful content → v2, old v1 signature no longer satisfies v2
- old v1 signed snapshot stays byte-for-byte unchanged
- non-meaningful state toggles should not invent a content version unless current code intentionally treats them as meaning changes
- service scope only blocks matching service
- program scope only blocks matching program
- general scope applies as intended
- cross-client signing/access prohibited
- duplicate sign converges to one signature
- inactive/non-required semantics sane

---

# D. STRIPE DISPUTES / CHARGEBACKS

Webhook routing now handles:

- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

Canonical collection: `stripe_disputes`.

Design:

- link dispute back to canonical positive payment where possible
- open disputes appear in Action Required for finance-authorized staff
- final LOST dispute creates a negative `retail_sales` finance row
- if a previously-lost dispute is later WON, create a positive recovery row
- stable `stripe_dispute_key` prevents duplicate financial adjustments
- do NOT mutate/delete original payment
- do NOT automatically revoke training/credits/history
- tax reversal is deliberately **not guessed** (`tax_amount=0`) because chargeback tax treatment can need evidence/manual review

### Required QA

Replay and out-of-order hostile testing is mandatory:

- created → updated → closed lost
- duplicate lost event 5x
- lost → won
- repeated won event
- unknown payment intent
- dispute with charge requiring mocked `stripe.Charge.retrieve`
- open dispute Action Required visibility and permissions
- original payment/invoice/order remain historically intact
- Finance totals do not double count replayed events

No real Stripe calls.

---

# E. STRIPE PROCESSOR FEES / PAYOUT RECONCILIATION

Webhook additions:

- `charge.succeeded` → retrieve Stripe balance transaction
- `payout.paid`
- `payout.failed`
- `payout.canceled`

Collections:

- `stripe_balance_transactions`
- `stripe_payouts`

Fee behavior:

- Stripe fee creates exactly one Expense
- category: `Merchant fees`
- source: `stripe_processor_fee`
- stable `stripe_balance_transaction_id` prevents duplicate expense
- negative fee adjustment is a negative expense, not fabricated revenue

Endpoint:

- `GET /admin/stripe/reconciliation`

### Required QA

Mock Stripe balance transaction retrieval. Test duplicate events, positive fee, fee reversal, payout status transitions, and payment linkage. Verify existing Finance/P&L semantics remain correct.

---

# F. ONLINE SHOP STRIPE REFUNDS

New endpoint:

`POST /shop-orders/{order_id}/stripe-refund`

Frontend:

- Online Payments identifies Shop orders
- `ShopRefundModal`
- line selection
- product quantity refund
- explicit inventory-restock choice
- entitlement lines all-or-nothing

Important invariants:

### Physical products

- may refund partial quantity
- tax/gross allocated from frozen order-line totals
- final unit absorbs penny remainder so cumulative refund is exactly the immutable line total/tax and never exceeds it
- inventory restock optional
- restock side effect idempotent on retry

### Credit packs / training credits

- whole remaining line only
- every backing credit lot must be verifiably unused
- if any purchased credits have been consumed, automatic refund MUST hard-stop with 409
- never refund cash while silently leaving consumed entitlement mismatch

### Online School program purchase

- refund revokes current access / withdraws active enrollment as appropriate
- history is preserved
- companion School enrollment mirrors canonical state

### External Stripe refund with no Shop line allocation

- do NOT guess which products/credits/programs to reverse
- set `refund_reconciliation_required=True`
- surface Action Required for finance staff

All money still goes through the existing canonical Stripe refund/finalizer mechanism; this must not become a parallel refund ledger.

### Required QA

Test:

- 1/3, 2/3, 3/3 product refund penny exactness
- partial taxable products
- restock yes/no
- webhook/finalizer replay does not double-restock
- whole unused credit pack refund
- consumed credit lot blocks refund
- missing backing lot blocks refund
- program/credit partial line blocked
- Online School refund preserves historical attempt records
- external shop refund → reconciliation Action Required, no guessed fulfillment mutation
- repeated idempotency key same fingerprint converges
- reused idempotency key different request 409
- Stripe failed/pending/succeeded states
- no local fulfillment reversal before Stripe success
- payment/refund/tax/Finance totals reconcile to the immutable order/payment

No real Stripe refund.

---

# G. MARKETING EMAIL UNSUBSCRIBE / SUPPRESSION

Behavior:

- signed long-lived unsubscribe token is appended to bulk/marketing email
- `/email/unsubscribe` marks client `marketing_email_opt_out=True`
- `/portal/marketing-email-preference` supports explicit preference updates
- bulk recipient resolver excludes opted-out clients
- hand-selected bulk recipients exclude opted-out clients
- announcement broadcast excludes opted-out clients

**Transactional/service email must remain available.** Booking/payment/training/required account emails must NOT be globally suppressed by a marketing opt-out.

### Required QA

- all-clients bulk list
- filtered bulk list
- hand-selected clients
- announcement broadcast
- unsubscribe link
- email address changed after old token issued should fail safely
- opt back in through preference endpoint
- transactional email path remains unaffected

---

# H. CLIENT INTAKE / GENERAL DOCUMENT UPLOAD

This reuses existing `client_files`; there is no second file store.

New intake behavior:

- real `file_upload` field in client intake portal
- endpoint:
  `POST /portal/intake/submissions/{submission_id}/files/{field_id}`
- max 10 MB decoded bytes
- allowed client intake types: PDF, images, text, Word/docx
- filename basename sanitization
- strict base64 validation
- uploaded file is tagged with exact client/submission/field and optional dog
- intake answer stores a file reference
- submit validates the file belongs to the exact calling client + exact submission + exact field + expected source
- staff-only intake fields never become client-visible
- reviewer can download via existing ownership-protected `/files/{file_id}/download`

### Required QA

- valid PDF/image/doc upload
- malformed base64
- unsupported MIME
- over 10 MB decoded file
- cross-client submission access 403
- cross-client file id cannot be smuggled into answers
- file from another submission/field rejected
- required file field cannot submit blank
- staff-only field absent from client payload
- admin review/download works
- client can download own file but not another client's file

---

# I. OVERDUE MEDICATION ESCALATION + CARE-ID FIX

Action Required now derives overdue medication alerts from canonical `bookings.care_items`.

No second alert collection exists.

Rules:

- dog must actually be checked in
- checked-out dog never alerts
- pending medication past the existing 30-minute care window alerts
- completing/skipping the same canonical care item removes alert on next refresh
- care-only staff should see medication items only according to permission mapping

### Important pre-existing bug fixed

When a booking had no stored `care_items`, the Care Board used dog defaults to generate UUIDs. Previously those IDs could be displayed without being persisted; Complete/Skip could later reseed new UUIDs and return `Care item not found`.

Now the exact seeded IDs are persisted before the board/alert exposes them. Both missing `care_items` and explicit `care_items: null` are handled.

### Required QA

- first-open booking with dog default medication
- capture item ID shown by Care Board
- Complete that exact ID successfully
- repeat with Skip
- alert appears after grace period
- completing/skipping clears alert
- not-checked-in booking never produces overdue alert
- checked-out booking never produces alert
- explicit `care_items:null` behaves same as absent field
- existing per-stay customized care schedule remains untouched
- no duplicate alert after polling

---

# J. TARGETED TESTS ADDED

Backend:

`backend/test_whole_app_gap_closure.py`

- 20 focused tests spanning settings, MFA, agreements, intake files, medication alerts/ID persistence, Shop refund invariants, disputes, Stripe fees/payouts, and marketing suppression.

Frontend source guards:

`frontend/src/components/wholeAppGapClosure.test.js`

- 6 tests pin MFA wiring, agreements, Shop refund UI, intake file upload, and medication Action Required wiring.

Treat these as new targeted coverage, not substitutes for the full suite.

---

# K. LOCAL VALIDATION ALREADY PERFORMED BY CHATGPT

Passed locally:

- `python -m py_compile backend/server.py backend/email_service.py backend/test_whole_app_gap_closure.py`
- `git diff --check`
- TypeScript AST parse of all 12 changed/new JS/JSX files: **12 files, 0 syntax diagnostics**
- working tree clean after commit

Could NOT be truthfully run in this sandbox:

- backend pytest collection/full suite because Python environment lacks `pymongo`/`motor`
- frontend Jest/build because this extracted ZIP has no `frontend/node_modules`

A pytest collection attempt fails at `_test_env.py` with:

`ModuleNotFoundError: No module named 'pymongo'`

Therefore **do not inherit any green test totals from earlier releases**. You must establish fresh totals on this exact candidate.

---

# L. REQUIRED CLAUDE QA PROCESS

## 1. Establish exact candidate

Confirm:

- branch/HEAD corresponds to `8aec113`
- diff from baseline `0d804d0`
- no mystery/untracked files
- no `.env` or secrets were added

## 2. Run focused tests first

At minimum:

- `test_whole_app_gap_closure.py`
- existing Stripe refund/payment/dispute-related suites
- booking/vaccine/check-in suites
- care-board suites
- client file/intake suites if they exist
- auth/password/permissions suites
- Finance/category/gross-net/tax suites
- School enrollment/commerce suites

Fix only confirmed defects. For every fix, add/adjust a regression test.

## 3. Run COMPLETE regression gates

Report exact numbers, not just “green”:

- full backend test suite
- full Jest suite
- all release-critical files/gates used by this repo
- production frontend build

Also compare totals to the currently accepted deployed baseline and explain any count change.

## 4. Stripe hostile QA

NO REAL MONEY.

Mock Stripe. Exercise duplicate, replay, out-of-order, partial success, and crash/retry convergence for:

- refund creation/finalization
- external refunds
- shop line fulfillment reversal
- disputes
- balance transactions/fees
- payouts

Verify no duplicate Finance rows, inventory movements, credit reversals, or entitlement withdrawal.

## 5. Permission/privacy QA

At the API level test Owner/Admin, restricted Trainer, Front Desk, and Client where relevant.

Especially verify:

- MFA endpoints are admin-only as intended
- agreement admin vs client boundaries
- intake cross-client file isolation
- pending dispute/refund items require finance permission
- overdue medication requires care permission
- client never sees staff-only intake fields
- marketing preference doesn't alter transactional permissions/data

## 6. Browser QA

Use disposable data and visually inspect at:

- `1440×900`
- `390×844`
- `320×568`

Surfaces:

- Login MFA challenge
- GuestAuthModal MFA challenge
- Settings → MFA
- Settings → Service & Program Agreements
- client Portal agreement signing
- Day-to-Day Controls unsupported/live truth presentation
- Front Desk/Register → Online Payments → Shop refund modal
- Action Required dispute/reconciliation/overdue medication cards
- Intake builder file-upload field
- client intake upload
- intake reviewer/download

Check clipping, overflow, hidden CTA, modal scrolling, dead buttons, stale loading, console errors, unexpected 4xx/5xx.

## 7. Full app regression

This branch must NOT break:

- Front Desk
- bookings/check-in/check-out
- daycare/boarding care
- vaccines
- clients/dogs
- Register/POS/cash drawer
- Finance/Tax
- invoices/A/R
- existing Stripe invoice payments/refunds
- Shop purchases/fulfillment/inventory
- credits/credit lots
- Online School / In Person / Hybrid School
- trainer lesson workspace
- Practice/Homework
- Repeat Program/checkpoints
- staff permissions
- client portal
- backups/settings

Do not perform real financial transactions just to test.

---

# M. CHANGE DISCIPLINE

Do NOT:

- deploy
- touch production MongoDB
- run a production backfill
- make real Stripe charges/refunds
- add SMS/Twilio
- redesign unrelated modules
- rewrite Finance/Tax/POS/School architecture
- automatically repair historical data

If you find a defect:

1. state severity
2. show root cause
3. make the smallest safe fix
4. add regression coverage
5. rerun affected + full gates

---

# N. FINAL REPORT FORMAT

Return:

### Architecture verdict
`YES / YES WITH ISSUES / NO`

### Confirmed defects found
Severity, root cause, fix, regression test.

### Settings truth results
Which controls are truly enforced vs deliberately unsupported.

### MFA results
Setup/login/recovery/disable/token invalidation.

### Agreement results
Versioning/scope/signature/enforcement/privacy.

### Stripe disputes results
Replay/idempotency/accounting/Action Required.

### Shop refund results
Physical/tax/inventory/credits/program/history/external-reconciliation.

### Stripe fee & payout reconciliation
Exact accounting behavior.

### Marketing suppression
Marketing vs transactional separation.

### Intake document upload
Ownership, MIME/size, privacy, review/download.

### Medication escalation
Alert/clear behavior and stable care-item ID verification.

### Exact automated totals
- Backend
- Jest
- release-critical
- build

### Browser QA
Separate by viewport and surface.

### Full-app regression result

### Changed files after receiving candidate

### Final commit SHA

### Working tree status

### Final status
Use only:

`NOT READY`

or

`READY FOR CONTROLLED DEPLOYMENT`

Do not deploy either way.
