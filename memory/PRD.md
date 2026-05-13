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
- ✅ **Settings → Backup & Restore tab** — one-click download with date-stamped filename, drag-drop file picker with preview (shows per-collection doc counts + export timestamp), mode selector with red warning on Replace, confirm dialog before restore.
- ✅ Note for user: Emergent production deployments persist MongoDB across redeploys; backups are for accidental deletion / migration safety net.

## Backlog / Next Iterations (Prioritized)
**P1**
- Boarding capacity rule (currently only daycare enforces capacity)
- Email/SMS notification when booking is approved/rejected
- Vaccine expiry alerts banner on admin dashboard with click-to-dog
- Waiver upload/sign flow per client

**P2**
- Photo gallery per dog (multiple photos)
- Recurring bookings (e.g., every Tue/Thu for 4 weeks)
- Stripe credit pack purchases via client portal
- Tag-based training filter & progress chart
- CSV export of bookings/clients
- Mobile responsive polish (sidebar drawer)

**P3**
- Multi-staff accounts with audit log
- Calendar drag-and-drop reschedule
- Per-service pricing (vs flat credit cost)

## Key Files
- `/app/backend/server.py` — All endpoints + models
- `/app/backend/.env` — JWT_SECRET, ADMIN creds, DAYCARE_CAPACITY
- `/app/frontend/src/App.js` — Role-based gate
- `/app/frontend/src/lib/{api,auth}.js` — Axios + AuthContext
- `/app/frontend/src/screens/` — Login, Dashboard, Schedule, Bookings, Clients, Dogs, Portal
- `/app/memory/test_credentials.md` — Login credentials
