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

## Sprint 31 — Hotfix: Frontend Compile Errors (2026-02)
- ✅ Removed stray duplicated `);\n}` block trailing the `App` component in `/app/frontend/src/App.js` (lines 163-164) that crashed the bundler.
- ✅ Found and removed a second related issue — 12 lines of duplicated JSX trailing the proper close of `Settings.jsx` (lines 736-747) — which was Babel's "Adjacent JSX elements must be wrapped in an enclosing tag" error revealed once App.js compiled.
- ✅ ESLint clean across `/app/frontend/src`; login screen renders correctly in preview.

## Key Files
- `/app/backend/server.py` — All endpoints + models
- `/app/backend/.env` — JWT_SECRET, ADMIN creds, DAYCARE_CAPACITY
- `/app/frontend/src/App.js` — Role-based gate
- `/app/frontend/src/lib/{api,auth}.js` — Axios + AuthContext
- `/app/frontend/src/screens/` — Login, Dashboard, Schedule, Bookings, Clients, Dogs, Portal
- `/app/memory/test_credentials.md` — Login credentials
