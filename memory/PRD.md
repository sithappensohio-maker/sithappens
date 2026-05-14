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

## Key Files
- `/app/backend/server.py` — All endpoints + models
- `/app/backend/.env` — JWT_SECRET, ADMIN creds, DAYCARE_CAPACITY
- `/app/frontend/src/App.js` — Role-based gate
- `/app/frontend/src/lib/{api,auth}.js` — Axios + AuthContext
- `/app/frontend/src/screens/` — Login, Dashboard, Schedule, Bookings, Clients, Dogs, Portal
- `/app/memory/test_credentials.md` — Login credentials
