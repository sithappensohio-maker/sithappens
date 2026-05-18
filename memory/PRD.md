# Sit Happens — Pro CRM

## Original Problem Statement
Build a full-stack dog daycare/boarding CRM ("Sit Happens") starting from an HTML prototype. Replace localStorage with a real backend.

## User Choices
- **Scope:** Booking workflow + training logs + vaccine alerts + photo uploads (options b+c)
- **Auth:** Simple JWT email/password (admin + client roles)
- **Design:** Keep current dark theme exactly (slate base, shGreen #8cc63f, shBlue #00a9e0, shOrange #f26522)
- **Photos:** Yes — stored as base64 in MongoDB

## Architecture
- **Backend:** FastAPI + Motor (async MongoDB), bcrypt password hashing, PyJWT Bearer tokens (7-day expiry)
- **Frontend:** React 19 + Tailwind + FullCalendar (npm), axios with localStorage JWT
- **DB:** MongoDB `sit_happens_db` — collections: `users`, `clients`, `dogs`, `bookings`

## User Personas
1. **Admin** — Manages clients, dogs, bookings, schedules. Seeded from env (`admin@sithappens.com / admin123`).
2. **Client** — Books daycare/boarding via portal, sees dogs, manages own bookings. Account created by admin.

## Core Requirements
- Role-based auth (admin vs client)
- Client/Dog CRUD with owner relationships
- Vaccine tracking with expiry alerts (rabies required for booking)
- Booking workflow: client requests → admin approves → credits deducted (1 per day)
- Daycare capacity check (default 30/day)
- Training logs per dog (admin only)
- FullCalendar visualization of bookings
- Dashboard with daycare occupancy, boarding count, health flags, total dogs

## Implemented (2026-01)
- ✅ JWT auth with bcrypt + admin seeding (idempotent)
- ✅ Client CRUD + portal account creation
- ✅ Dog CRUD with photo (base64), vaccines, training logs
- ✅ Booking endpoints (create/approve/reject/cancel) with full validation
- ✅ Availability endpoint (capacity + vaccine check)
- ✅ Dashboard stats endpoint
- ✅ Calendar events endpoint (FullCalendar JSON)
- ✅ Portal `/api/portal/me` (client info + credits)
- ✅ Login screen + admin shell (Dashboard, Schedule, Bookings, Clients, Dogs)
- ✅ Client Portal with booking flow + credit display
- ✅ 100% backend tests passing (20/20), frontend smoke tested

## Sprint 2 — Brand Kit + Day-of Toolkit (2026-01)
- ✅ Husky logo branding on login, admin sidebar, and client portal
- ✅ Tagline "Dog Training • Daycare • Boarding" + new browser title + favicon
- ✅ **Vaccine Alerts Banner** on dashboard (expired/missing/expiring rabies) with 30-day dismiss
- ✅ **Check-in / Check-out Board** replaces dashboard roster — auto-timestamps, status dot indicator
- ✅ **Pup Report Cards** — admin uploads up to 3 photos, taps mood tags, adds note; client sees it in portal under each booking
- ✅ 30/30 backend tests passing (Sprint 1 regression + Sprint 2 new endpoints)

## Sprint 3 — Settings + Scheduling Power-ups (2026-01)
- ✅ Updated to higher-res transparent-bg logo
- ✅ **Settings panel** with 6 tabs (admin sidebar nav)
  - Hours: per-day open/close per service (business, daycare, training; boarding 24/7)
  - Capacity & Kennels: daycare cap, boarding cap, editable kennel/room list
  - Booking Rules: max advance days, cancellation cutoff hours, auto-approve toggle, credit cost per service
  - Vaccines: toggle which vaccines are required (rabies/bordetella/dhpp/lepto/flu/heartworm) + alert threshold days
  - Mood Tags: edit pill list for report cards
  - Account: change admin password
- ✅ **Recurring bookings** — clients pick start date + repeat-until + weekdays (M-S grid)
- ✅ **Drag-and-drop calendar** — admin can drag bookings to new dates (auto-rescheduled)
- ✅ **Training as a service** alongside daycare/boarding (purple chip on calendar)
- ✅ All booking logic now reads from settings (multi-vaccine, costs, capacities, auto-approve, cutoffs)
- ✅ 48/48 backend tests passing (Sprint 1+2+3 regression)
- ✅ **Mobile responsive drawer** with hamburger toggle, slide-in nav, distinct testids

## Sprint 4 — Waiver e-sign + Incident Reports + Admin Booking (2026-01)
- ✅ **Digital Waiver e-sign** — Full Sit Happens waiver text rendered with markdown-style headings; client must type their name + check accept on first portal login. Stores typed name, IP, user agent, version, full text snapshot per signature.
- ✅ **Waiver gating** — Clients cannot book until waiver is signed. Admin can bump waiver version in Settings → requires all clients to re-sign.
- ✅ **Settings → Waiver tab** to edit text, toggle required-for-booking, view all signatures.
- ✅ **Incident Report Log** — Permanent legal record with 7 types (bite/injury/escape/illness/property/behavior/other) × 3 severities, photos up to 4, witnesses, action taken, vet+follow-up flags. Filterable by type. New "Incidents" admin nav item.
- ✅ **Admin Booking Modal** — "+ New Booking" on Bookings page + "+ Quick Check-in" on Dashboard. Pick client → auto-loads their dogs → service/date/kennel/notes. Toggles for: check-in immediately, override vaccines, override capacity. All admin-only.
- ✅ Bug fix: stale auth + missing isRecurring state caused user-reported "uncaught runtime error" crash; fixed and verified.
- ✅ 61/61 backend tests passing (Sprint 1+2+3+4 regression)

## Sprint 5+7 — Daily Operations + Training Mode (2026-01)
- ✅ **Dog Profile tabs** — Dog edit modal now has 5 tabs: Basics, Vaccines, Feeding & Meds, Training, Notes & Vet
- ✅ **Feeding schedule** per dog (time, amount, food type, notes)
- ✅ **Medication schedule** per dog (name, dosage, times, with-food flag, notes)
- ✅ **Training skill tracker** — 12 default skills (Sit/Stay/Down/Place/Recall/Heel/Leave It/Wait/Loose Leash/Crate/Watch Me/Drop It) with 4 progression levels (Intro/Practicing/Reliable/Proofed). Per-skill notes.
- ✅ **Vet contact** per dog (name + phone)
- ✅ **Booking drop-off/pickup times** — Optional time fields on AdminBookingModal; persist on bookings
- ✅ **Daily Run Sheet** — Print-friendly grouped roster (boarding/daycare/training) with feeding, meds, vet contact, kennel, dropoff/pickup, owner phone, emergency contact, notes. New admin nav item with date picker + Print button (CSS print styles).
- ✅ **Dashboard check-in board** now shows feeding/medication count icons inline + kennel assignment.
- ✅ **Training Homework** — Admin assigns tasks (title, instructions, optional YouTube link, due date) to a specific dog. Client portal shows assigned homework with "Mark Done" → completion note + proof photo. Filter by status (all/assigned/completed).
- ✅ Bug fix: BookingIn was missing dropoff_time/pickup_time fields (Pydantic silently dropped them); patched and verified
- ✅ 71/71 backend tests passing (Sprint 1+2+3+4+5+7 regression)

## Sprint 6 — Client Delight + Admin Edits (2026-02)
- ✅ **Global Search (Cmd/Ctrl+K)** — fuzzy search across dogs & clients with keyboard nav (↑/↓/Enter/ESC). Backend `GET /api/search?q=…`. Clicking a result auto-opens the matching dog/client edit modal.
- ✅ **Booking Edit Mode** — `Edit` button on each Bookings row opens AdminBookingModal with existing values; supports updating notes, kennel, drop-off/pickup times via `PATCH /api/bookings/{id}`. Button label dynamically switches to "Save Changes" in edit mode.
- ✅ **Booking Conflict Detection** — `GET /api/bookings/conflicts?dog_id=…&date_str=…` returns same-day bookings; AdminBookingModal shows an orange warning panel with conflicting bookings (works in both create + edit modes).
- ✅ **Upcoming Birthdays Banner** — Dashboard shows dogs with birthdays in the next 14 days. Computed in `_upcoming_birthdays()`.
- ✅ **Multi-Photo Gallery per Dog** — New "Gallery" tab in dog edit modal. Upload multiple photos via `<input type=file multiple>`, 3-col grid, click-to-lightbox, individual delete. Persisted in `dog.photos: List[str]` (base64).
- ✅ **Dog Lifetime Stats** — `GET /api/dogs/{id}/stats` returns daycare_days / boarding_nights / training_sessions / last_visit / incidents / homework counts. Displayed as stat pills atop the dog edit modal.
- ✅ **Report Card Lightbox** — Client portal report card photos now open a full-screen lightbox with prev/next arrows + ESC close.
- ✅ **ErrorBoundary** — Wraps `<App />` with a crash boundary that offers "Clear session & reload" (removes `sh_token` + reloads) — protects against stale state crashes during deploys.
- ✅ 81/81 backend tests passing (Sprint 1-7 regression incl. 10 new Sprint 6 tests)

## Sprint 8 — Client Self-Signup + Onboarding (2026-02)
- ✅ **Auto-link client record on `/auth/register`** — registering through the portal now creates BOTH a `users` row and a linked `clients` record (email/name pre-filled), so new prospects can self-serve immediately
- ✅ **Onboarding banner** with 3-step checklist (Profile → Add Dog → Sign Waiver) — friendly tone, step indicator, gated CTAs until prior step done
- ✅ **`PortalProfileModal`** — client edits own name/address/phone/emergency contact via `PUT /api/portal/me` (keeps user.name in sync)
- ✅ **`PortalDogModal`** — client adds/edits own dog: name, breed, age, birthday, sex, fixed, vaccines (rabies/bordetella/dhpp), photo, vet, notes. Backed by new `POST /api/portal/dogs` + `PUT /api/portal/dogs/{id}` that enforce owner scope. Admin-only fields (training_skills, feeding_schedule, medications) excluded from client-editable model.
- ✅ Dog cards in portal are now clickable → reopen edit modal. "Add a Dog" prominent button.
- ✅ Waiver auto-popup deferred until client has added at least one dog (so onboarding banner controls the natural order)
- ✅ **`/app/backend/reset_db.py`** — one-shot reset script for going to production (wipes all business data, keeps admin)

## Sprint 9 — Credit Model Cleanup (2026-02)
- ✅ **Credits are now daycare-only.** Boarding and training cost `0` credits — they're pay-on-the-day.
- ✅ **No hard-block on insufficient credits.** Clients with 0 credits can still book — daycare credits deduct *up to available balance* (the rest is owed on drop-off). Admin tracks the balance manually.
- ✅ **`credits_deducted` field** added to bookings — tracks the exact amount charged so cancellations refund only what was charged (not the full nominal cost).
- ✅ Portal credit card relabeled "Daycare Credits" with explainer copy ("For daycare days · Boarding & training pay-on-the-day").
- ✅ Regression: 81/81 backend tests passing; `test_insufficient_credits` updated to assert new pay-on-the-day behavior.

## Sprint 10 — Backup & Restore (2026-02)
- ✅ **`GET /api/backup/export`** (admin only) — returns a full JSON snapshot of all business collections (clients, dogs, bookings, incidents, homework, waiver_signatures, vaccine_dismissals, settings). User accounts intentionally excluded.
- ✅ **`POST /api/backup/restore`** with two modes:
  - `merge` (safer) — upserts by `id`; leaves existing records untouched if not in backup
  - `replace` — drops each collection and bulk-inserts the backup contents
- ✅ **Settings → Backup & Restore tab** — one-click download with date-stamped filename, drag-drop file picker with preview, mode selector, confirm dialog.

## Sprint 11 — Service-Dog Training Curriculum (2026-02)
- ✅ **Command Library** — `commands` collection seeded with 36 TADSAW service-dog commands across 4 categories (Engagement, Basic Obedience, Public Access, Task-Specific). Admin-managed at Settings → Training Commands.
- ✅ **5-point score scale** — 0=Not Started, 1=Introductory, 2=Learning, 3=Emerging, 4=Proficient, 5=Mastered (replaces the old 4-level training_skills tab).
- ✅ **Per-dog curriculum** — `dog.curriculum` stores per-command level/notes/last_session_at/in_homework. Auto-created on first session log; admin can also edit any command's level directly via `PUT /api/dogs/{id}/training/{command_id}`.
- ✅ **Training Sessions** — `POST /api/dogs/{id}/training-sessions` with date, environment (home/store/park/vet/training_facility/other), distraction (1-10), scores per command, and CGC mock-pass flag. Highest score wins per command.
- ✅ **Progress summary** — overall + per-category mastery %.
- ✅ **Auto-awarded badges** — Bronze (50% engagement+obedience), Silver (80% basics + CGC mock pass), Gold (95% overall + 90% task), plus per-category Master badges at 100%.
- ✅ **Admin UI** — Dog edit modal Training tab: progress ring, per-category breakdown, grouped command tiles with level chips, edit-entry modal, Log Session modal (full multi-command scoring), Session History modal.
- ✅ **Client portal** — "Training Progress" section per dog: progress ring + category %s + earned badges + flagged "Practice This Week" homework commands with YouTube demo links + Print Certificate (print-friendly landscape HTML cert for Bronze/Silver/Gold).
- ✅ **YouTube video URL** per command (optional gold-standard demo, opens in new tab).
- ✅ Settings → Training Commands tab: full CRUD for the library (admin can add/edit/delete commands).
- ✅ 19/19 new backend tests pass, 80/81 legacy regression pass (1 pre-existing unrelated failure).

## Sprint 12 — Training Pipeline + Multi-Enrollment + Tags (2026-02)
- ✅ **Multi-tier Programs system** — `programs` collection holds reusable curriculums per type (`private_lessons`, `board_train`, `service_dog`, `custom`) with modules → goals. Goals can be **scored (1-5)** or **manual_only** (boolean done/not-done) checkbox. `completion_rule` per program. Seven seeded standard programs via `POST /api/programs/seed-standard` (idempotent).
- ✅ **Per-dog enrollments** — `dog_programs` collection. A dog can hold **multiple simultaneously active enrollments** (multi-enrollment supported — no auto-pause of prior). Each enrollment has `target_completion_date`, `notes`, `goal_progress`, and a `program_snapshot` to keep the curriculum frozen at enrollment time.
- ✅ **Status lifecycle** — `active → on_hold → withdrawn / completed` (`paused` retired in favor of `on_hold`). Goal status auto-bumps: score 5 ⇒ mastered, 1-4 ⇒ in_progress, 0 ⇒ not_started; manual_only goals toggle mastered via the `status` field directly.
- ✅ **Global Training Pipeline screen** — new admin sidebar item. `GET /api/programs/pipeline` returns every enrollment with embedded dog/client/program details; UI shows KPI tiles (Active / On Hold / Completed), filter row (status + program type + free-text search), and per-row jump-to-dog wiring (`onJumpToDog`).
- ✅ **Programs admin builder** (`Programs.jsx`) — full CRUD with goal kind selector (scored vs checkbox), completion_rule editor, default-program flag, soft delete (`active=false`).
- ✅ **DogTrainingTab multi-enrollment UI** — enroll into any program, edit target date, score/check goals inline, withdraw/complete; existing service-dog command library tab still available.
- ✅ **Dog tags** — free-form `tags: List[str]` on every dog (e.g., `service_dog_candidate`, `puppy_class`). Persisted via either `PUT /api/dogs/{id}` (full save) or the dedicated `PUT /api/dogs/{id}/tags` endpoint.
- ✅ **Bug fix**: `DogIn`/`DogOut` Pydantic models were missing the `tags` field, causing the full-form dog save to silently drop tag edits and `GET /api/dogs` to strip the field from responses. Added `tags: List[str] = []` to `DogIn` → both routes now round-trip correctly. (RCA: iteration_10 test report.)
- ✅ 122/122 backend tests passing (test_pipeline_multi_enroll.py: 22 new tests covering pipeline filters, seed idempotency, programs CRUD with mixed goal kinds, multi-enrollment proof, target_completion_date round-trip, status transitions, manual_only mastery, scored auto-bump, active-summary, tag persistence). Obsolete `test_programs.py` (iteration_9 single-enrollment schema) removed.

## Backlog / Next Iterations (Prioritized)
**P1**
- Boarding capacity rule (currently only daycare enforces capacity)
- DogTrainingTab interactive smoke test (add enrollment, change target date, toggle manual_only checkbox) — backend covered, UI interactions only static-reviewed
- Vaccine expiry alerts banner on admin dashboard with click-to-dog

**P2**
- Custom `completion_rule` auto-trigger logic (UI exists; automation pending — programs.completion_rule should auto-mark enrollment `completed` when criteria hit)
- Tag-based filters across Pipeline / Dogs / Run Sheet
- CSV export of bookings/clients
- Run-sheet `active_program_name` picks the *first* enrollment; consider showing all or most-recent when a dog has multiple actives
- Stripe credit pack purchases via client portal

**P3**
- `server.py` refactor (~2300 lines → split into `/app/backend/routes/`)
- Multi-staff accounts with audit log
- Per-service pricing (vs flat credit cost)

## Sprint 13 — Installable PWA (2026-02)
- ✅ **`manifest.webmanifest`** — name "Sit Happens", short_name "Sit Happens", theme `#8cc63f`, background `#0f172a`, display `standalone`, scope `/`.
- ✅ **Icon set generated from existing `/public/logo.png`** (735×693 RGBA) onto solid slate-900 canvas: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (22% safe zone for adaptive shapes), `apple-touch-icon.png` (180×180), `favicon-64.png`.
- ✅ **`service-worker.js`** — versioned cache (`sh-v1`), shell pre-cached, network-first strategy for static assets (so new deploys take effect immediately when online) and offline fallback to cached shell. `/api/*` and cross-origin always bypass the cache. Auto-skip-waiting on update + `controllerchange` triggers a single page reload.
- ✅ **iOS PWA meta tags** — `apple-mobile-web-app-capable`, status-bar style `black-translucent`, `apple-mobile-web-app-title`, `viewport-fit=cover`. App title used by iOS install: "Sit Happens".
- ✅ **`InstallPrompt.jsx`** — listens for `beforeinstallprompt` (Chrome/Edge/Android) and renders a bottom-left pill with brand icon, "Install" + "Later" buttons. Dismissal persisted for 14 days in localStorage. iOS Safari gets a passive hint ("Share → Add to Home Screen") since iOS doesn't support programmatic install. Auto-hides when `display-mode: standalone`.
- ✅ **Service worker registered in `index.js`** — only on `https:` (skips dev). Manifest, SW, and icon endpoints all returning 200; SW activated and controlling the page.
- ✅ **`InstallAppButton` + `useInstallPrompt` hook** — manual install button in admin sidebar AND client portal header. Triggers native prompt if ready, or a styled howto modal with platform-specific steps (iOS vs desktop).

## Sprint 14 — Homework Templates Library + Per-Section Logging (2026-02)
- ✅ **10 ready-to-assign templates** seeded via `POST /api/homework-templates/seed-standard` (idempotent, slug-keyed upsert):
  - **Tier 1 · Foundation**: The First 48 Hours, Basic Obedience — Part 1, Door Manners & Impulse Control
  - **Tier 2 · Intermediate**: Structured Walk Mastery, Duration & Distance, Correcting Nuisance Behaviors
  - **Tier 3 · Advanced**: Bulletproof Recall, Off-Leash Fundamentals
  - **Specialty**: Public Access Prep
  - **Customizable Master Template** for on-the-fly assignments
- ✅ **Structured schema** — each template has `global_rules_this_week`, multiple **sections**, each section has **fields** (kinds: `reps`, `sets`, `duration_sec`, `duration_min`, `distance_ft`, `success_rate`, `rating_5`, `checkbox`, `text`, `longtext`) with optional `target` and `reverse` flag for "lower is better" metrics.
- ✅ **Backend endpoints**: full CRUD on `/api/homework-templates`, `POST /api/homework/from-template` (freezes template_snapshot + auto due-date from `default_duration_days`), `POST /api/homework/{id}/section-log` (validates section_id), `DELETE /api/homework/{id}/section-log/{log_id}`, `GET /api/homework/{id}/report` (per-section, per-field aggregations: total / avg / max / min / trend / count + checkbox yes_count + text latest).
- ✅ **`customized` flag** on system templates — admin edits via PUT mark `customized=True` so future `seed-standard` runs skip them. PUT also strips `is_default`/`active` to prevent silent reactivation.
- ✅ **Trend computation** — split-half compare; up/down/flat. Reverse fields flip the visual semantics.
- ✅ **Admin UI** (`Homework.jsx`): green "Assign from Template" + blue "+ Custom". Picker (`HomeworkTemplatePicker.jsx`) groups templates by tier with branded colors. Detail view shows tier badge, description, House Rules, collapsible section preview, override fields. Each assigned row has tier-colored badge + "View report" toggle.
- ✅ **`HomeworkReportPanel.jsx`** — per-section stat tiles with avg + total + trend arrow + goal-hit indicator.
- ✅ **Client UI** (`Portal.jsx` + `HomeworkSectionLogger.jsx`): templated homework expands to show House Rules banner + per-section cards. "+ Log a session" reveals structured form. Counters refresh on save (verified 1→2 via screenshot). View-history accordion lists past entries.
- ✅ **140/140 backend tests passing** (122 prior + 18 new homework-template tests).

## Sprint 15 — Tutorials / How-to (2026-02)
- ✅ **`Tutorials.jsx`** — single role-aware component (`role="admin" | "client"`) renders 6 admin sections (Getting Started, Clients & Dogs, Bookings & Schedule, Training Programs & Pipeline, Homework Forms, Operations & Data) and 5 client sections (Getting Started, Booking, Training Homework, Training Progress, Account & Profile). Each section has multiple cards with numbered steps and optional pro-tips in an orange-accent box.
- ✅ **Live search** across all tutorial content (filters cards, hides empty sections).
- ✅ **Admin access**: new "How to Use" sidebar item (with `fa-circle-question` icon) loads in-place like any other admin tab.
- ✅ **Client access**: blue "How to Use" button in the portal header opens a full-screen overlay with a sticky close header — no navigation away from the portal.
- ✅ Pure content, no backend calls. Lint clean.

## Sprint 16 — Services Catalog + Income Tracking (2026-02)
- ✅ **`services` collection** (new) seeded with 7 standard offerings via `POST /api/services/seed-standard` (idempotent): Daycare (per day) $35, Boarding (per night) $55, 1-on-1 Private Lesson $90, Board & Train (per week) $1500, Service Dog Evaluation $150, Bath $45, Nail Trim $20. Color + icon + service_type per row.
- ✅ **CRUD on `/api/services`** — admin can add custom services, edit any service (name/price/type/icon), and remove (soft-delete for `is_default`, hard-delete otherwise). PUT strips immutable `slug` and server-managed `is_default`.
- ✅ **`bookings` table extended** with `service_id`, `service_name`, `actual_price`, `payment_status` (unpaid/paid/refunded/comped), `payment_method` (cash/card/transfer/credits/other), `paid_at` — backward-compatible (all optional).
- ✅ **`POST /api/transactions`** — quick-log endpoint for walk-ins or one-off lessons. Creates a booking row tagged with service + price in one call; falls back to `service.base_price` when `actual_price` is null.
- ✅ **`PUT /api/transactions/{id}`** — inline edits (price / payment_status / payment_method / service_id). Two automations baked in: setting `payment_status="paid"` auto-stamps `paid_at` AND flips `status→completed`; swapping `service_id` refreshes `service_name` and only auto-syncs price if existing price was 0 (preserves admin overrides).
- ✅ **`GET /api/transactions`** — revenue-bearing rows by default (any row with `service_id` OR `actual_price`). `?revenue_only=false` includes legacy unpriced bookings for backfill. Filters: dog_id, service_id, status, payment_status, start_date/end_date.
- ✅ **`GET /api/transactions/weekly-summary`** — current Mon→Sun tally with `completed_total` / `paid_total` / `unpaid_total` / `booked_total` + counts + by_service breakdown + `credits_redeemed`. `?ref_date=YYYY-MM-DD` jumps to any other week.
- ✅ **`GET /api/transactions/summary-range`** — arbitrary date range with `by_day` series for monthly / quarterly views.
- ✅ **Auto-tally on check-out** — `POST /api/bookings/{id}/check-out` now auto-attaches the matching default `service.base_price` + `payment_status="unpaid"` if the booking has no price yet. The "automation when service is completed" the user asked about.
- ✅ **Admin UI** — new **Income** sidebar tab (`fa-dollar-sign`). Page header buttons (Export CSV / Log Service); 4 weekly tiles (Completed / Paid / Unpaid / Booked-upcoming); by-service breakdown chips; week navigator (◀ / date-picker / ▶ / Today); spreadsheet-style table with inline editable price / service / payment_status / payment_method per row; filters by dog / service / payment / status + search; "Include unpriced" toggle for legacy data; CSV export.
- ✅ **Log Service modal** — type-to-search dog picker, service dropdown auto-fills price, override price field, date/status/payment/method, notes.
- ✅ **Settings → Services & Prices** tab — full CRUD on the catalog with optional "Seed Standard 7" button for empty state.
- ✅ **Testing** — 24/25 Sprint 16 backend tests pass (1 environmental skip on the auto-tally test). 140/140 prior regression still pass. Frontend smoke-tested end-to-end via Playwright by the testing agent (100% Sprint 16 flows verified).

## Sprint 17 — Credit Packs (FIFO Lots) + Multi-Date Bookings + Monthly/Quarterly Income (2026-02)
- ✅ **`credit_packs` collection** seeded with 4 defaults via `POST /api/credit-packs/seed-standard`: Single Day $35 (1 credit), 5-Pack $160 ($32/credit), 10-Pack $300 ($30/credit), 20-Pack $550 ($27.50/credit). Full CRUD; per-credit value computed on the fly.
- ✅ **`credit_lots` collection** — every pack sold creates a FIFO lot tagged with `qty_total`, `qty_remaining`, `value_each` (per-credit cost from the pack), `pack_id`, `purchased_at`. Booking approvals consume oldest lot first; cancellations restore.
- ✅ **`POST /api/clients/{id}/sell-pack`** — admin sells a pack; increments client.credits AND creates the lot. **No income event** (revenue is recognized at redemption, not at purchase — per user's accounting preference).
- ✅ **Income recognition at check-out** — `_consume_credit_lots()` helper FIFO-consumes lots when bookings are approved, stamping `credit_value` on each booking (the per-credit cost from the consumed lot). `POST /api/bookings/{id}/check-out` then promotes `credit_value → actual_price` with `payment_status="paid"` and `payment_method="credits"`. The booking now appears in the weekly income tally.
- ✅ **Cancellation rollback** — cancelling an approved daycare booking refunds the credit balance AND restores `qty_remaining` on the lot it consumed from (via `_restore_credit_lots()`).
- ✅ **`POST /api/bookings/multi-dates`** — single API call creates one booking per date for "pick exact days" (e.g., Monday this week + Tuesday next week). Each date independently validates capacity/vaccines/waiver and returns `{created: [...], skipped: [{date, reason}]}` so the client sees exactly which days were blocked.
- ✅ **Settings → Credit Packs** UI — full CRUD with per-credit value live-preview and a "Seed Standard 4" empty-state button.
- ✅ **Clients page** — new "Sell Credit Pack" green button on each client card; opens a modal with pack picker (showing qty + price + per-credit), payment method, optional note, live "Credits +N / Charge $X / Value/credit $Y" preview tiles.
- ✅ **Client portal Book Service card** — new "Pick specific days" toggle (mutually exclusive with "Recurring weekdays"); reveals a two-month forward calendar grid with disabled-past, today highlighted, tap-to-toggle days. Selected days chip-row at bottom with × to remove individuals + "Clear all".
- ✅ **Income screen — Longer-Range View** — Month / Quarter / YTD / Custom preset chips, 3 KPI tiles (Completed / Paid / Avg-per-active-day), daily bar chart (`by_day` series from `summary-range` endpoint).
- ✅ **164/164 backend tests passing** (24 new Sprint 17 tests covering pack CRUD, FIFO consumption, lot rollback on cancel, multi-date validation + skip reporting, income recognition timing).

## Sprint 18 — Training Credit Packs (2026-02)
- ✅ **`clients.training_credits` field** (new, defaults 0) — separate pool from daycare `credits`. Both round-trip through ClientIn/ClientOut.
- ✅ **4 training pack defaults seeded**: Single 1-on-1 Lesson $90, 3-Session Pack $250 ($83.33/credit), 5-Session Pack $400 ($80/credit), 10-Session Pack $750 ($75/credit). All editable in Settings → Credit Packs.
- ✅ **`_consume_credit_lots()` is now service-type-aware** — FIFO consumption filters lots by `service_type` so daycare credits and training credits stay in their own pools. No cross-contamination.
- ✅ **Sell-pack endpoint routes by `pack.service_type`** — training packs increment `training_credits`, daycare packs increment `credits`. Each lot is tagged with its service_type for FIFO tracking.
- ✅ **Booking approval logic** — `service_type=="training"` deducts 1 from `training_credits` (1 session = 1 credit, regardless of `cost` field). Daycare keeps existing `cost`-based deduction. Cancellation refunds the correct pool via `booking.credit_service_type`.
- ✅ **Income recognition unchanged** — training credit redemption flows through the same accrue-at-approval / recognize-at-check-out pattern. Check-out promotes `credit_value → actual_price` regardless of pool.
- ✅ **Frontend Clients page** — every client card now shows **Daycare** (green) + **Training** (purple) credit balances side-by-side. Sell Pack modal got a `[All / Daycare / Training]` filter row + service-type-colored preview tiles.
- ✅ **Settings → Credit Packs** — new "Pool" dropdown (Daycare credits / Training credits) when creating/editing custom packs. Catalog rows color-code service_type pill (green for daycare, purple for training).
- ✅ **Client portal** — credit card split into two tiles: "Daycare · days remaining" (green) and "Training · sessions remaining" (purple).
- ✅ **Payment method enum extended** — added `check` to support paper-check tracking on pack sales.

## Sprint 19 — Admin Email Alerts + Photo Fit (2026-02)
- ✅ **Dog photos display in full** — main dog card hero, gallery thumbnails, and portal dog cards now use `object-contain` with a bgBase letterbox so uploaded photos are never cropped. Lightbox already showed full image.
- ✅ **Admin email notifications** wired through Resend (best-effort, non-blocking) for four client-triggered events:
  - New client account registration (`/api/auth/register`)
  - New booking from portal — already existed (`POST /api/bookings`)
  - Homework session log by a client (`POST /api/homework/{id}/section-log`)
  - Homework completion by a client (`POST /api/homework/{id}/complete`)
- ✅ All notifications skip self-triggered admin actions (only fire when `user.role != "admin"`) and never raise — failures are logged but never break the underlying flow.
- ✅ Smoke-tested via curl on `/api/auth/register` — Resend confirmed delivery to `sithappensohio@gmail.com`.

## Sprint 20 — Client Alerts: Homework + Low Credits (2026-02)
- ✅ **Homework-assigned email to client** — fires from both `POST /api/homework` (custom) and `POST /api/homework/from-template`. Email includes dog, title, due date, assigned-by, and trimmed instructions preview.
- ✅ **Low-credit heads-up email** — fires on credit deduction (both `POST /api/bookings` admin auto-approve path and `POST /api/bookings/{id}/approve`) when the balance crosses from `>2` to `≤2`. Pool-aware (Daycare vs Training) so each pack threshold notifies independently. Crossing-only logic prevents repeat spam at 1 and 0 credits.
- ✅ Smoke-tested: assigning a homework triggered the client email, and approving a booking that took credits from 3→2 triggered the low-credit email. Both delivered through Resend successfully.

## Sprint 21 — Bulk Credit Pack Sales (2026-02)
- ✅ **`POST /api/clients/{id}/sell-packs`** — new bulk endpoint accepts `items: [{pack_id, quantity}]` plus shared `payment_method` + `note`. Pre-validates every pack id, then mints one `credit_lot` per pack qty (so FIFO/redemption math is unchanged) and bumps `credits` / `training_credits` in a single `$inc`. Returns `lots[]`, per-pool totals, total_price, and lots_created count.
- ✅ **Payment-method enum on sell endpoints** now includes `check` (was already in the frontend, just missed in single-pack validator).
- ✅ **Sell-Pack modal redesign (Clients page)** — tap-to-add pack list with `×N` badge, full cart panel with `−` / `+` / `×` controls per line, live totals split into Daycare vs Training pools, dynamic CTA showing total credits + dollar amount (e.g., *"Sell · +3 credits · $160.00"*).
- ✅ Old single-pack endpoint kept for backward compat; new bulk endpoint is the one the UI calls.
- ✅ Smoke-tested: 2× Single Day Drop-In ($35) + 1× 5-Day Daycare Pack ($160) → client credits 10 → 17, $230 total, 3 lots created, mongo state verified.

## Sprint 22 — Sale Receipts (Emailed + Printable) (2026-02)
- ✅ **Bulk-sell endpoint now returns a `receipt` object** with `client_name`, `client_email`, `lines[]` (name, qty, unit_price, line_total, service_type, pack_qty), `totals`, `total_price`, `payment_method`, `note`, `sold_by`, `sold_at`.
- ✅ **Resend email receipt to client** — fires automatically (best-effort, non-blocking) after every pack sale. Branded HTML with line items, per-pool credits added, grand total, payment method, "Credits never expire" footer, and a portal CTA.
- ✅ **In-app printable receipt modal** — after a successful sale the Sell-Pack modal closes and a "Sale Complete" receipt modal opens with line-item table, pool breakdown chips, grand total in big shGreen, payment method, note, and "Print Receipt" CTA. Built with `window.print()` + a dedicated `@media print` rule in `index.css` that hides everything except `[data-testid="pack-receipt"]` and applies a clean white/black print theme.
- ✅ No expiration column (user confirmed packs don't expire — receipt explicitly says "Credits never expire").
- ✅ Smoke-tested via UI: 2× Single Day Drop-In + 1× Single 1-on-1 Lesson → modal shows both rows, $160 total, +2 daycare / +1 training, and Resend logs confirm receipt email delivered to client.

## Sprint 23 — Historical Receipts Tab (2026-02)
- ✅ **`GET /api/clients/{id}/receipts`** — groups `credit_lots` by `(purchased_at, payment_method, sold_by, note)` so each bulk-sale transaction becomes one receipt row. Lots from the same pack are aggregated into a single line (qty × unit_price = line_total) and totals split into daycare/training pools. Returns the exact same shape as the post-sale receipt response, so the existing `ReceiptModal` reuses cleanly.
- ✅ **"Receipts" button on every client card** (under "Sell Credit Pack") opens a `ReceiptsListModal` showing each historical sale with date, item count, pack count, payment method, sold-by, pool chips (+N daycare / +N training), note preview, total dollars, and a per-row **Reprint** button.
- ✅ Clicking Reprint pipes the saved receipt object into the same `ReceiptModal` used post-sale, so the printable layout and `window.print()` flow is identical to a brand-new receipt.
- ✅ `Modal` component now accepts an optional `maxWidth` prop (defaults to `max-w-md`) so the wider receipts list (`max-w-lg`) renders comfortably without breaking other modals.
- ✅ Smoke-tested: created 2 fresh sales for a client, plus one pre-existing lot — endpoint correctly returns 3 grouped receipts in newest-first order; UI shows all rows with correct totals, pool chips and notes.

## Sprint 24 — Professional Polish (Q1 2026)
- ✅ **QR install footer in client emails** — every client-facing Resend email (booking confirmed, homework assigned, low credits, pack receipt, etc.) now includes a 110×110 QR code linking to the app + iOS / Android install instructions. Admin notifications skip the footer (you already use the app).
- ✅ **`qrcode` library** added to requirements.txt + inline base64 PNG generation cached in-memory per URL so no extra latency on repeat sends.
- ✅ **Stale-token auto-clear** — `axios` response interceptor in `/app/frontend/src/lib/api.js` watches for 401 responses and removes the bad JWT from localStorage + redirects to `/`. ErrorBoundary already in place handles full crashes.
- ✅ **Auto-complete training enrollments** — new `_auto_complete_if_satisfied()` helper fires after every goal update (`PUT /dogs/{id}/programs/{eid}/goals/{gid}`) and every training log (`POST /dogs/{id}/training-logs`). Evaluates the enrollment's `completion_rule.type` (`percent` / `all_mastered` / `manual` / `sessions`) and flips status → completed when satisfied; stamps `auto_completed=true`, `completed_at`, and rotates the dog's `active_program_id` to the next active enrollment if any.
- ✅ **Backend test pollution fixed** — `TEST_DATE_OFFSET = random.randint(20, 40)` rolled at module import; all hard-coded `date.today() + timedelta(days=N)` in TestBookings replaced with `_future_date(N)` so consecutive runs don't collide with leftover Boarding bookings. Stays under `booking_rules.max_advance_days=60`.
- ✅ Testing agent verified: 25/25 targeted tests pass, 163/164 full regression (1 transient HTTPS timeout, retry green). Email send verified through Resend with new QR footer.

## Sprint 25 — Performance Optimisation (2026-02)
- ✅ **MongoDB indexes added** on hot query paths: `bookings.(date, status)`, `bookings.dog_id`, `bookings.client_id`, `dogs.owner_id`, `homework.(status, created_at desc)`, `dog_programs.(dog_id, status)`, `credit_lots.(client_id, purchased_at desc)`, `credit_lots.(client_id, service_type, qty_remaining)`. Idempotent — running again is a no-op.
- ✅ **`/api/bookings` date-windowed** by default to last 90d + future 90d. New params: `start_date`, `end_date`, `include_all=true` (for CSV export / reconciliation). Backward compatible — no frontend changes needed.
- ✅ **`/api/dogs` strips gallery photos** from list responses (base64 arrays can be MBs per dog). Each card still gets the main `photo` thumbnail. New `GET /api/dogs/{id}` endpoint returns the full record with gallery — used by the edit modal which now fires `Promise.all([fullDog, stats])` so the modal still opens snappily.
- ✅ **`/api/dashboard/stats` projection** drops `photo`, `photos`, `training_logs` from roster dogs (kept `feeding_schedule` + `medications` + `training_skills` so dashboard care-icons keep rendering). Restricted booking query to a tight window (today ± 60d back / 1d forward) instead of every booking.
- ✅ **`/api/programs/pipeline` N+1 → 2 queries** — batch-loads dogs and clients with `$in` then joins in memory instead of N+1 round trips. Measured: 360ms → 135ms (2.6× faster).
- ✅ Testing agent verified: **194/195 tests pass**, one stale test rolled back after restoring `feeding_schedule`/`medications` to the dashboard projection (the dashboard's care-icon badges need them).

## Sprint 26 — Client-Side Image Compression (2026-02)
- ✅ **`/app/frontend/src/lib/imageCompress.js`** — single utility resizes uploaded photos via `<canvas>` to max 1600×1600 and re-encodes as JPEG q=0.82 before base64-storing. Non-images (PDFs, SVG) pass through untouched. Small photos (<400 KB and under the size cap) skip recompression. Decode failures fall back to the original so an exotic format never breaks upload.
- ✅ **Wired into 6 upload sites**: Dogs main photo + gallery, Portal homework photo, Portal new-dog modal photo, Dashboard report card photos (×3), Incidents photos (×4).
- ✅ **Expected savings**: a typical 4 MB iPhone photo becomes ~150-300 KB stored — **10-20× smaller** with no visible quality loss. Dog gallery downloads now stay snappy even with 5+ photos per dog at scale.
- ✅ Pre-existing dead code at the tail of `Portal.jsx` (lines 565-570 leftover from earlier merge) cleaned up.

## Sprint 27 — Photo Backfill + Tolerant Index Creation (2026-02)
- ✅ **`/app/backend/photo_backfill.py`** — Pillow-based async backfill that scans `dogs`, `bookings.report_card`, and `incidents`, decodes base64 photos, resizes to ≤1600px, re-encodes as JPEG q=82. Photos under ~350 KB are skipped (idempotent). Tracks scanned/compressed/skipped/errors + bytes saved in module-level state.
- ✅ **`POST /api/admin/compress-photos`** — admin-only, kicks off the backfill as an `asyncio.create_task` so the API stays responsive. Re-running while a job is active is a no-op.
- ✅ **`GET /api/admin/compress-photos/status`** — poll endpoint returning current stage, counts, mb_saved.
- ✅ **`PhotoCompressionPanel` in Settings → Backup & Restore** — purple "Shrink Existing Photos" section with stats grid (Scanned / Compressed / Skipped / Space saved MB), running spinner, polling status every 1.5s, confirmation modal, and a re-run button that's safe to press again later.
- ✅ **Tolerant index creation on startup** — each perf index wrapped in its own `try/except` so one malformed legacy index never aborts the entire backend boot (defensive fix prompted by the slow-deploy observation).
- ✅ **Verified**: injected a 3.9 MB synthetic JPEG onto Buddy → ran backfill → photo dropped to 330 KB (**16× smaller**) in 180 ms. UI panel shows "Saved 4.9 MB across 1 photos" on completion.

## Sprint 28 — Lazy Image Loading (2026-02)
- ✅ Added `loading="lazy" decoding="async"` to **12 photo `<img>` tags** across Dogs (card hero, gallery thumbs, edit form preview), Portal (dog cards, homework photo, report card photos), Dashboard (report card preview), Pipeline (avatar), Incidents (card + edit form), Homework (completion photo), and PortalDogModal.
- ✅ Skipped static brand assets (`/logo.png`, `/icon-192.png`, made-with-emergent badge) and the Lightbox modal — those are tiny / above-the-fold / only visible after explicit user interaction.
- ✅ Browser now only downloads photos as they scroll into view, eliminating the burst of 20-30 simultaneous image requests on first paint of Dogs / Pipeline / Bookings screens.

## Sprint 29 — Smart Check-out + Cancel-with-Refund (2026-02)
- ✅ **`POST /api/bookings/{id}/check-out`** rewritten to accept an optional `CheckoutIn` body: `use_credits`, `payment_method`, `payment_status`, `base_price`, `add_ons[]`. Calling with no body keeps the previous default (consume credits, no add-ons) so legacy callers are untouched.
- ✅ **"Use credits" path**: credits stay deducted, `actual_price = credit_value`, `payment_method = credits`, income tally records the redemption.
- ✅ **"Refund + charge" path**: `_restore_credit_lots()` puts the credit back on the pack, `client.credits` is incremented, `credit_value` cleared, booking gets `actual_price + payment_method = cash/card/check/etc.`
- ✅ **Add-on services at check-out**: each `{service_id, name, price, qty}` is logged as a line item on the booking and added to `actual_price`. Bath / nail trim / any other configured service can be tacked on with one tap.
- ✅ **`CheckoutModal`** (new) on Dashboard: radio for credits-vs-charge (only shown when credits exist), grid of add-on chips with +/- counters, payment method + optional base-price override, live total preview broken down into Base / Add-ons / Charged today.
- ✅ **Cancel-with-refund**: existing `DELETE /bookings/{id}` already refunds credits when status is "approved" (which is still the case after check-in — only check-out flips to "completed"). Added two cancel surfaces on the frontend: (a) a dedicated **Cancel** button next to **Check Out** on the dashboard roster, (b) a red **"Cancel booking instead"** link inside the CheckoutModal for the "wait, I made a mistake" moment.
- ✅ End-to-end verified: client 10 credits → quick check-in (9) → cancel → **10 credits + lot.qty_remaining restored** simultaneously.

## Sprint 30 — In-App Cancel Modal (sandbox-safe) (2026-02)
- ✅ **Diagnosed:** The Sprint 29 cancel buttons used `window.confirm()`, which the Emergent preview iframe silently auto-dismisses to `false` for sandbox security — making the cancel appear to "do nothing" even though no JS error fires.
- ✅ **Replaced** both cancel surfaces with a custom in-app `<CancelBookingModal />` (z-index 60 so it stacks above the Check-out modal). Shows a red icon header, "Cancel booking?" copy, a green chip listing exactly which credits will be refunded (or a quiet "no credits to refund" note when zero), and **Keep it** / **Yes, cancel it** buttons.
- ✅ The Check-out modal's "Cancel booking instead" link now requests the parent component to swap modals: `setCheckoutFor(null); setCancelFor(b);` so the user gets the same confirm UX from either entry point.
- ✅ Smoke-tested in the actual preview iframe via Playwright: `Cancel button → modal opens → confirm → DELETE 200 → modal closes → roster row removed`.

## Sprint 48 — Portal feature pack: loyalty badges, refer-a-friend, vaccine self-upload, quick links (2026-02)
- ✅ **Settings → Portal Links** (`PortalLinksPanel`): editable URLs for your website and photo gallery host. Backend wires through `client_portal_links` field on settings doc + default block + nested backfill + `/api/settings/public`.
- ✅ **Loyalty visit badges**: `/api/portal/me` extended to return `visit_counts` (per-dog completed-booking count via a single Mongo aggregation). Portal dog cards now show a green "🏆 N visits" pill next to the breed when count > 0.
- ✅ **Refer a Friend**: `/api/portal/me` mints a 6-char `referral_code` on first call and stores it on the client doc. New `<ReferFriendModal>` shows the code in big orange type with one-tap **Text / Email / Copy** actions that pre-fill a sharable message + a `?ref=CODE` URL. Admin-side helpers added: `GET /api/referrals/lookup/{code}` to validate a code and `POST /api/clients/{id}/credit-referral` to comp a daycare day to the referrer (writes both a `referrals` audit entry and a `credit_adjustments` entry).
- ✅ **Vaccine expiry self-upload**: each portal dog card now detects vaccines expired OR within 30 days; renders a red "🛡️ N vaccines need updating" footer with an Upload button. `<VaccineUploadModal>` takes a date + compressed photo, POSTs to new `/api/portal/dogs/{id}/vaccine-update` endpoint which updates the expiry immediately (unblocking the client from booking) and stores the photo under `vaccine_certs` for later admin review.
- ✅ **Quick Links section** on Portal: pill-button list with the website / gallery / refer-a-friend entries; hidden entirely if all three are blank.
- ✅ Verified end-to-end at 390×844: quick links section renders all 3 entries; clicking Refer opens modal with code `7KTUMQ`; share buttons work; loyalty badge will appear automatically as clients complete bookings.

## Sprint 47 — Boarding pack UI + seed defaults (2026-02)
- ✅ **Seed data** (`credit_packs_data.py`): added 3 boarding packs to `SEED_CREDIT_PACKS` — single $55, 5-night $250, 10-night $475.
- ✅ **Settings → Credit Packs** (`CreditPacksSettings.jsx`): new "Boarding nights" option in the pool dropdown; chip color uses `text-shOrange` to match the rest of the app. Seed button now shows always (label flips to "Add Missing Defaults" when packs already exist) so existing installs get the 3 new boarding packs idempotently.
- ✅ **Sell Pack modal** (`Clients.jsx`): added "Boarding" filter chip, refactored pack-row color/unit logic to support 3 pools (sessions / nights / credits), cart summary expanded from 3 to 4 columns (Daycare / Training / Boarding / Charge).
- ✅ **Receipt** (`ReceiptModal`): per-line unit label now branches on boarding ("boarding nights"); totals grid shows the third pool when present.
- ✅ Verified end-to-end: seed endpoint added 3 boarding packs, Sell modal filters/cart/totals all render correctly with boarding pool.

## Sprint 46 — Boarding credits + manual credit adjustments (2026-02)
- ✅ **Boarding now uses the credit pool**: new `boarding_credits` field on the client doc (1 credit = 1 night). Helper `_credit_balance_field(service_type)` centralises the daycare/training/boarding → field mapping. Every existing call site (booking create, approve-booking, cancel-with-refund, check-out toggle, single sell-pack, bulk sell-pack) routed through the helper so boarding behaves exactly like daycare for FIFO consumption + refunds.
- ✅ **Bulk sell-packs** (`sell_credit_packs_bulk`): generalised to a 3-pool increment dict (`daycare`/`training`/`boarding`) — packs with `service_type: "boarding"` now mint proper lots and bump the right balance.
- ✅ **New endpoints** (`server.py`):
  - `POST /api/clients/{id}/adjust-credits` — `{daycare, training, boarding, note}` with signed deltas. Refuses negatives that'd take a balance below zero. Writes a `credit_adjustments` collection entry (before/delta/after per pool + note + admin name + timestamp) for audit.
  - `GET /api/clients/{id}/credit-adjustments` — list the audit log.
- ✅ **Frontend**:
  - Client card credit grid now shows **Daycare/Training/Boarding/Portal** (4 cols on `sm:`, stacked 2x2 on phones). Boarding uses `text-shOrange` for consistent color coding.
  - New "± Adjust Credits" button between Sell Pack and Receipts on every client card.
  - `<AdjustCreditsModal>` with live preview ("Current X → New Y"), red highlight if the proposed value would go negative, +/- step buttons, manual number input, required note, save-disabled when nothing changed or anything's negative.
  - Portal credit card + ClientPortalPreview both updated to a 3-col display showing all three pools.
- ✅ End-to-end verified: API call adjusts Alex Owner's daycare 9→12 with note logged, audit log returns the entry, UI grid + modal preview match.

## Sprint 45 — Hotfix: portal-snapshot decorator lost during marketing-qr insert (2026-02)
- ✅ When inserting the marketing-qr endpoint above the portal-snapshot endpoint, the `@api.get("/admin/clients/{client_id}/portal-snapshot")` decorator got accidentally consumed by the search/replace — the function body remained but it was no longer wired to a route, so the snapshot endpoint silently returned FastAPI's default 404.
- ✅ Restored the decorator. Verified preview: snapshot for Alex Owner returns full payload (1 dog, 1 booking, waiver signed). Production needs a redeploy to clear the same bug.

## Sprint 44 — Downloadable marketing QR code (2026-02)
- ✅ **Backend** (`server.py`): new admin endpoint `GET /api/admin/marketing-qr?size=N&ref=tag`. Generates a high-error-correction PNG QR pointing at `APP_PUBLIC_URL`, optional `?ref=` query param baked into the encoded URL for future scan analytics. Returns the PNG as `attachment` with a friendly filename and an `X-QR-Target-Url` header so the UI can show what's encoded.
- ✅ **Frontend** (`Settings.jsx`): new "Marketing QR" tab with a `MarketingQRPanel` component. Live PNG preview, debounced tracking-tag input (regenerates preview as you type), three download buttons (Small 512px / Print 1024px / Poster 2048px) sized for different print use cases. Uses `responseType: "blob"` + `URL.createObjectURL` + auto-clicked anchor for the download.
- ✅ Initial JSX nesting bug (MarketingQRPanel ended up inside WaiverPanel because of a missing close brace + orphan brace) caught and fixed.
- ✅ Verified end-to-end: preview renders, ref input updates the encoded URL live (`https://sit-happens-crm.emergent.host?ref=flyer`), all 3 download sizes serve correct content-disposition headers.

## Sprint 43 — "Preview as client" read-only portal viewer (2026-02)
- ✅ **Backend** (`server.py`): new admin endpoint `GET /api/admin/clients/{client_id}/portal-snapshot`. Single aggregated payload — `{client, dogs, bookings, enrollments_by_dog, homework, waiver, waiver_required}`. Read-only, no state changes. Same data shape Portal.jsx fetches but pulled by client_id instead of from the JWT.
- ✅ **Frontend component** (`components/ClientPortalPreview.jsx`): full-screen modal with a red "VIEWING AS {Name} (READ-ONLY)" banner + "Return to Admin" button. Shows credits tiles, waiver status, My Dogs cards, Upcoming bookings, Training Progress rings, Homework list, and Recent visits. No interactive controls — admin can't book/sign/edit on the client's behalf.
- ✅ **Wired** into `Clients.jsx`: each client card now has a blue "👁 Preview Client Portal" button at the top. Tap → opens the modal.
- ✅ Verified end-to-end at 1440×900 and 390×844: clicking Alex Owner's preview shows their actual credits (10/5), waiver status, Buddy dog card, and recent cancelled booking — exactly what Alex would see.

## Sprint 42 — Collapsible descriptions + editable service info (2026-02)
- ✅ **`CollapsibleText` component** (`components/CollapsibleText.jsx`): single-line preview + inline "More" toggle. Used wherever short blurbs would otherwise wrap into 8-line vertical walls on mobile.
- ✅ **Training program card** (`DogTrainingTab.jsx`): the "focus" description was wrapping into a tall narrow column on phones (visible in user's screenshot). Now: header restructured to keep ProgressRing/title/buttons on a single row; description sits below in a collapsible single line with a "More" toggle.
- ✅ **Client portal training card** (`PortalTrainingCard.jsx`): same `CollapsibleText` treatment so clients see a tidy summary instead of an 8-line wall.
- ✅ **Settings → Service Info tab** (new `ServiceInfoPanel` in `Settings.jsx`): 4 editable textareas (daycare/boarding/training/grooming) saved to `service_descriptions` on the settings doc. Backend (`server.py`) adds the new field to `_default_settings`, `SettingsIn`, the nested-backfill block, and `/api/settings/public`. `Portal.jsx`'s `ServiceInfoModal` now reads `pubSettings.service_descriptions[type]` with a hardcoded fallback.
- ✅ End-to-end verified at 390×844: enrollment card shows 2 collapsible focus rows with "More" toggles, Settings → Service Info renders 4 textareas pre-populated with defaults.

## Sprint 41 — Mobile polish: sticky CTA, pull-to-refresh, safe-area, service info (2026-02)
- ✅ **Service info modal** (`Portal.jsx`): added `SERVICE_INFO` constant + `<ServiceInfoModal>`. Each service-type pill on the portal now has a small ⓘ icon — tap to open a bottom-sheet description with a summary + 4 bullet points. Keeps the booking form short.
- ✅ **Sticky mobile "Book Service" CTA** (`Portal.jsx`): `fixed bottom-0 md:hidden` bar with `pb-safe`. Tapping smooth-scrolls to `#portal-book-section`. Scroll area gets `pb-24 md:pb-8` so content never hides behind it.
- ✅ **Pull-to-refresh hook** (`usePullToRefresh.js`): new touch-only hook + `<RefreshSpinner>`. Tracks vertical pull while `scrollTop === 0`, fires `onRefresh()` past 70px threshold. Skips on non-touch devices. Wired into Dashboard + Bookings, both using a shared `[data-scroll-root]` selector on App.js's main scroll container.
- ✅ **Safe-area-inset CSS** (`index.css`): utility classes `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`, `mb-safe`, and `h-safe-screen` for PWA notch/home-indicator support on iPhone.
- ✅ End-to-end verified at 390×844: sticky CTA present, tapping scrolls to booking section, ⓘ buttons open the description modal (verified "Training" content: "1-on-1 sessions...", bullet list correct). At 1920×800: sticky CTA correctly hidden, info modal still works centered.

## Sprint 40 — Broad mobile UX sweep (2026-02)
- ✅ **Portal header**: was `h-24 px-8` with logo+tagline+welcome+3 buttons that all overflowed on phones (user's first complaint). Now: 40px logo on mobile / 64px desktop, tagline hidden under `sm:`, welcome name truncates, Logout collapses to icon-only on phones. Padding `p-3` on mobile / `p-8` desktop.
- ✅ **Portal onboarding banner**: tightened padding (`p-4 sm:p-6`), shrunk text sizes, narrowed the "X of 3" pill.
- ✅ **Bookings**: was a 6-column wide table that forced horizontal scroll on phones. Now: hidden on mobile + replaced with stacked cards showing dog/client/service/date/status pill + inline action links. Desktop table unchanged.
- ✅ **Schedule** (`Schedule.jsx` + `index.css`): auto-detects mobile (`matchMedia <=767px`) → switches FullCalendar to `dayGridWeek` view with a compact toolbar (prev/next/today + abbreviated MMM-YY title). Added mobile-only CSS targeting `.fc-toolbar`, `.fc-button`, `.fc-event` to shrink font sizes so events actually fit in narrow day cells.
- ✅ **Clients + Dogs cards**: removed the `opacity-0 group-hover` pattern that hid Edit/Trash icons until hover (broken on touch devices — phone users literally couldn't access them). Now always visible on `<md`, hover-only on desktop.
- ✅ Verified at 390×844 and 1920×800: mobile is now navigable end-to-end; desktop has zero regression (Bookings still shows wide table, Schedule still shows month grid).

## Sprint 39 — Mobile UX overhaul: dog edit + grading (2026-02)
- ✅ **`Modal` component** (`Clients.jsx`): now responsive. Mobile (<640px) renders as a bottom-sheet (`items-end`, `rounded-t-2xl`), tighter padding (`p-5` instead of `p-8`), and a sticky title bar with the close button. Desktop unchanged (centered, `sm:rounded-2xl`, `sm:p-8`). Added `max-h-[95vh] overflow-y-auto` so long forms scroll naturally on phones.
- ✅ **`GoalRow`** (`DogTrainingTab.jsx`): main row was `flex items-center` — on phones, the 6 score buttons (0-5) competed with the goal description for the same horizontal space, causing the chips to overlap the text (visible in user's screenshot). Changed to `flex-col sm:flex-row` so on mobile the goal name sits on its own line and the score chips sit on a new row below. Buttons also enlarged to `w-8 h-8` on mobile for easier tapping.
- ✅ **`StatPill`** (`Dogs.jsx`): label font shrunk from `text-[15px]` to `text-[10px] sm:text-[15px]` and value from `text-xl` to `text-lg sm:text-xl` so the 4 stat tiles fit cleanly in a 2×2 grid on phones without eating half the modal vertical space.
- ✅ **Dog edit modal**: removed the hardcoded `max-h-[75vh]` + nested `overflow-y-auto` inner div that was competing with the new Modal's outer scroll, eliminating double-scrollbars. Promoted modal to `max-w-2xl` for better desktop use of space.
- ✅ Verified at 390×844 (iPhone): score buttons measured cleanly within viewport (x=58 to x_end=303), no overlap. Verified at 1920×800 (desktop): no regression — modal still centered with generous padding.

## Sprint 38 — Check-out frees the slot (2026-02)
- ✅ **Bug**: dogs that had checked out were still counted against daycare/boarding/training capacity for the rest of the day, so the dashboard showed e.g. "4/30" when only one dog was actually on-site.
- ✅ **Fix** (`server.py`):
  - `_booking_days_count_filtered()` (capacity-check helper used at booking creation, quick-check-in cap, and `/bookings/availability`) now skips any booking with `checked_out_at` set.
  - `/api/dashboard/stats` increments `daycare_today/boarding_today/training_today` only when `checked_out_at` is empty.
  - Roster still includes checked-out rows so admin can see who came and went today.
- ✅ Verified: Sparky checked in → 1/30. Sparky checked out → 0/30 with 30 open_slots reported by `/bookings/availability`.

## Sprint 37 — Clickable dog names on client cards (2026-02)
- ✅ **App.js** passes `onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id}); setTab("dogs"); }}` to `<Clients>`, reusing the same search-navigation pipeline that Pipeline already uses.
- ✅ **Clients.jsx**: each dog name is now a button. Hover shows underline + a subtle blue arrow `→`. Click jumps to the Dogs tab and opens that dog's Edit modal automatically (via existing `focusId` plumbing).
- ✅ Verified: clicking "Buddy" on Alex Owner's card lands on Dogs tab with the Edit Buddy modal open and all fields populated.

## Sprint 36 — Client Hub: Dog list per client card (2026-02)
- ✅ **Backend** (`server.py`): added `dogs: List[{id,name,breed}]` to `ClientOut`. `GET /api/clients` now pulls all dogs in one query (photo fields excluded), groups by `owner_id`, and attaches the sorted list to each client. No N+1.
- ✅ **Frontend** (`Clients.jsx`): each client card now shows a "🐾 Dogs · N" section between contact info and credit stats. Lists each dog as "{Name} · {Breed}". Empty state: "No dogs on file" in muted grey.
- ✅ Verified live: Alex Owner → Buddy, First Booker → Pixel · Mix, Garrett Compston → A, Celebration Test → Sparky · Lab.

## Sprint 35 — First Booking Email Notification (2026-02)
- ✅ **Email service** (`email_service.py`): new `notify_admin_first_booking(booking, client)` — branded celebratory email with title "🎉 First booking — {Name}", subject prefixed with 🎉, includes client/dog/service/dates + phone/email contact, "Open Admin" CTA. Sends to `ADMIN_NOTIFICATION_EMAIL`.
- ✅ **Backend** (`server.py`): added a single `count_documents({"client_id": ...}) == 1` check right after `db.bookings.insert_one(doc)` in `POST /api/bookings`. Fires for both client-portal and admin-created bookings. Best-effort (try/except so an email hiccup never breaks booking creation).
- ✅ Verified end-to-end via Resend: first booking → email sent to `sithappensohio@gmail.com` (Resend ID `70ed90c2-...`). Second booking for the same client → no additional email. Detection is correct.

## Sprint 40 — True "View Portal as Client" Impersonation (2026-02)
- ✅ Replaced the old read-only ClientPortalPreview snapshot modal with a **real impersonation flow** — `POST /api/admin/clients/{id}/impersonation-token` mints a 15-min client-scoped JWT, frontend saves the admin token into a `sh_admin_token` slot, swaps `sh_token`, and reloads. The admin sees the **actual** Portal, 1:1 with what the client sees (same trophies, same services & pricing, same gallery CTA, same homework, same booking widget).
- ✅ Persistent yellow `ImpersonationBanner` at the top of the page with "Return to Admin" — one click restores the admin token and reloads back to wherever they came from.
- ✅ Token rejects non-admins (403); rejects clients who haven't claimed a portal account yet (400 with helpful "send a Claim Account email first" hint).
- ✅ Backward compat: kept the old "Quick portal snapshot" button on each client card for a faster non-impersonated read-only summary.


- ✅ **`notify_client_quote_received`** Resend template: friendly "Hey {first_name}! Thanks for asking about {item} — someone will be in touch within 24 hours" auto-responder fires on `POST /api/portal/quote-request`. Echoes their listed price + their own message back. CTA returns to portal.
- ✅ **BookingOut model** extended with `extra_nights: Optional[Dict[str, Any]]` so the audit dict written at check-out (count, credits_used, billed_nights, per_night_rate, charge, added_at) round-trips back through the API — addresses the only minor finding from iteration 17.
- ✅ **Full regression**: 51/51 backend tests pass (19 iter15 + 21 iter16 + 11 NEW iter17 covering Sprints 37/38/39/39.5). Frontend smoke confirms Quote Requests panel, vaccine alerts, first-booking celebration, leaderboards, unified Settings (no separate Programs nav), portal services-at-bottom + 15 Request Info buttons + gallery CTA. Zero critical bugs. Zero frontend bugs.


- ✅ **Portal layout**: moved the Services & Pricing section out of the left sidebar and below the main 3-column grid so it now spans the **full width** of the screen and sits **at the bottom** — clients see their personal info first, then browse the catalog. 3-column tile grid on desktop, 2-column on tablet, 1-column on mobile.
- ✅ **"Request Info" button** on every service + program tile. Opens a modal with auto-filled name/email/phone (no manual entry) + optional message (500 chars). Submit fires `POST /api/portal/quote-request` → writes `quote_requests` Mongo row → emails the admin via the new `notify_admin_quote_request` Resend template.
- ✅ **Admin Quote Requests panel** on the Dashboard — new "QUOTE REQUESTS · N" card lists open requests with client name, requested item, listed price, timestamp, clickable email/phone, custom message, and "Mark Handled" button (`POST /admin/quote-requests/{id}/close` flips status to `closed`).


- ✅ **Admin Settings**: removed the dedicated "Programs" tab; renamed "Services & Prices" → "Services & Programs" and rebuilt the catalog UI to group services by category (Daycare / Boarding / Training / Grooming / Photography / Other), with **Training Programs embedded as a final category section** that hosts the existing `ProgramsPanel` editor.
- ✅ **Programs price field**: added `price: float = 0` to `ProgramIn` Pydantic model. Programs editor now includes a Price input with helper text ("Shown on the client portal so prospects can see what each program costs"). Default-program prices seeded ($450 / $550 / $350 / $1500 / $2750 / $3900).
- ✅ **Client access**: `/api/programs` now returns a slim view (id, name, type, focus, format, price, module_count) to authenticated clients instead of 403.
- ✅ **Portal "Services & Pricing"** redesigned with new `<ServicesByCategory>` component — collapsible sections per category (Daycare, Boarding, Training, Grooming, Photography, Other, Training Programs). Service tiles show price + Credit-eligible vs Pay-on-the-day tag. Program tiles show price (or "Contact"), program type, format (sessions/weeks), and minimum age.


- ✅ **Per-client photo gallery URL**: new `photo_gallery_url` field on Client doc; admin Clients form has a labeled input; Portal renders a prominent "SEE YOUR PUP IN ACTION · ORDER PRINTS" gradient card linking to the client's private gallery. Global Settings field demoted to "Fallback Only".
- ✅ **Portal "Services & Pricing" section**: dedicated card at the top of the portal listing all active services from `/api/services` with name, FontAwesome icon (or service color), description, base price, service type, and "Credit-eligible" vs "Pay-on-the-day" tags. Footer note nudges clients toward Credit Packs.
- ✅ **Photography as a first-class service type**: added to all `Literal` enums (`BookingIn.service_type`, `ServiceIn.service_type`), to AdminBookingModal + Portal booking pickers, to ServicesSettings admin chip, to ServiceInfoModal default description ("Professional pet photography sessions…"), and to Settings → Service Descriptions panel. Photography is pay-on-the-day (no credit pool) — handled automatically by existing `_service_cost` returning 0 + `_credit_balance_field` returning None.
- ✅ **Boarding stay extension at checkout**:
  - `CheckoutIn` extended with `extra_nights` (0–60), `extra_nights_use_credits` (bool), `extra_nights_rate` (optional float override).
  - `check_out` endpoint extends `booking.end_date` by N days, optionally FIFO-consumes additional boarding credits, then bills uncovered nights at the per-night rate. Writes `extra_nights` audit dict on the booking for income reporting.
  - **Dashboard CheckoutModal**: new "🌙 STAYED EXTRA NIGHTS?" panel (boarding bookings only) with ± stepper, "Use remaining boarding credits first" toggle, per-night rate override, and live charge preview.
- ✅ **End-to-end verified**: photography service created/listed/booked, portal renders all 8 services beautifully, boarding extension test confirmed `end_date: 2026-05-18 → 2026-05-20` with `actual_price: $165` ($55 base + 2 × $55) and audit row written.


- ✅ **New collections:** `trophies` (catalog) + `awarded_trophies` (instances). 15 defaults seeded on startup (6 dog + 9 client), all idempotent via `seed_trophies_if_empty()` so admin edits are never overwritten.
- ✅ **Backend `/app/backend/trophy_service.py`** — central engine: `award_trophy()` (idempotent per `recipient_id`+`code`), `check_dog_trophies()`, `check_client_trophies()`, `render_share_card_png()` (Pillow, 1200×630 social-card).
- ✅ **Auto-award hooks wired into existing endpoints:**
  - `update_goal` (training goal score 5) → re-evaluates Dog trophies (`Quick Learner` / `Skill Master` / `Top Dog` / `Sit Happens Graduate`).
  - `complete_homework` → re-evaluates Client trophies (`Homework Hero` 7-day streak, `Dedicated Owner` / `Coach of the Year` count tiers).
  - `check_out` → re-evaluates Client trophies for the dog's owner (`Regular` / `Loyal Pack Member` / `Sit Happens Legend` visit tiers) AND for the referrer if a referral row was just inserted (`Friend Bringer` / `Pack Builder` / `Ambassador`).
- ✅ **12+ new endpoints** under `/api/trophies/...` + `/api/dogs|clients/{id}/trophies` + `/api/portal/trophies` + `/api/trophies/share-card/{awarded_id}.png` + `/api/trophies/leaderboard`. Admin auth on catalog CRUD + manual award + revoke + leaderboard. Defaults can be deactivated but not hard-deleted.
- ✅ **Frontend:**
  - New `<TrophyBadge>` + `<TrophyWall>` + `<TrophyCelebration>` components with tier-aware styling (bronze/silver/gold/platinum rings, Font Awesome glyphs OR admin-uploaded custom image).
  - New admin **Trophies** nav tab (`/app/frontend/src/screens/Trophies.jsx`) — full catalog manager with live-preview editor, custom-image upload, tier picker, threshold editor, deactivate toggle.
  - **Admin Clients & Dogs** screens — each card now shows a trophy strip + "+ Award" button opening `ManualAwardPicker`.
  - **Admin Dashboard** — new "Top Dogs" + "Top Clients" leaderboard widgets (#1 yellow, #2 silver, #3 bronze ranking).
  - **Client Portal** — new "TROPHY WALL" section between Training Progress and Homework, plus a celebratory modal queue on portal load that shows `NEW TROPHY EARNED!` for every unseen award (auto-marked seen via `/awarded-trophies/{id}/seen`).
  - **Share card PNG** is generated server-side on demand; portal/admin trophy detail modal renders it inline with Download + Copy-share-link buttons.
- ✅ **Testing:** 21/21 backend pytest (`/app/backend/tests/test_iter16_trophies.py`) + frontend smoke via Playwright. Covers seeding, idempotent awards, admin CRUD, auth gating, share-card PNG dimensions, seen-flag, revoke, auto-award on 10th checkout and on 7-day homework streak. Zero bugs found.


- ✅ **Backend** (`server.py`):
  - `GET /api/admin/vaccine-cert-uploads?include_reviewed=false` — lists client-uploaded certs with photo, expiry, owner, uploaded_at, reviewed_at. Defaults to unreviewed-only.
  - `POST /api/admin/dogs/{dog_id}/vaccine-cert/{vaccine}/review` — approves a cert (stamps reviewed_at + reviewed_by). Vaccine expiry untouched.
  - `DELETE /api/admin/dogs/{dog_id}/vaccine-cert/{vaccine}` — rejects: removes the cert AND clears the matching vaccine expiry so the dog is blocked from new bookings until reuploaded.
  - **CRITICAL FIX:** A previous edit had nested these endpoints inside an `if ref_code:` block, causing an `IndentationError` and a stale-cached backend. Hoisted to module level — backend now boots cleanly.
- ✅ **Backend referral hook** moved from "first booking" → **"first completed checkout (any service)"** per user request. Fires from `POST /api/bookings/{booking_id}/check-out`. Idempotent via `referrals` collection guard (`referred_id` lookup). Skips self-referrals. Writes both `referrals` audit row and `credit_adjustments` entry with `{daycare: {before, delta:1, after}}`.
- ✅ **Backend `auth/register`** now accepts `referred_by_code` field — normalizes/uppercases, validates against existing `referral_code`, persists on the new client doc (or stores `null` if invalid/empty).
- ✅ **Frontend** (`Dashboard.jsx`): new "Pending Vaccine Reviews · N" panel between vaccine alerts and first-booking banner. Renders thumbnail (click → lightbox), dog/owner, vaccine pill, expiry, uploaded-at, plus Approve / Reject buttons. Reject uses `useConfirm` to warn about clearing expiry.
- ✅ **Frontend** (`Login.jsx`): auto-detects `?ref=CODE` URL param → flips to Register tab and pre-fills referral code input. Updated copy: "Your friend gets a free daycare day once you finish your first appointment!"
- ✅ **Frontend** (`Portal.jsx`): Refer-a-Friend modal copy updated to reflect new trigger: "After they sign up and complete their first appointment…".
- ✅ End-to-end verified via curl:
  - Referrer at 8 credits → new client registers w/ `?ref=7KTUMQ` → books → credits stay 8 → check-in + check-out → credits jump to 9 → 2nd checkout (different booking) → still 9 (idempotent).
  - Pending list returns/excludes reviewed properly; approve stamps reviewed_at; reject removes cert + zeroes expiry.


- ✅ **Backend** (`server.py`): added `_first_time_bookings_today()` helper called from `/api/dashboard/stats`. Logic: pull bookings created today (uses indexed `created_at` range filter), aggregate by client_id to find each client's earliest booking, include only those whose first-ever booking falls on today. One Mongo aggregation, deduped per client.
- ✅ **Frontend** (`Dashboard.jsx`): new `<First Booking Celebration · N>` banner between the vaccine alerts and the upcoming birthdays. Green/blue gradient pill chips with a paw icon, "{Client} just booked their first {service} for {Dog} · {date}." Auto-disappears the next day. Hidden when zero qualifying bookings.
- ✅ End-to-end verified: dashboard renders the banner with the 3 first-time bookings seeded by the test pipeline today.

## Sprint 33 — Account Claim by Email (2026-02)
- ✅ **Backend** (`server.py`): new `POST /api/clients/{client_id}/send-claim-email` (admin-only) generates a 32-byte `secrets.token_urlsafe` claim token in collection `claim_tokens` `{token, client_id, email, is_reset, used, created_at, expires_at}`. 7-day expiry. Re-callable any time — issuing a new token deletes older unused tokens for the same client. Auto-detects whether to send a "claim" (no user yet) or "password reset" (existing portal user) email.
- ✅ **Backend public endpoints** (no auth): `GET /api/claim/{token}` returns `{valid, client_name, email, is_reset, expires_at}`. `POST /api/claim/{token}` body `{password}` either creates the portal user (claim) or updates the existing user's password (reset), burns the token, and returns an `AuthOut` (JWT + user) so the client is auto-logged in.
- ✅ **Email service** (`email_service.py`): `send_account_claim(...)` reuses the existing branded `_wrap()` template with a step-by-step instructions box ("1. Tap the button below 2. Choose a password 3. You'll be signed in"), a 7-day expiry note, and the PWA install QR footer.
- ✅ **Frontend admin** (`Clients.jsx`): every client card now has a prominent green "Send Claim Account Email" button (or "Send Password Reset Email" if portal account exists). Adding a new client with an email **auto-sends** the claim email on save and shows an inline toast. The manual "Create Portal Login" modal is preserved as a secondary fallback button.
- ✅ **Frontend public** (`Claim.jsx` + `App.js`): new public route `/claim/:token` handled *before* `<AuthProvider>` so unauthenticated visitors can land there. Branded card with Sit Happens logo, welcome message, email confirmation, password + confirm inputs, "Activate Account" CTA. On success, stores the returned JWT in `sh_token` and redirects to `/`, dropping the client straight into their portal.
- ✅ End-to-end verified via Playwright: admin creates a fresh client with an email → toast confirms "Claim email sent" → token stored in DB → public claim URL renders the welcome card → password set → user auto-logged into portal showing onboarding checklist. Zero console errors.

## Sprint 32 — Hotfix: Client Portal Missing useConfirm Import (2026-02)
- ✅ `Portal.jsx` called `useConfirm()` on line 17 without importing it → every client login crashed with "useConfirm is not defined" caught by ErrorBoundary.
- ✅ Added `import { useConfirm } from "../lib/useConfirm";` to Portal.jsx.
- ✅ Scanned all other `.jsx`/`.js` consumers of `useConfirm()` — every one has the proper import. No other missing-import cases.
- ✅ Verified end-to-end: `testclient@sithappens.com` logs in, portal renders credits / dogs / training progress / homework / booking form with zero console errors.

## Sprint 31 — Hotfix: Frontend Compile Errors + Missing ConfirmProvider (2026-02)
- ✅ Removed stray duplicated `);\n}` block trailing the `App` component in `/app/frontend/src/App.js` (lines 163-164) that crashed the bundler.
- ✅ Removed 12 lines of duplicated JSX trailing the proper close of `Settings.jsx` (lines 736-747) that caused a Babel "Adjacent JSX elements must be wrapped" error.
- ✅ **Critical fix:** `ConfirmProvider` was imported in `App.js` but never mounted, so every screen using the `useConfirm` hook (Clients, Dogs, Bookings, Homework, Income, Incidents, Pipeline) threw `useConfirm must be used inside <ConfirmProvider />` and was caught by ErrorBoundary as "Something tripped up." Wrapped `<Gate />` + `<InstallPrompt />` inside `<ConfirmProvider>`.
- ✅ End-to-end verified via Playwright: logged in as admin and successfully navigated all 8 affected screens with zero page errors / zero console errors.

## Sprint 39 — Credit Pack Crash Fix + Per-Client Photo Gallery PIN (2026-02)

## Sprint 40 — "New Photos Available" Nudge (2026-02)
- ✅ Added `photo_gallery_has_new: bool = False` to `ClientIn`. Admin can flip per-client via a new toggle row in the Clients edit modal ("Notify of New Photos" → "New photos badge: ON").
- ✅ Portal CTA "See Your Pup In Action" gets a pulsing orange "NEW" pill, an orange glow shadow, and switched copy ("Fresh photos just dropped!") whenever the flag is set.
- ✅ New endpoint `POST /api/portal/gallery/mark-seen` auto-clears the flag the moment the client clicks the gallery link (fire-and-forget on the client; optimistically clears the badge locally without a reload). Idempotent.

## Sprint 41 — Recurring Schedules + Daily Automation (2026-02)
- ✅ **Recurring Schedule Templates** (#4): new admin sidebar entry **"Recurring"** lets you save per-dog weekly cadences (Daisy · M/W/F daycare) and roll the schedule forward N weeks with one click. Reuses the existing `/bookings/recurring` engine; tracks `last_booked_through` so successive extends start the day after the previously booked window. New endpoints: `GET/POST/PUT/DELETE /api/recurring-templates` + `POST /api/recurring-templates/{id}/extend`.
- ✅ **Daily Jobs runner** (`daily_jobs.py`): lightweight lazy scheduler — triggered the first time the admin loads `/dashboard/stats` each UTC day, gated by `system_runs` so it fires at most once per day. Idempotent per-target via `notification_log` collection. No external scheduler process needed.
- ✅ **Dog Birthday Cards** (#7): on the dog's birthday (MM-DD match), owner gets a celebratory email featuring the dog's first photo as a hero image. De-duped per dog per year.
- ✅ **Vaccine Renewal Nudge** (#6): when any of `rabies / bordetella / dhpp` expires exactly 30 days from today, the owner gets one consolidated email listing every renewal due, with a CTA to upload the new record. De-duped per (dog, target-date).
- ✅ **Settings → Email Automation panel**: shows which jobs are on, plus a "Run Daily Jobs Now" button that bypasses the once-per-day gate and shows sent/skipped counts (handy for testing).
- 🟡 **Parked — S3 photo migration (#10)**: user will set up a Cloudflare R2 account before next session.


- ✅ **Fixed Credit Pack "Add" crash**: FastAPI 422 returns `detail` as an array of error objects; `CreditPacksSettings.jsx` was rendering it raw inside `<p>`, tripping the ErrorBoundary. Added client-side guards (name/qty/price) and routed all server errors through `formatErr` to flatten arrays. Verified empty-name now shows inline "Pack name is required." with the UI staying alive.

## Sprint 42 — Vaccine-First Onboarding Modal (2026-02)
- ✅ **OnboardingChecklist modal** auto-pops on every portal load when the client either has no dog yet OR any required vaccine (`rabies`/`bordetella`/`dhpp`) is missing or already expired. Big orange "Action Required" header, friendly welcome, per-dog list of missing vaccines with one-click Upload buttons that hand off to the existing `VaccineUploadModal`. Has an explicit "Remind me later" dismiss that persists for the browser session via `sessionStorage`.
- ✅ **OnboardingBanner** — a sticky orange strip pinned ABOVE the portal header that's always visible while vaccines are incomplete: "N vaccines need uploading before you can book · FINISH SETUP". Tapping reopens the modal even after dismissal.
- ✅ Designed to coexist with the existing 3-step "Welcome to Sit Happens" banner (profile/dog/waiver) — the modal handles the *specific* vaccine action gap, the existing banner handles initial profile setup.

- ✅ **Per-client Photo Gallery Download PIN**: Added `photo_gallery_pin` field to `ClientIn` (backend) and to the Clients admin edit form (next to gallery URL). Portal renders a compact PIN card under "See Your Pup In Action" with monospace-spaced PIN value and a one-click Copy button (`<GalleryPinRow>` in `Portal.jsx`). Blank PIN = row hidden. Shown only when the client also has a gallery URL.


## Key Files
- `/app/backend/server.py` — All endpoints + models

## Sprint 43 — Add Client + Dog in One Modal (2026-02)
- ✅ The admin **New Client** modal now has an **"Also add a dog"** toggle (default ON) that reveals a compact dog quick-add form: name, breed, age (yrs + mos), sex, fixed status, vaccine expiry dates (rabies/bordetella/dhpp), and notes.
- ✅ Save flow does it in one shot: `POST /clients` → `POST /dogs` with the new owner_id → claim email → load. If the dog POST fails (e.g. malformed vaccine date), the client still saves and a warn toast surfaces the message so the admin can finish the dog from the Dogs screen.
- ✅ Section is hidden when **editing** an existing client (keeps the edit modal lean) and only appears on **New Client** creation.
- ✅ Helper copy under vaccine inputs: "Leave blank if you don't have them yet — the client will be prompted to upload through their portal" — ties cleanly into Sprint 42's onboarding modal.

- `/app/backend/.env` — JWT_SECRET, ADMIN creds, DAYCARE_CAPACITY
- `/app/frontend/src/App.js` — Role-based gate
- `/app/frontend/src/lib/{api,auth}.js` — Axios + AuthContext

## Sprint 44 — Vaccine Cert Attach in New-Client Modal (2026-02)
- ✅ New admin endpoint `POST /dogs/{dog_id}/vaccine-cert` mirrors the portal cert-upload endpoint. Admin-uploaded certs are auto-marked `reviewed_at` so they skip the Pending Vaccine Reviews queue.
- ✅ The quick-add-dog vaccine section now uses a per-row `<VaccineCertRow>` with three entry methods for the cert image: file picker, drag-and-drop onto the row, **or paste from clipboard** (`Cmd/Ctrl+V` while focus is on the row). Thumbnail + Clear button preview after upload.
- ✅ Save flow chains 4 calls automatically: `POST /clients` → `POST /dogs` → up to 3 `POST /dogs/{id}/vaccine-cert` (one per attached cert) → claim email. A failed cert attach doesn't block the rest.
- ✅ Cert photos compressed via `compressImage` before transmission to keep payloads small.

- `/app/frontend/src/screens/` — Login, Dashboard, Schedule, Bookings, Clients, Dogs, Portal
- `/app/memory/test_credentials.md` — Login credentials


## Sprint 45 — Trophy Share PNG Reads the Uploaded Image (2026-02)
- ✅ Fixed the long-standing bug where every shared trophy showed the same hard-coded `★` glyph — the renderer (`trophy_service.py::render_share_card_png`) now reads `trophy_custom_image` and pastes it into the centre of the tier ring with a circular mask. Falls back to the star glyph cleanly when no image is uploaded.
- ✅ Snapshots `trophy_custom_image` onto every new award record so historical shares keep their visual even if the admin later edits or removes the catalog image.
- ✅ The public `/api/trophies/share-card/{awarded_id}.png` endpoint backfills the image from the live catalog for awards minted before the snapshot existed, so existing trophies start showing the right image the moment an admin uploads one.
- ✅ Fixed a related call-site bug in `Trophies.jsx` where `compressImage(f, 256, 0.85)` was passing positional args to an options-based API — now uses `{maxWidth: 512, maxHeight: 512, quality: 0.85}` for a sharper trophy thumbnail.
- ✅ End-to-end verified: uploaded a solid-red test image → awarded → share PNG centre pixel was `(220, 30, 30)`. With no image → centre showed the tier ring fill colour with the ★ glyph (fallback works).


## Sprint 46 — Unenroll, Cascade Program Edits, Unlimited Daycare Booking Range (2026-02)
- ✅ **Unenroll button** on every active enrollment in the Dog → Training tab. Triggers a confirm dialog ("Progress preserved in History · resume any time"), then flips the enrollment to `withdrawn` and clears the dog's active-program pointer. Stays in History → "Resume" button can reactivate.
- ✅ **Cascade program edits**: `PUT /api/programs/{id}?cascade=true` now syncs the updated snapshot to every active enrollment of that program. Goal scores survive when goal IDs match; new goals start "not started"; removed goals' progress is dropped silently. Editor UI auto-counts active enrollments and shows a confirm dialog *"Apply changes to N enrolled dogs?"* (Yes → cascade, No → only future enrollments use the new version). New helper endpoint `GET /api/programs/{id}/active-enrollments-count`.
- ✅ **Daycare advance-days cap lifted** for clients: `create_booking` now exempts `service_type=daycare` from the `max_advance_days` rule, so recurring schedules can run any distance into the future. Boarding/training/grooming still respect the cap. Verified: client booked daycare 120 days out (success), client booked boarding 120 days out (blocked with the 60-day message).


## Sprint 47 — Client Recurring Schedules + Schedule Auto-refresh (2026-02)
- ✅ **Role-aware `/recurring-templates`**: all five endpoints (list / create / update / delete / extend) now accept clients via `get_current_user`. Server-side scoping ensures clients only see/modify templates for their own dogs. Helper `_assert_dog_owned_by_client` blocks cross-client tampering with a 403 "Not your dog".
- ✅ **Training restriction respected**: clients attempting to create or move a template onto `service_type=training` get a 403 with the same "request a free evaluation" copy used elsewhere in the portal.
- ✅ **`MyRecurringModal` on the Portal**: new Quick Link → "My Recurring Schedules" opens a focused modal with list ↔ form steps. Mirrors the admin Recurring screen: dog dropdown, weekday picker, default-extend-window input, notes, Extend button with progress toast. Hidden when the client has no dogs yet.
- ✅ **Schedule.jsx auto-refresh**: added `visibilitychange` + window `focus` listeners that re-fetch `/events` whenever the user returns to the calendar — defends against the "I just created bookings and they don't show up" problem regardless of which screen created them.


## Sprint 48 — Recurring Start-Date + Day Roster + Timed Training Events (2026-02)
- ✅ **Start-on date** added to `RecurringTemplateIn`. First extend honors it (if in the future); subsequent extends advance from `last_booked_through` as before. Both admin and client recurring UIs have the new date picker with the "leave blank to start today" hint.
- ✅ **Day Roster modal** on the Schedule: clicking any day opens an overlay listing every booking that day (with service color chips and the assigned time for training/grooming), plus a "+ New Appointment for this day" CTA that opens an inline quick-add form (dog / service / time / notes / boarding end-date / grooming type).
- ✅ **Training & grooming bookings now timed** — `BookingIn` accepts `time` (HH:MM), `create_booking` persists it, and the `/events` endpoint promotes timed bookings to ISO datetime events with `allDay:false`. Title prefixed with the time. Training defaults to 1-hour duration, grooming 1.5 hours. FullCalendar config: `displayEventTime`, 12-hour meridiem format.
