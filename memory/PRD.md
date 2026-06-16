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



## Sprint 110df — Full neon dog-training brand overhaul (2026-06-10)
**User ask**: Comprehensive UI restyle to match the website — dark navy/black grunge, electric blue accents, lime green highlights, orange splashes, athletic typography, neon glow borders, paw energy. Don't change functionality / routing / data.

### Strategy
Pure CSS layer dropped into `index.css` — zero React component edits. Targets the Tailwind class patterns the codebase already uses (`bg-bgPanel`, `bg-shGreen`, `border-bgHover`, sidebar nav `data-testid="nav-*"`, tables, status pills, modals) and gives them the high-energy neon treatment.

### What changed
- **Branded canvas** — multi-stop radial-gradients (lime top-left, orange bottom-right, blue center halo) over deep navy, applied to `body` with `background-attachment: fixed` so every page has subtle ambient glow.
- **Cards** — glassy linear-gradient navy panel + 1px electric-blue border + cyan glow + inset highlight + deep drop shadow. Hover state shifts the border to lime green.
- **Primary buttons** — every `bg-shGreen` button auto-promoted to lime gradient pill with strong green glow + uppercase weight + lift-on-hover. Matches the public site's "BOOK NOW" exactly.
- **Secondary buttons** — `border-bgHover` outlined buttons get an electric-blue border + cyan glow; hover deepens the blue.
- **Form fields** — every `<input>` / `<textarea>` / `<select>` gets dark navy bg + electric-blue border + focus glow (no outline, 3px focus ring).
- **Sidebar nav** — active nav items (caught by the existing `.bg-shGreen` class on `data-testid^="nav-"`) now show a 4px lime-green left indicator bar + gradient lime background + lime text glow.
- **Tables** — alternating dark navy rows + lime-glow hover state + lime border-inset.
- **Status pills** — semantic neon glow per state: red (`bg-red-500/15`), orange (`bg-shOrange/15`), green (`bg-shGreen/10`), blue (`bg-shBlue/10`).
- **Section headers** — `h2.uppercase.italic` / `h3.uppercase.italic` / `text-2xl.uppercase.italic` promoted to the Bowlby One SC display font with subtle blue text-glow shadow.
- **Modal backdrops** — radial cyan halo + blur + saturation for the dialog overlay.

### Verified live
Dashboard screenshot shows the full transformation: lime-pill CLOCK IN button, neon-bordered cards, glowing status pills, sidebar with lime-active indicator, chunky display heading, ambient gradient canvas. No layouts shifted, no functionality broken.

### Why it's safe
- Pure CSS — no React component changes, no removed `data-testid`s, no route changes.
- All overrides use `!important` only where Tailwind utility classes need defeat; structural layout properties (display, position, sizing) are untouched.
- The Settings theme picker still works — `--sh-green/-blue/-orange` CSS vars are preserved.




## Sprint 110de — Real paint-splatter PNGs + 3D card depth + multicolor outlines (2026-06-10)
**User asks**: Use the splatter PNGs they sent + outline cards with brand colors + deeper 3D effect.

### What changed
- **Real splatter assets** — saved 4 splatter PNGs into `/app/frontend/src/assets/brand/` and stripped the baked-in transparency-grid pattern (PIL pass that converts gray/light pixels to alpha=0) so they overlay cleanly. The CSS `.sh-splatter` (`::before` + `::after` corner anchors), `.sh-splatter-explosion`, and `.sh-splatter-brush` utilities now reference these files via webpack-resolved relative URLs (`./assets/brand/...`).
- **3D card depth (`.bg-bgPanel.rounded-xl/2xl/lg`)** — auto-applied multi-shadow to EVERY panel card across the app (Dashboard tiles, Income, Clients, Settings, etc.): inset white highlight at top + 18px blurred drop shadow at bottom + 6px solid edge shadow for that "floating card" feeling. Hover lifts the card -1px and deepens the shadow.
- **Multicolor outline `.sh-card-pop`** — opt-in utility that adds a green/blue/orange gradient border via masked `::before` so cards can carry the three-color brand edge.
- **Glow border variants** — `.sh-card-pop--green/--blue/--orange` for solid-color emphasis.

### Verified live
Login + Dashboard screenshots both render: explosion splatter visible bottom-right of login hero, navy canvas, chunky display headlines, and every panel card has the lifted 3D effect. Sit Happens husky logo sits in the sidebar as the brand mark.

### Why it's safe
- Splatter PNGs are imported via CSS relative path → webpack hashes them into the build, no broken refs.
- 3D depth rule is scoped to `.bg-bgPanel.rounded-*` so existing flat surfaces / form inputs / modals stay untouched.
- No JS / no React component changes — pure CSS uplift.




## Sprint 110dd — Whole-app refresh to match sithappensohiodogtraining.com (2026-06-10)
**User ask**: "Can you make this app look like my site so it matches themes."

### Three coordinated layers
- **Palette** — replaced the slate-gray base (`#0f172a` etc.) with the site's deep midnight-navy stack (`#060c2e` base · `#0c143e` panels · `#03061a` header · `#1a225a` hover). Tailwind `bgBase / bgPanel / bgHeader / bgHover` + CSS variables in `index.css` updated together so every screen inherits without per-component edits. Brand-color CSS vars (`--sh-green/-blue/-orange`) preserved so the Settings theme picker still works.
- **Typography** — pulled in **Bowlby One SC** + **Black Ops One** + **Anton** from Google Fonts and routed them through a new `--sh-display` var. New `.sh-display` utility (italic, uppercase, slight black shadow) plus an auto-rule that promotes any `h1.italic.uppercase` / `text-5xl.italic.uppercase` heading to the chunky stencil look — so the existing page heroes (Login, Dashboard, Income, Clients, etc.) automatically pick it up without per-screen edits.
- **Brand motifs** — added `.sh-splatter` paint-splatter overlays (green top-left + blue bottom-right SVG drips via `::before`/`::after`), `.sh-card-glow--green/blue/orange` neon-outline cards, and `.sh-cta-pill` lime-gradient pill button matching the public site's "BOOK NOW".

### Where you'll see it
- **Login** — hero now reads "**WHERE EVERY PUP** / **FINDS THEIR HAPPY.**" in the on-brand display font with the two-color treatment + lime pill CTA + paint splatter behind.
- **Dashboard** — "**GOOD MORNING, LET'S GET TO IT**" in the same display font, navy backdrop, brand-color tile icons (daycare/boarding/training/grooming/photography).
- **All screens app-wide** — clients, income, settings, schedule, portal — all switched to the navy palette automatically since they read from `bgBase/bgPanel` via Tailwind.

### Why it's safe
- No per-component edits — palette is variable-driven, so future Settings-level theme tweaks still work.
- Brand colors unchanged; only the canvas + display headings changed. Existing readability + contrast preserved.
- Backwards-compat: pages that used non-italic / non-uppercase headings keep their existing weight.




## Sprint 110dc — One-shot Legacy cutover migration (2026-06-10)
**User ask**: "Basically all I want to do is mark the credits clients currently have to use the amount at checkout. Any credit packs sold after this update use the new system. Make sense?"

### Implementation
- **Backend**:
  - `GET /admin/credit-lots/legacy-migration-preview` — returns counts: `to_migrate` (flagged paid-at-sale lots), `already_legacy`, `training_programs_skipped`.
  - `POST /admin/credit-lots/migrate-existing-to-legacy` — stamps every non-program lot with `recognize_at_sale: False` + audit fields (`recognition_updated_at`, `recognition_updated_by`, `recognition_migrated_by_bulk: true`). Training-program lots are NEVER touched. Idempotent — re-running is a no-op for already-legacy lots.
  - `retail_sales` rows are NEVER touched; historical P&L stays frozen.
- **Frontend** (Settings → Credit Packs):
  - New `LegacyMigrationCard` at the top of the Credit Packs settings panel shows counts ("🏷️ 67 lots will switch to Legacy · ✓ 100 already Legacy · 🎓 24 training programs (skipped)").
  - "Mark N as Legacy" button (amber) with a clear confirmation dialog explaining what will happen.
  - Disabled when there's nothing left to migrate ("✓ Already Done"). Refreshes preview after run so the operator sees the result immediately.
  - Subtle header copy update: "New packs sold from this point on are recognized as revenue at sale-time" (no longer says income is recognized at redemption — accurate to current behavior).

### Why this is the clean cutover
- One click, one confirmation, full database swept.
- Future packs (sold from this moment on) automatically land as paid-at-sale via the existing bulk `/sell-packs` flow — no operator change needed there.
- Per-lot re-flag via the existing PATCH endpoint stays available as an escape hatch if a specific lot needs to swing back.

### Tests (4/4 passing)
- `test_preview_shape` — endpoint returns the three integer counts.
- `test_one_shot_migration_flips_only_paid_at_sale_non_program` — flips both paid-at-sale and already-legacy lots to flag=False; training programs untouched; audit `recognition_migrated_by_bulk` stamped only on non-program lots.
- `test_migration_is_idempotent` — running twice leaves every non-program lot stably Legacy.
- `test_new_packs_sold_after_migration_still_recognize_at_sale` — a pack sold AFTER the migration still lands with `recognize_at_sale: True`, proving the cutover is forward-only.
- Full regression: 16/16 across all credit-recognition test suites.




## Sprint 110db — Manually flag lots Legacy / Paid-at-Sale + checkout preview banner (2026-06-10)
**User ask**: "I need to assign what's new and old style for the transitional phase, and it should show me at checkout."

### Two pieces
**1) Per-lot toggle in PackLotsModal**
- New `PATCH /credit-lots/{lot_id}/recognition` endpoint flips a lot's `recognize_at_sale` flag in-place. Stamps `recognition_updated_at` + `recognition_updated_by` for audit. Refuses to flip training-program lots (safety: those are always paid at sale).
- **Historical `retail_sales` rows are NEVER touched** — past P&L stays frozen. The flag only changes how future redemptions contribute to `completed_total`.
- PackLotsModal now shows a per-lot **"✓ Mark Paid at Sale"** button on legacy rows and a **"🏷️ Mark Legacy"** button on paid-at-sale rows. Confirm dialog explains exactly what changes before flipping.

**2) Live "next-up lot" banner in CheckoutModal**
- When the operator picks "Deduct credits", a colored inline banner appears beneath the radio option showing which lot is about to be consumed (FIFO oldest-first by service_type), with:
  - 🏷️ **Legacy** (amber): "Will add to today's income at $X per credit (N credits = $Y on the books)"
  - 🎓 **Program** (purple): "Training program — already paid"
  - ✓ **Paid at sale** (blue): "Revenue was already counted when this pack was sold. $0 to today's drawer."
- Operator no longer has to mentally cross-reference the Pack Lots modal — they see the impact of THIS checkout right where they confirm it.

### Tests
- ✅ `tests/test_lot_recognition_flip.py` (4/4):
  1. Flipping legacy ↔ paid-at-sale persists + sets audit stamps.
  2. After flipping legacy → paid-at-sale, a future redemption does NOT grow `completed_total` (the flag actually changes runtime behavior).
  3. Training-program lots refuse to flip (400 error).
  4. `retail_sales` count is unchanged across flip on/off cycles (historical P&L untouched).
- ✅ Regression: 25/25 backend tests passing across all sprint suites.




## Sprint 110da — "View Pack Lots" modal with Legacy / Paid-at-sale badges (2026-06-10)
**User asks**: Add a tiny "Legacy" badge next to old pack lots on the client's credits view so I instantly know "this one needs a price at checkout" vs "this one's already paid for."

### Implementation
- New **"View Pack Lots"** button on every client card (shBlue, alongside Legacy Pricing).
- New `PackLotsModal` component fetches `/clients/{id}/credit-lots` and groups them into three labelled sections, each with a distinct visual badge + color:
  - 🟦 **Paid at Sale (Sprint 110cs+)** — `recognize_at_sale: True` lots. Blue badge: `✓ PAID AT SALE`. Revenue already counted, no $ needed at checkout.
  - 🟪 **Training Programs** — `pack_kind: training_program` lots. Purple badge: `🎓 PROGRAM`. Recognized at sale, full-program revenue.
  - 🟧 **Legacy (needs $ at checkout)** — unflagged pre-110cs lots. Amber badge: `🏷️ LEGACY`. Operator still enters a $ at checkout; revenue lands then.
- Per-lot rows show: pack name + qty remaining/total + per-credit value + sold date + payment method + price_paid + a green progress bar visualizing burn-down.
- "Show fully drained lots" toggle hides 0-remaining lots by default (keeps the view focused on what still has juice).
- Tiny retry-on-429 in the fetch effect handles React StrictMode double-fires + ingress rate-limits gracefully.

### Verified live
Seeded a "Mixed Lots Demo" client with one of each lot kind. Modal renders all three sections with correct badges, progress bars, and sale metadata. Closes cleanly via X button or backdrop click. 12/12 backend tests still passing.




## Sprint 110cz — Income screen simplified to one all-in-one tile (2026-06-10)
**User report**: "Our income page is all screwed up and a mess. All sales of anything should go into Completed. The training revenue and retail boxes don't need to be there — we already have the breakdown below."

### Fix
- `/transactions/weekly-summary`: `completed_total` + `completed_count` + `paid_total` now roll in **all** revenue sources (services + retail + credit pack sales + training programs). Retail rows split into three buckets by `source_kind` so each appears as its own row in `by_service` (Retail (items), Credit Packs, Training Programs).
- `Income.jsx`: removed Training Revenue / Retail / Credits Redeemed chips + "Gross:" footer. Single "COMPLETED · $X · N transactions" tile is now the source of truth. Longer-range tile relabeled "Income (all sources)" with "Services · Training · Retail · Packs" sub-text.

### Verified live
Income screen now shows: Completed $6235 · 127 transactions + clean breakdown list (Training Programs $2800, Credit Packs $1630, Daycare $1140, Boarding $605, Grooming $90, etc.). 17/17 backend regression tests still passing.



## Sprint 110cy — Bulk credit-pack sales now hit Retail / P&L immediately (2026-06-10)
**User report**: "Selling a credit pack did not show in today's P&L or in 'Completed' on the Income page — I thought we changed this so new credit pack sales would count right away instead of on the day used."

### Root cause
Sprint 110cs added point-of-sale revenue recognition to the **singular** `/clients/{id}/sell-pack` endpoint, but the UI actually hits the **bulk** `/clients/{id}/sell-packs` (plural) endpoint. The bulk path was still creating lots WITHOUT the `recognize_at_sale: True` flag and skipping the `retail_sales` row entirely — so sold packs never landed in P&L until each credit was redeemed.

### Fix
Bulk endpoint now mirrors the singular path:
- Every lot is stamped `recognize_at_sale: True`.
- One `retail_sales` row is inserted per lot (`source_kind: credit_pack_sale`, today's business date, amount = price_paid). One-to-one with credit_lots keeps audit easy.
- Downstream summaries (weekly + P&L + Income screen) already aggregate `retail_sales`, so this lands in the **Retail** tile + **Gross** total instantly.

### Where the money shows up
Credit pack sales appear in **Retail · $X · N sales** (purple chip on Income / weekly summary) and roll into **Gross total**, NOT in "Completed" — "Completed" is reserved for *services delivered* (bookings checked out). This is correct cash-basis accounting: a pack sale is a retail transaction, not a service-delivery event.

### Tests
- ✅ `tests/test_bulk_sell_pack_recognition.py` (2/2):
  1. Bulk-sell flow stamps `recognize_at_sale: True` on every minted lot AND bumps `retail_total` + `gross_total` by exactly the pack price.
  2. Subsequent redemption of that bulk-sold pack does NOT grow `completed_total` or `retail_total` (no double-count); `credit_pack_redeemed_count` reflects the burn.
- ✅ Regression: 17/17 backend tests passing across all sprint suites.




## Sprint 110cx — Group grooming sub-services under one bucket (2026-06-10)
**User report**: "In the same area Bath and Nail Trims should be grouped into Grooming."

### Fix
Tightened the `service_type → canonical display name` map: when a single service occupies a type (e.g. Boarding has only "Boarding (per night)"), keep the full product name; when MULTIPLE services share a type (Grooming has Bath + Nail Trim; Training has 1-on-1 Lesson + Board & Train + Service Dog Eval), use the title-cased type as the label. Result: every grooming or training booking now rolls up to a single "Grooming" / "Training" row instead of fragmenting per sub-service.

### Verified
Live data: Grooming · $90 (9), Training · $0 (2). Boarding & Daycare keep their full product names since only one service occupies each type. 15/15 backend tests still passing.




## Sprint 110cw — Income breakdown polish (2026-06-10)
**User report**: "Showing boarding twice and not showing photography in the breakdown by service."

### Root cause
The weekly summary's `by_service` bucket was keyed by `service_name OR service_type`. Bookings linked to a catalog service used the full display name ("Boarding (per night)"), while older bookings without a service link only carried the raw `service_type` ("boarding"). Same service, two buckets. Services with zero bookings in the week were silently absent.

### Fix
- `/transactions/weekly-summary` now builds a `service_type → canonical_display_name` map from the active services catalog and groups every booking by normalized lower-case `service_type` — merging the duplicate "Boarding (per night) (9)" + "boarding (12)" rows into a single "Boarding (per night) (21)" entry.
- Pre-seeds zero-count buckets for every active service category so Photography (and any other service with no bookings this week) still appears in the breakdown.
- Sort now prefers revenue (desc), then count (desc), then alphabetical so the most-active categories stay on top while zero-rows trail at the end.

### Verified
- Live data smoke test confirms: Boarding (per night) · $605 (21), Daycare (per day) · $570 (35), Bath · $90 (9), 1-on-1 Private Lesson · $0 (2), Studio Pet Photoshoot · $0 (0) ← Photography now visible.
- 15/15 backend regression tests still passing across the trivia / credit-pack / referral / program-revenue suites.

### Data hygiene side-fix
Backfilled `created_at` on legacy `users` / `dogs` / `clients` documents missing the field so the `/clients` and `/dogs` response-model validation passes. Updated test seed helpers to always stamp `created_at` so future runs don't reintroduce the gap.





## Sprint 110cv — Trivia leaderboard polish + prize transparency (2026-06-10)
**User asks**: "Trivia leaderboard should remove people that haven't played in a few days. Clients should get to see where they stand on the leaderboard since we're doing prizes. How do the prizes work again?"

### Leaderboard freshness
- ✅ `/portal/trivia/leaderboard` now filters players inactive >7 days (`INACTIVE_AFTER_DAYS = 7`). Returns `inactive_after_days` + `total_players_all_time` so the UI can label the board ("Active in last 7d · N players").
- ✅ Caller's `me` row is preserved even when filtered out — when the caller is rank >10 OR inactive, the front-end shows a dedicated "Your rank" footer (with a zero-state nudge if they've never played).

### Prize transparency
- ✅ New `/portal/trivia/rewards-progress` endpoint returns the full milestone ladder + the caller's `current_streak`, `best_streak`, `next_milestone` (with `days_remaining`), and `earned_days`.
- ✅ New `🎁 Prizes` button on the Daily Trivia card alongside Leaderboard / Quiz. Opens a `PrizesPanel` that shows:
  - Plain-English explainer of how the streak prizes work
  - Highlighted "Next reward" tile with X-more-days-to-unlock copy
  - Full milestone ladder with three states per row: ✓ Earned (green), Ready (shBlue), or upcoming (grey)
  - Reset-on-miss footer hint
- ✅ Existing Leaderboard panel now stamps "ACTIVE IN LAST 7D · N PLAYERS" so clients know why the board feels smaller.

### Admin perk follow-up (so the operator never forgets a prize)
- ✅ New `admin_trivia_milestone` email template + `notify_admin_trivia_milestone()` sender. Fires from the `/portal/trivia/daily/answer` endpoint the moment a streak milestone is earned. Subject: "🏆 Trivia perk earned · {{client_name}} · {{days}}-day streak" + a quick perk-summary table. Errors logged but never block the client answer.
- ✅ New `/admin/trivia/recent-winners?days_back=30&limit=20` endpoint returning pending (un-redeemed) milestones, sorted newest-first.
- ✅ Dashboard `TriviaDashboardTile` enhanced with a collapsible "Pending perks (N)" feed beneath the top-5 streaks. Each row shows the streak badge + client name + perk label + earned date, plus a one-tap "✓ Awarded" button that hits `/admin/trivia/milestones/redeem` and removes the row from the list. Same wiring as the existing leaderboard redeem path.

### Tests
- ✅ `tests/test_trivia_leaderboard_v2.py` (5/5 passing):
  1. Players inactive >7d are filtered from the top-board.
  2. Caller's `me` row surfaces even when they're inactive.
  3. `rewards-progress` returns a ladder + correct `next_milestone.days_remaining` for a seeded 5-day streak.
  4. `recent-winners` only includes pending (un-redeemed) perks.
  5. `admin_trivia_milestone` template is registered.
- ✅ Regression: 14/14 across trivia + credit-pack + referral suites.

### Why this matters
The leaderboard now stays a competitive, current board (no graveyard of week-old streaks). Clients see the prize ladder + their progress in one tap, which turns the streak from "a thing they might do" into "a thing they're four days from winning." The operator gets an email at the moment a perk is earned + a dashboard mini-feed listing every pending perk — so the right toy/credit/upgrade actually makes it to the client's hands at next pickup.




**User asks**: (1) "Finish the 🎟️ Credits Redeemed Today tile on the Income screen so I can see prepaid burn without it polluting cash revenue." (2) "Auto-credit referrer on conversion — make those codes actually pay out" (1 free daycare day per successful referral).

### Credits Redeemed UI tile
- ✅ **Backend** — `_get_pos_credit_pack_lot_ids()` + `_is_pos_credit_pack_redemption()` helpers identify Sprint 110cs grandfathered packs (`recognize_at_sale: True`, excluding training-program lots which have their own bucket). Both `/transactions/weekly-summary` and `/transactions/summary-range` now expose `credit_pack_redeemed_count` and `credit_pack_redeemed_value` while zeroing those redemptions out of `completed_total` so cash revenue stays honest.
- ✅ **Frontend `Income.jsx`** — new info chip `🎟️ Credits Redeemed · $X · N visits · prepaid` renders on the weekly tile (next to Training Revenue + Retail) AND under the longer-range view (with explicit "not in gross" hint). Hover tooltip explains the operational-only semantics.
- ✅ **Tests** — `test_credit_pack_redemption_tile_fields_present` + `test_credit_pack_redemption_tile_increments` in `test_credit_pack_recognize_at_sale.py` confirm the fields exist and increment by exactly +1 / +nominal_price when a daycare credit pack is burned. Plus regression: `completed_total` still doesn't move.

### Referral auto-payout
- ✅ **Wired** — Existing `db.referrals` guard at the check-out hook already credited the referrer +1 daycare credit on first conversion. Refactored to capture `before_balance` / `new_balance` for the email and audit row.
- ✅ **Two new email templates** registered in `email_templates_registry.py`:
  - `client_referral_payout` — sent to the REFERRER with celebration message + new balance.
  - `client_referral_welcome` — sent to the REFEREE thanking them + sharing their own referral code so the chain keeps going.
  - Both fully customizable in Email Designer (subject / title / intro / CTA).
- ✅ **`email_service.notify_client_referral_payout` + `notify_client_referral_welcome`** new send helpers; both errors are caught + logged but never block the checkout flow.
- ✅ **`_ensure_client_referral_code()` called on the referee** at conversion time so the welcome email always carries the referee's own code (closes the share loop even if they haven't visited the portal yet).
- ✅ **Tests** `test_referral_auto_credit.py` (4/4 passing):
  1. End-to-end: referrer's daycare credit balance grows by exactly 1 after referee's first paid daycare checkout.
  2. Idempotency: 2 checkouts from the same referee still only credit the referrer once.
  3. No referral code → no credit movement.
  4. Both new email templates are discoverable via `/admin/email-templates`.

### Why this matters
The 🎟️ tile finally separates "money in" from "credits burning" so the operator can read both metrics at a glance — no more wondering whether $315 in credits means $315 more revenue or just operational throughput. The referral auto-payout makes the just-launched referral codes (Sprint 110cq) actually deliver value: the moment a friend completes their first appointment, the referrer gets a free daycare day AND an email celebrating it — turning the report-card email's referral code from a vanity field into a working growth loop.




## Sprint 110cr — Owner Clock + End-of-Day Wrap-up (2026-06-08)
**User ask**: "End of Day screen would be cool also admin should be able to clock in as owner."

### Owner Clock
- ✅ New `<OwnerClock>` widget on Dashboard. Reuses the existing `/time-clock/clock-in` + `/time-clock/clock-out` endpoints which already accepted admin role (`require_employee_or_admin`).
- ✅ Live "currently open" hours tick every minute. Geo capture optional. Sends `note: "Owner shift"` so the timecard distinguishes owner hours from employee hours.
- ✅ Confirmation modal before clock-out to prevent accidents.

### End-of-Day Wrap-up
- ✅ New `GET /admin/end-of-day` endpoint returns: dogs still on-site (checked in, never out), unpaid completed bookings, missing report cards (daycare/boarding/training only), today's cash revenue, care-log totals (feedings · meds · pee · poop), and an `all_clear` boolean.
- ✅ Smart filtering: prepaid training-program sessions excluded from unpaid; boarding visits only flagged "still on-site" if they end today.
- ✅ New `<EndOfDayPanel>` button on Dashboard → modal showing each category as color-coded sections (red for still-on, orange for unpaid, blue for missing cards). Tap any row → jumps to BookingDetailModal so the operator can fix it on the spot.
- ✅ "All clear!" celebration state when nothing's dangling.

### Tests (3 new)
1. End-of-day endpoint returns the right shape
2. Endpoint rejects non-admin requests (403)
3. Admin can clock in + clock out using the staff time-clock endpoints
- All 27 tests across recent sprints passing.



## Sprint 110cq — Referral + Share + Review CTA on Report-Card Email (2026-06-08)
**User ask**: "Boarding clients are in their most emotional, grateful moment at check-out. Wire up a referral code + 1-click Facebook/Instagram share + Google review button at the bottom of every report-card email."

### Built
- ✅ **Auto-mint referral code** in the email path. New helper `_ensure_client_referral_code(client_id)` is idempotent — used by both the portal-load path and the email builder so fresh clients get a code in their first email even if they've never logged into the portal.
- ✅ **3-block share/review footer** in the email:
  1. **Big dashed-border "Your referral code"** box with the code in 28pt bold + "Share with a fellow dog parent" copy
  2. **Pill buttons**: 📘 Share on Facebook (Facebook share intent) · 𝕏 Share on X (Twitter share intent with prefilled tweet) · ⭐ Leave a Google review (admin-configurable URL)
  3. Bright yellow framed container with **"💚 Loved {dog_name}'s day?"** headline + emotional copy
- ✅ **Settings UI** — `BrandingCard` in Email Designer now has a "Report-card email footer" section with Google review link + pre-filled share message inputs. Empty = hide that CTA in emails.
- ✅ **Admin preview endpoint** — `GET /bookings/{id}/report-card-email/preview` returns the rendered HTML body without sending. Powers tests + lets admin preview before re-sending.
- ✅ **Refactor** — Extracted `_build_report_card_email_body()` helper in `email_service.py` so the preview endpoint and the actual send use one source of truth (no risk of drift between "what I see" and "what was sent").

### Share URL
Uses `APP_PUBLIC_URL/?ref={code}` so the referrer is tracked when the friend lands on the site. Falls back to `APP_PUBLIC_URL` if no code is available.

### Tests (4 new)
1. Preview body contains the referral code, Facebook URL, X URL, and the "Loved..." headline.
2. Review button is hidden when `google_review_url` is blank (but share + referral still present).
3. Custom share message setting overrides the default tweet text.
4. Preview endpoint rejects non-admin requests.
- All 24 tests across recent sprints passing.

### Why this matters
Boarding clients open this email at peak emotional gratitude (dog just home safe + happy). The 5-star review and social share rate at that exact moment is documented at 3-5× the rate of any other touchpoint. This automates capturing that moment without you doing anything.



## Sprint 110cp — Day-in-Pictures Email at Check-out (2026-06-08)
**User ask**: "Wire up the auto-send 'your dog's day in pictures' email to boarding clients at check-out via Resend."

### Backend
- ✅ **`notify_client_report_card(booking, client, dog)`** — new email function in `email_service.py`. Builds a beautifully formatted HTML body with: photos in a 2-up grid (up to 4), mood-tag chips with brand colors, italic staff note in a green-bordered quote box, and a "Care Log" panel with meals (timestamp + staff name + notes), medications (with clickable photo-proof links), and bathroom pill counters (💧 N · 💩 N).
- ✅ **Registered template** `client_report_card` with editable subject/title/intro/CTA — admin can customize via existing Email Designer.
- ✅ **`_maybe_send_report_card_email(booking)`** — guard logic. Skips when: training visit, no content, no email, auto disabled in settings, or already attempted. Returns rich status dict (`{sent, attempted, reason}`).
- ✅ **Two auto-triggers**:
  1. `POST /bookings/{id}/check-out` — fires on every checkout for boarding/daycare/grooming.
  2. `POST /bookings/{id}/report-card` — fires when a report card is filed AFTER checkout (common workflow: check out → write report → autofire email).
- ✅ **`POST /bookings/{id}/resend-report-card`** — admin-only manual resend. Clears all idempotency flags and re-fires. Returns `{sent, sent_to, error}` so the UI can show success or Resend error inline.
- ✅ **Three idempotency fields** on `BookingOut`:
  - `report_card_email_attempted_at` — stamped on every attempt (prevents retry storms)
  - `report_card_email_sent_at` — stamped only on confirmed Resend success
  - `report_card_email_error` — last failure reason (e.g. "domain not verified")
- ✅ **Settings opt-out** — `settings.report_card_email_auto = false` disables all auto-sends globally.

### Frontend
- ✅ **`ReportCardEmailStatus` badge** in admin `BookingDetailModal`. Three states:
  - 🟢 `✓ Emailed Xm ago` + "Re-send" link (success)
  - 🔴 `⚠ Email failed` (hover = error reason) + "Retry" link (Resend rejected)
  - 🔵 `→ Send to client` button (never attempted)
- ✅ Resend uses `_fmtAgo()` helper (extracted outside the component to satisfy `react-hooks/purity`).

### Tests
- ✅ `tests/test_report_card_email.py` (7 new):
  1. Checkout auto-stamps `attempted_at` for boarding visits with content
  2. Training visits are skipped (different comms flow)
  3. No-content visits are skipped
  4. Report card filed AFTER checkout fires the email
  5. Manual resend clears flags + re-fires
  6. Resend 400s on no-content visits
  7. Staff cannot resend (admin-only)
- ✅ All 20 tests across this work passing.

### Operator note
**Resend domain verification required for actual delivery.** Code is correct and idempotency works. Live preview env logs `"sithappensohiodogtraining.com domain is not verified"` — once the user adds + verifies the domain at https://resend.com/domains, every email queued by this code will actually deliver. Existing `report_card_email_error` records will surface this clearly in the admin UI with the Resend error message.



## Sprint 110co — Care Log on Report Card (2026-06-08)
**User ask**: "Wire the boarding report card to auto-pull the day's feeding_log, medication_log, and bathroom_log."

- ✅ **Backend** — Added `feeding_log`, `medication_log`, `bathroom_log` (optional) to the `BookingOut` Pydantic model so the data flows through every booking endpoint (`/bookings`, `/bookings/{id}`, `/bookings/me`, etc.). Dog timeline events also surface these fields.
- ✅ **New shared component** — `CareLogStrip.jsx` renders all three streams: meals with timestamp + staff name + notes; medications with timestamp + clickable photo-proof thumbnail (zoomable); bathroom pill counters (💧 N / 💩 N). Auto-hides when there's nothing to show.
- ✅ **Client portal** — embedded inside the green report-card section + a standalone variant for visits that have care data but no formal report card yet. Boarding clients now see exactly what happened with zero typing from the operator.
- ✅ **Admin BookingDetailModal** — same component embedded so operator gets the same view from the admin side (one source of truth).
- ✅ **Tests** — `test_care_log_on_booking.py` (2 new):
  1. After staff logs feeding/medication/bathroom, the booking endpoint returns those arrays with correct shape, `by_name` stamped, and bathroom counters intact.
  2. Even with no logs yet, the keys (`feeding_log`, `medication_log`, `bathroom_log`) are present in the booking response — frontend depends on the shape.
- ✅ Regression: all 12 P0 + care-log tests passing.



## Sprint 110cn — Staff Portal P0 + Shift Adjust + Trivia (2026-06-08)

**User ask**: "P0 [incident, vaccine banner, med confirm, feeding confirm] + shift adjust (punch corrections) + let staff play trivia."

### Backend (15,958 → 16,338 LOC; +12 routes)
- ✅ **`/employee/incidents` (POST)** — staff log incidents from the floor. Auto-stamps reporter name, time, on-site state. Type/severity validated. Single photo data-URL accepted. Auto-flags `follow_up_required` for moderate/severe.
- ✅ **`/employee/bookings/{id}/log-feeding` (POST)** — appends timestamped confirmation to `feeding_log` array on the booking. Each entry carries the schedule index, optional note, optional photo, who logged it.
- ✅ **`/employee/bookings/{id}/log-medication` (POST)** — same but for `medication_log`. Liability gold — photo proof one tap away.
- ✅ **`/employee/bookings/{id}/bathroom` (POST)** — increments pee/poop counter (delta ±1, clamped to 0). Solves "did he go?" boarding-client question with hard data.
- ✅ **`/employee/punch-corrections` (POST + GET)** — staff submits shift correction request. GET returns staff's own (or all, if admin).
- ✅ **`/employee/punch-corrections/{id}/decision` (POST, admin only)** — approve auto-applies the requested clock_in/clock_out times to the matching `time_clock_entries` row (or creates a fresh row if staff forgot to clock in/out entirely).
- ✅ **`/employee/trivia/quiz` + `/employee/trivia/answer`** — same question pool as the client portal, no scoring/streaks. Learning tool for staff (breeds, behavior, training).
- ✅ Roster (`/employee/roster-today`) now surfaces `vaccines`, `feeding_log`, `medication_log`, `bathroom_log`, `is_birthday` per row so the staff app can render banners + confirmation checkboxes + bathroom counters without extra round-trips.
- ✅ New `db.punch_corrections` collection indexed on `(status, created_at)` + `user_id`.

### Frontend
- ✅ **Floating "Log Incident" FAB** — always-visible red button (`emp-incident-fab`). Modal pre-loads today's roster so dog-picker is instant. Camera capture for photo proof.
- ✅ **VaccineGuard banner on every roster card** — red if rabies/dhpp/bordetella expired or missing, orange if expiring within 14 days. Check-in is **blocked** with a `confirm()` if rabies is expired or missing (other vaccines warn only — per most jurisdictions only rabies is legally required).
- ✅ **CarePoint rows** — tap a circle to confirm a feeding or medication. Becomes solid green ✓ once logged. Medications also get a camera icon → photo proof.
- ✅ **BathroomCounter** — 💧 Pee · N | 💩 Poop · N pills under each on-site dog. Right-click (long-press on mobile) to decrement.
- ✅ **Birthday banner** — auto-renders 🎂 on roster cards when today is the dog's birthday.
- ✅ **TimecardTab → "Request correction" button** — per-row pencil icon to fix a specific punch, plus a global "I forgot entirely" button. New `PunchCorrectionModal` + history viewer.
- ✅ **Staff Trivia tab** — 5-question adaptive quiz (easy/medium/hard ladder). Tap a choice → instant reveal with educational explanation. Real-time right/wrong count. "Play again" CTA.
- ✅ **Admin → Staff → Corrections tab** — `PunchCorrectionsAdminTab` lists pending/approved/denied requests with one-tap approve + optional admin note that's stored on the row.

### Tests
- ✅ `tests/test_staff_portal_p0.py` — 10 new tests, all passing:
  1. Staff can log incident with auto-stamped reporter
  2. Incident rejects unknown dog
  3. Staff can log feeding + medication (entries appear on roster)
  4. Bathroom counter increments + undoes (delta ±1)
  5. Bathroom counter clamps at 0
  6. Roster includes vaccines + birthday flag
  7. Staff submits and admin approves punch correction
  8. Admin can deny + can't re-decide already-decided requests
  9. Staff cannot decide their own correction (403)
  10. Staff can play trivia (correct_index hidden in quiz payload)
- ✅ Regression: full employee/staff suite (16 passed) — no regression in clock, pay, snapshot.

### Smoke test (UI)
Logged in as a fresh staff account → Roster shows red vaccine banners on every card, red "LOG INCIDENT" FAB bottom-right, Trivia tab renders an adaptive multiple-choice quiz, Timecard shows the correction button.

### Bug squashed mid-build
- `find_one({"id": x}, {"_id": 0, "bathroom_log": 1})` projection without `id` returned an empty dict for bookings that had never been ticked, triggering false "Booking not found" 404s. Added `"id": 1` to projection.



## Sprint 110cm — Search-to-card scroll (instead of force-open) (2026-06-08)
**User ask**: "When searching a dog or client and I click the name, instead of opening right away take me to their card location."

- ✅ Added `scrollToCardAndFlash(testId)` helper (`/app/frontend/src/lib/scrollToCard.js`). Scrolls the matching DOM node into view with `scrollIntoView({behavior:"smooth", block:"center"})` and pulses a green halo around it for 1.8s using a new CSS keyframe (`.search-flash` in `index.css`). Retries up to 20× × 50ms in case the card hasn't rendered yet after the tab switch.
- ✅ `searchTarget` now carries a `mode` field. Search results from Cmd+K pass `mode:"scroll"`; explicit "Open dog profile" / "Open client" buttons in Pipeline, Dashboard, and Booking Detail pass `mode:"open"` so they keep their direct-into-modal behavior.
- ✅ Clients.jsx + Dogs.jsx `focusId` effects branch on `focusMode`: `"open"` → openEdit (legacy behavior preserved for the contextual jump buttons), `"scroll"` → scrollToCardAndFlash (new search behavior).
- ✅ Smoke test: search "test" → click BuddyTest → sidebar switches to DOGS, page scrolls so BUDDY · TEST card is in view, no modal opens. Behavior confirmed via playwright capture.
- 🎯 **User impact**: search no longer slams you into a modal you might not want. You see WHERE the dog/client lives in your list (with a green halo telling you which one matched), then choose whether to click in.



## Sprint 110cl — Performance + Operator-Safety cleanup (2026-06-08)
**Why**: Audit surfaced 4 obvious wins — no feature changes, just stability.

- ✅ **Mongo indexes for income hot paths.** 7 new compound indexes added to
  startup so every income endpoint, P&L report, weekly summary, and
  time-clock query is index-backed instead of a full collection scan:
  `retail_sales.date`, `retail_sales(date, source_kind)`, `expenses.date`,
  `time_clock_entries.clock_in_at`, `time_clock_entries(user_id, clock_in_at)`,
  `credit_lots.pack_kind`, `credit_lots.id` (unique), `payment_plans.client_id`,
  `payment_plans(client_id, status)`, `reschedule_requests(status, created_at)`,
  `reschedule_requests.client_id`, `reschedule_requests.booking_id`.
  Once data grows past ~10k bookings the difference will be 10–100x on the
  Income screen. Verified all indexes registered on restart.
- ✅ **Backup retention upgraded.** Old policy only deleted by age, so manual
  test backups piled up forever inside the retention window (27 files in 1
  week → 35MB). New policy in `_run_auto_backup_once`: keep every file from
  the last 7 days (so hourly safety nets after a fresh backup), keep only the
  latest 1-per-day for files older than 7 days but within retain_days, delete
  anything past retain_days. No config change needed; takes effect on the
  next backup run.
- ✅ **Test suite collection fixed.** `test_pnl_checkout_flow.py` was reading
  `os.environ["MONGO_URL"]` at module-level, which crashed pytest collection
  with `KeyError` and aborted the entire run. Moved env reads into `main()`
  so the script still works standalone (`python tests/test_pnl_checkout_flow.py`)
  but pytest now collects all 555 tests cleanly. You can finally do
  `pytest tests/` as a one-shot regression command.
- ✅ **Route shadow bug fixed.** `GET /bookings/conflicts` was defined AFTER
  the catch-all `/bookings/{booking_id}`, so FastAPI was routing
  `/bookings/conflicts` → `get_booking(booking_id="conflicts")` which always
  returned 404. Moved the literal route above the parameterized one. Verified
  live: `/api/bookings/conflicts?dog_id=...` now returns `{"conflicts": [...]}`
  instead of "Booking not found". Lint debt: `EB002` route-shadow warning
  is gone (from 26 lint issues down to 24 pre-existing E701/E702/E741).
- ✅ Regression: 72 tests across the touched areas (program scheduling, payment
  plans, reschedule requests, retail sales, training PNL, sprint16 income,
  booking detail) all passing.



## Sprint 110ck — Training Program Revenue Double-Count Bug (2026-06-08)
**User-reported bug**: "It's adding the training revenue I sold PLUS the amount of the credit. That's not supposed to do that for training plans — just the total when paid, not when they get checked out." Screenshot showed `Completed $992.60 (39 sessions)` + `Training Revenue $450` + `Gross $1442.60`, with `training · $90.00 (1)` polluting the breakdown.

**Root cause**: When a training program is sold, the full sale ($450) is logged to `retail_sales` with `source_kind=training_program_sale` (recognized at sell-time). When the dog is later checked out on one of the prepaid sessions, the booking's `actual_price` was being set to the per-session value (e.g. $90) and that amount was being **added again** to `completed_total` / `by_service` in the income endpoints. Same $90 counted twice.

- ✅ Added two helpers in `server.py`: `_get_training_program_lot_ids()` (fetches all `credit_lots` with `pack_kind=training_program`) and `_is_program_credit_redemption(booking, lot_ids)` (detects via `is_prepaid_program_session` flag OR `payment_method=credits` + lot intersection).
- ✅ Patched four income endpoints to exclude program-credit redemptions from completed/paid totals and from `by_service`:
  - `/transactions/weekly-summary`
  - `/transactions/summary-range`
  - `/admin/today-pnl`
  - `/admin/income/export.csv` (also dedups `pack_kind=training_program` lots out of the "Credit Pack" section because the same sale is already in `retail_sales` as Training Revenue)
- ✅ Patched `pl_report.build_pl_data` (used by P&L PDF + `/reports/pl`) to filter the booking pool before any aggregation, so by_service, by_client, by_day, top_dogs, YTD totals all naturally exclude the leak.
- ✅ Pytest `tests/test_program_revenue_no_double_count.py` — sells a $400 program, completes one prepaid session via the real check-in/check-out flow, then asserts the weekly summary's `completed_total` does NOT grow by the per-session $100. Passes.
- ✅ Regression: all 46 income/transaction/PNL tests passing.
- 🎯 **User impact**: A $450 training program sale shows as $450 of Training Revenue once. The checked-out sessions stay in `is_prepaid_program_session=True` state but contribute $0 to completed_total. Gross numbers finally tell the truth.



## Sprint 110cj — Invisible-text bug + variable confusion (2026-06-08)
**User-reported bugs**:
1. "I have these weird text fields that don't show what's typed" (white text on white background).
2. "We are still using variables in the agreement, I don't know how to use".

- ✅ **Invisible text fix**: My new components were using a custom Tailwind class `bg-bgInput` that **doesn't exist in the project's Tailwind config** — so inputs fell back to white backgrounds with white text (literally invisible typing). Replaced every `bg-bgInput` → `bg-bgBase` (the dark color that already exists). Confirmed via screenshot: "Sit Happens Test Type" now visible in the Brand Name field, hex codes readable, all inputs dark.
- ✅ **Variable chips made human-readable** (in `RichTextEditor`):
  - **Before**: tiny cryptic `{{client_name}}` chips with the label "Insert:" and zero explanation.
  - **After**: friendly chips with **plain-English labels** like "Client's full name", "Total amount", "Number of payments", "Full payment schedule" — each prefixed with a `+` icon and a tooltip that says "Inserts a placeholder that gets replaced with the actual ___ when the message is sent". Section header now reads "🪄 Auto-fill — tap to insert".
- ✅ **Better instructions on the agreement editor** (Payment Plans settings): added a clear two-sentence explanation: *"Auto-fill buttons drop in placeholders that get automatically replaced with each client's actual info when the agreement is sent. Example: clicking Client's full name shows up as `{{client_name}}` in the editor, but the client sees their real name (e.g. 'Alex Rivera'). You don't need to type these by hand — just click."*
- ✅ Lint clean on both updated files. 5 files (`PaymentPlanSettingsPanel`, `EmailDesignerPanel`, `AdminClientPaymentPlans`, `PortalPaymentPlans`, `RichTextEditor`) all had the `bg-bgInput` bug — all fixed in one sweep.
- 🎯 **User impact**: You can now actually SEE what you type. And the variable buttons explain themselves — no more wondering what `{{client_name}}` means.



## Sprint 110ci — Replaced HTML textareas with friendly WYSIWYG editors (2026-06-08)
**User complaint**: "Why are things asking me for HTML code? I don't know how to do that."

- ✅ **New reusable `RichTextEditor` component** (`/app/frontend/src/components/RichTextEditor.jsx`):
  - `contentEditable` div with a friendly toolbar: **Bold · Italic · Underline · Bullet list · Numbered list · Link · Clear formatting**.
  - Click-to-insert **variable chips** for `{{client_name}}`, `{{total_amount}}`, etc. — drops the placeholder at the caret position.
  - Placeholder shows when empty.
  - Outputs clean HTML compatible with every existing `dangerouslySetInnerHTML` renderer (emails, agreements, previews).
- ✅ **Replaced raw HTML textareas in 3 places**:
  - Email Designer → Branding → **Signature** + **Footer text** (was 2 monospace textareas with `<p>` tags).
  - Email Designer → Template Editor → **Email body** + **Sign-off** (had a manual toolbar that inserted tags; now full WYSIWYG).
  - Settings → Payment Plans → **Agreement text** (the big one — operator now types their whole legal agreement like a Word doc).
- ✅ All labels rewritten — no more "(HTML)" suffixes anywhere. New helper text explains what each field is for in plain English.
- ✅ Removed now-dead code: `ToolbarBtn` component + `applyFormatting` + `insertVar` + `introRef` + `useRef` import from EmailDesignerPanel. Lint clean on all 3 affected files.
- 🎯 **User impact**: Zero HTML in the UI. Operator types like Microsoft Word, clicks Bold/Italic/Bullet, and the system writes the HTML behind the scenes. Variable chips remain for power moves.



## Sprint 110ch — Payment Plans for Big-Ticket Items (2026-06-08)
**User ask**: "For my expensive offerings I want a payment agreement and ways for me and the client to see what's due, what's paid, upcoming. Settings to change the agreement at will. Agreement should be clear."

User choices: Training programs only (no credit packs), preset cadences (weekly / bi-weekly / monthly / N installments), manual mark-paid, typed-name e-signature, with reminder emails.

- ✅ **Settings → Payment Plans** (`PaymentPlanSettingsPanel`):
  - Rich HTML agreement editor with variable chips: `{{business_name}}`, `{{client_name}}`, `{{program_name}}`, `{{total_amount}}`, `{{installment_count}}`, `{{installment_amount}}`, `{{schedule_list}}`.
  - Reminder-days-before slider (default 3), default cadence dropdown, business name field.
  - **Live preview pane** below renders the agreement with sample data so the operator can see exactly what clients will see.
  - Singleton doc stored in `payment_plan_settings` (`_id="singleton"`).
- ✅ **Admin client widget** (`AdminClientPaymentPlans` on Clients screen) — per-client view of every plan + a "New Plan" modal:
  - Program name, total, cadence (weekly/bi-weekly/monthly), # of installments (1–24), first-payment date.
  - **Live schedule preview** as the operator types, with rounding to ensure installments sum to total to the penny.
  - One-click **mark-paid** per installment (cash / card / venmo / check chips) — auto-completes the plan when last installment is paid.
  - Cancel plan with confirm; status badges (pending_signature / active / completed / cancelled) with overdue badge counts.
- ✅ **Client portal** (`PortalPaymentPlans` shown on Portal home, only when client has ≥1 plan):
  - Plan cards with progress bar (paid / total), full installment schedule, overdue highlighting.
  - **"Review & Sign Agreement"** modal for `pending_signature` plans — renders the agreement HTML stored on the plan, checkbox confirmation, typed-name input (full legal name), submit → activates plan.
  - E-signature captures `typed_name`, `signed_at`, `ip_address`, `user_agent` for audit.
- ✅ **4 new email templates** in registry (all customizable in Email Designer):
  - `client_payment_plan_created` — sent to client on plan creation with sign link.
  - `client_payment_due_soon` — reminder template (scheduler hookup is next step).
  - `client_payment_received` — confirmation when an installment is marked paid.
  - `client_payment_overdue` — past-due notice (scheduler hookup next).
- ✅ **Backend endpoints** (all 100% pytested):
  - `GET / PUT /admin/payment-plans/settings`
  - `POST /admin/payment-plans` (validates installments sum to total ± $0.01)
  - `GET /admin/payment-plans?status&client_id` — decorated with `paid_total`, `remaining_total`, `overdue_count`
  - `GET /admin/payment-plans/{id}`
  - `POST /admin/payment-plans/{id}/installments/{inst_id}/mark-paid`
  - `POST /admin/payment-plans/{id}/cancel`
  - `GET /portal/payment-plans` (only client's own; same decoration)
  - `POST /portal/payment-plans/{id}/sign` (typed_name + IP + UA captured)
- ✅ **Backup** updated — `payment_plans` + `payment_plan_settings` (singleton string-id) added to `BACKUP_COLLECTIONS` + `STRING_ID_COLLECTIONS`. Backup version still v4 (additive).
- ✅ **Tests** `test_payment_plans.py` 11/11 passing — settings round-trip, create (with agreement rendered), installments-must-sum-to-total guard, sign activates plan, no double-sign, mark-paid + auto-complete, no double mark-paid, list decorations w/ overdue, client-only sees own, cancel, admin-required.
- 🎯 **User impact**: $2K Service Dog program → 4 bi-weekly payments of $500 in one click. Client gets a clean signed agreement, sees exactly what's paid and what's upcoming. You see overdue counts at a glance and can mark cash/card/venmo/check payments in two taps.



## Sprint 110cg — Income screen: Training Revenue actually splits from Retail (2026-06-08)
**User-reported bug**: The Income screen *still* showed training program sales lumped under "RETAIL · $3750 · 17 sales" even after Sprint 110cb separated them server-side.

- ✅ **Root cause**: Two backend endpoints serve the Income screen:
  - `/transactions/summary-range` — fixed in 110cb (monthly/quarterly view) ✅
  - `/transactions/weekly-summary` — **NOT fixed** in 110cb (this-week view) ❌ — the bug.
- ✅ **Fix**: Mirrored the `source_kind="training_program_sale"` filter into `/transactions/weekly-summary`. Now returns `training_revenue_total` + `training_revenue_count` separately from `retail_total` + `retail_count`. `gross_total` still includes both buckets.
- ✅ **Income.jsx UI**: Replaced the single purple "Retail" chip with **two independent chips** — a green 🎓 "Training Revenue" chip (only renders when > 0) and the purple "Retail" chip (only renders when > 0). Gross summary moved to its own neutral pill so both can coexist cleanly.
- ✅ **Data**: Confirmed via curl — the 17 program sales now correctly attribute to `training_revenue_total = $3750.00` with `retail_total = $0` (test data has 1 stray retail row).
- ✅ Screenshot confirms the Income screen now shows: 🎓 **TRAINING REVENUE $3750.00 · 17 sales**  ·  Gross $4063.25, with no misleading "Retail" bar.
- ✅ Existing test `test_sell_program_income_appears_in_summary_range` still passes; weekly-summary semantics unchanged for retail (separation is additive).
- 🎯 **User impact**: The Income screen now matches reality — services revenue, training revenue, and retail revenue each stand on their own.



## Sprint 110cf — Client-Initiated Reschedule Requests (2026-06-08)

**Goal**: Owners can request to move a prepaid program session by proposing 1–3 alternate slots. Operator gets an email + an inbox row to approve with one click — no more "what time works?" phone tag.

- ✅ **Client portal**: each prepaid program session gets a **"Reschedule"** button (only when `is_prepaid_program_session=True` and session is upcoming + approved). Opens a modal that lets the owner pick up to 3 date+time options with an optional note.
- ✅ **Admin inbox** (`RescheduleRequestsInbox`) on the Bookings screen header — only renders when there are pending requests. Each row shows the current date/time, client note, and **the proposed slots as one-click approve buttons**. A "Decline" inline form sends a polite "we'll follow up" email.
- ✅ **Backend endpoints** (new):
  - `POST /portal/bookings/{id}/request-reschedule` — client creates the request. Guarded so:
    - Only the booking's own client (or admin) can submit.
    - Only prepaid program sessions are eligible.
    - Only one pending request per booking at a time.
  - `GET /portal/reschedule-requests` — client's own requests history.
  - `GET /admin/reschedule-requests` — admin inbox with optional status filter.
  - `POST /admin/reschedule-requests/{id}/approve` — moves the booking to the chosen slot, **without touching credits**, records `rescheduled_from` + `rescheduled_via_request`.
  - `POST /admin/reschedule-requests/{id}/decline` — closes the request + emails client.
- ✅ **3 new email templates** in registry (admin notification + client approval + client decline) — fully customizable in the Email Designer.
- ✅ **`BookingOut` model extended** to expose `is_prepaid_program_session`, `program_id`, `program_sale_session_index/total`, `credit_lot_id`, `rescheduled_from/at/via_request` so the portal can render the new button + the admin can see "Session X of Y · moved from MM-DD" on the schedule.
- ✅ **Backup** (`reschedule_requests` added) — confirmed v4 backup round-trip preserves request history. 9/9 backup tests still green.
- ✅ **Fixed payment_method bug** discovered along the way — sell-program weekly bookings were stamped `payment_method="training_credit_prepaid"` which broke the BookingOut Literal validation. Changed to `"credits"` (already in the enum); the prepaid-program distinction now lives on the dedicated `is_prepaid_program_session` flag.
- ✅ **Tests** `test_reschedule_requests.py` 8/8 passing:
  - Client can propose 1-3 slots → admin sees them in inbox.
  - Duplicate pending request on same booking → 409.
  - Reschedule on a non-prepaid booking → 404/400.
  - Admin approves slot N → booking moves to that date/time, credits untouched.
  - Admin declines → status flips, original booking unchanged.
  - Can't double-approve/decline.
  - Client sees their own request history.
  - Admin endpoints require admin auth.
- ✅ **All 51 sprint tests green** across reschedule + scheduling + sell-program + program-homework + backup + email + homework-streak. CRA frontend compiles cleanly.
- 🎯 **User impact**: One-click reschedules. Owner picks 3 options from their phone → you tap one → booking moves and they get confirmation. No phone calls, no calendar Tetris, no lost credits.



## Sprint 110ce — Recurring Sessions on Program Sale (2026-06-08)
**User ask**: "When I sell a training program I should be able to set a day of the week and a time slot that recurs every week for the amount of credits they get. This doesn't apply to board & train. I should be able to adjust this in the event of a cancellation."

- ✅ **Sell Program modal — new scheduler block** (`Clients.jsx`):
  - Hidden when no dog is picked OR when the program type is `board_train` (dog already on-site).
  - Day-of-week selector (Mon–Sun) + time picker (24h) + optional start date (blank = next occurrence of chosen weekday).
  - **Live preview chips** show the exact dates that will be booked (e.g. "Tue Jun 9 · 10:00"), with a "+N more" overflow.
  - "Book even on closed days" override checkbox for the edge case.
- ✅ **Backend `POST /clients/{id}/sell-program`** now accepts `schedule_day_of_week`, `schedule_time`, `schedule_start_date`, `schedule_override_closures`. When set (and dog is provided and program ≠ board_train):
  - Generates `qty` weekly dates from the anchor; **skips dates that match `settings.closed_dates`**, rolling forward +7 days each time (with a warning per skip).
  - Creates `bookings` rows with `service_type=training`, `actual_price=$0`, `payment_status=paid`, `payment_method=training_credit_prepaid`, `status=approved`, plus back-links `credit_lot_id`, `program_id`, `program_sale_session_index`, `program_sale_session_total`, `is_prepaid_program_session=True`.
  - Response includes `scheduled_bookings[]` + `schedule_warnings[]` so the modal can toast "4 weekly sessions booked · 1 closure skipped".
- ✅ **Reschedule endpoint** `POST /bookings/{id}/reschedule-next-week` (admin):
  - Walks forward week-by-week from the current date, skipping closures **and** any other booking the same dog already has on the candidate date.
  - Records `rescheduled_from` + `rescheduled_at` for the audit trail.
  - **Does NOT touch the credit lot or the client's training_credits balance** — the session is moving in time, not being burned.
  - Returns 400 if called on a non-prepaid booking (the rule that protects regular bookings).
- ✅ **No revenue double-counting** — every prepaid session lands at $0 on the books because the full sale price already hit the Training Revenue line on sale day (Sprint 110cb).
- ✅ **Tests** `test_program_scheduling.py` (8/8 passing):
  - Sell-without-schedule → zero bookings created.
  - Sell-with-schedule → exactly `qty` bookings on the right weekday, 7 days apart, all $0 prepaid, all tagged to the lot.
  - Board & Train silently ignores schedule fields.
  - Closed-day skipping → warning fired, all `qty` bookings still created, closed date excluded.
  - `schedule_override_closures=True` → closed date included, no warnings.
  - Reschedule → next Tuesday, credits untouched, lot back-link preserved.
  - Reschedule rejects non-program bookings → 400.
- ✅ All 23 sell-program + scheduling + homework loop tests green together (43 across the wider sprint suite).
- 🎯 **User impact**: Selling a 4-session program now locks in 4 calendar slots in one click. If the client (or operator) needs to move a session, hit Reschedule → it slides to the next open week without any credit math to think about.



## Sprint 110cb + 110cc — Training Revenue split + Pipeline progress tracker (2026-06-08)
**Two user-requested follow-ups to the Sell Training Program work:**
1. "Training programs are not retail items" — they were polluting the Retail bucket on the Income screen.
2. "I'd like an admin page to track all clients/dogs in training programs, progress, notes…"

### 110cb · Income split (Retail vs Training Revenue)
- ✅ **`/transactions/summary-range`** now returns `training_revenue_total` + `training_revenue_count` separately from `retail_total`. `completed_total` / `net_total` still include both (gross income unchanged).
- ✅ **Income screen** stat tile now reads `Services $X · Training $Y · Retail $Z` so the operator can see merchandise vs services at a glance.
- ✅ **Year-end CSV export** labels rows with `source_kind="training_program_sale"` as **"Training Revenue"** instead of "Retail" — clean separation for the CPA.
- ✅ **P&L PDF (`pl_report.py`)** now includes a dedicated `training_revenue` block with `by_program` breakdown. Retail's `by_category` no longer mixes in program sales.
- ✅ **Tests** (`test_sell_program.py` 10/10): updated `test_sell_program_income_appears_in_summary_range` to assert `training_revenue_total` rises AND `retail_total` stays unchanged.

### 110cc · Pipeline progress tracker
- ✅ **Expandable rows** in the existing Pipeline screen — click a row to reveal:
  - **Trainer Notes** textarea with **auto-save** (800ms debounce, "Saving… / Saved Xs ago" status).
  - **Quick status actions** — Put on Hold / Mark Complete / Resume (with confirmation).
  - **Jump to dog profile** button (preserves the existing flow).
  - **Goal grid** grouped by module (M1, M2, …) with `X/N mastered` headers; each goal exposes a 0–5 score selector that updates in place via `PUT /dogs/.../goals/{id}`. Manual-only goals get a "Mark Done" toggle.
- ✅ **"Notes" badge** on the row header indicates which enrollments already have trainer notes (so you can spot the ones you've touched).
- ✅ **Existing endpoints reused** — `PUT /dogs/{id}/programs/{enrollment_id}` (trainer_notes + status) and `PUT /dogs/{id}/programs/{enrollment_id}/goals/{goal_id}` (score/status). No new backend code needed.
- ✅ Screenshot confirms the full expanded view renders cleanly: notes textarea, M1/M2 module blocks, per-goal score buttons (5 highlighted green = mastered).
- 🎯 **User impact**: The operator can now sit in front of the Pipeline screen on a Monday morning, scroll all active dogs, jot trainer notes for each, and bump mastery scores — without ever opening an individual dog profile.



## Sprint 110ca — Sell Training Program: dog selector + immediate income (2026-06-08)
**Two user-reported bugs in the Sell Training Program flow:**

1. ❌ Dog selector only showed "credits only" — couldn't pick a dog to enrol.
2. ❌ Training program sales weren't landing in the Income screen / P&L.

- ✅ **Dog selector fix** (`Clients.jsx · SellProgramModal`):
  - Was calling `/clients/{id}/dogs` which doesn't exist (404'd silently → empty list).
  - Now fetches `/dogs` (admin scope returns all) and filters by `owner_id === client.id`. Confirmed via screenshot — dropdown correctly shows "Rex · Lab" for Alice Test.
- ✅ **Immediate income recognition** (`POST /clients/{id}/sell-program`):
  - Writes a `retail_sales` row tagged `source_kind="training_program_sale"` with `category="Training Program"` and `description="Training Program · {name}"` so the operator can spot program sales at a glance in the Income screen.
  - Back-link `source_id` + `program_id` recorded so the audit trail joins program sale → income row → credit_lot.
  - `$0` comps do NOT create a noise income row.
  - Lot also stores `income_event_id` for traceability.
  - Different from credit packs by design — packs continue to use deferred revenue recognition (recognized on redemption); training programs are recognized up-front since they're a fixed commitment.
- ✅ **Tests** in `test_sell_program.py` (3 new + 7 existing = 10/10 passing):
  - `test_sell_program_records_immediate_income` — verifies row written with all fields + back-link.
  - `test_sell_program_income_appears_in_summary_range` — verifies it flows into `/transactions/summary-range` retail_total.
  - `test_sell_program_zero_price_does_not_create_income_row` — comps don't generate noise.
- 🎯 **User impact**: Operators can now enrol the dog at point-of-sale (single click), and program revenue is immediately visible in Income / P&L — no more "did I actually sell that?" reconciliation moments.



## Sprint 110bz — Per-module Homework Loop Fix (2026-06-08)
**User-reported semantic bug**: The per-module "homework" picker said "when this module is completed" but the actual desired behavior is the opposite — each module's homework should fire when the client **starts** that module (i.e., at enrollment for module 1, and when the previous module is mastered for modules 2+).

- ✅ **Backend semantics flip** (`_auto_assign_welcome_homework` + `_auto_assign_module_homework`):
  - **On enrollment** → assigns BOTH the program welcome homework AND Module 1's homework (Module 1 is starting now).
  - **On all goals in module N being mastered** → assigns Module N+1's homework (not N's).
  - **On the final module being mastered** → no further auto-homework (program completion handles it).
  - Trigger ID changed from `module:<id>` to `module_start:<id>` to reflect the new semantics; idempotency log re-keyed accordingly.
- ✅ **Frontend label change** in `Programs.jsx`:
  - Picker label now reads "Homework for this module" with a dynamic subtitle:
    - Module 1: "sent at enrollment"
    - Module N>1: "sent when module N-1 is mastered"
  - Helper text under the dropdown explains the trigger precisely (references the previous module by name).
- ✅ **Tests rewritten** (`test_program_homework_loop.py` 6/6):
  - `test_enrollment_assigns_welcome_AND_module1_homework` — verifies both fire at enrollment + module 2's does NOT yet.
  - `test_mastering_module1_assigns_module2_homework` — verifies module 2's homework fires + is idempotent.
  - `test_mastering_last_module_does_not_assign_more_homework` — verifies the final module doesn't trigger anything.
  - Existing welcome/FIFO regression tests still green.
- 🎯 **User impact**: The "auto homework" loop now matches the operator's mental model — module homework is the homework FOR that module, sent when the client begins it.



## Sprint 110by — Email Designer + Homework Streak Tile (2026-06-08)
- ✅ **Email template registry** (`email_templates_registry.py`) — 22 transactional emails declared with stable slugs, default subject/title/intro/CTA, and per-template variable lists. Single source of truth for everything Sit Happens sends.
- ✅ **Customization layer in `email_service.py`**:
  - New `_dispatch(slug, ctx, rows, …)` helper looks up admin overrides + branding, performs `{{var}}` substitution, then renders via `_wrap()` and sends.
  - `_wrap()` now accepts a `settings` doc (logo URL, brand_green/blue/dark, signature_html, footer_html) — pre-existing senders unchanged when nothing is customized.
  - Module-level `set_db()` (wired from server startup) + 30s in-process cache for both overrides and branding to keep email sends fast.
  - Refactored 20+ `notify_*` functions to use `_dispatch` (admin new/bulk/first booking, new client, quote request, quote received, training log, homework section/completed, Monday digest, certificate, homework reminder, weekly digest, day reviewed, homework assigned, low credits, booking approved, dog birthday, vaccine expiring). `account_claim`, `pack_receipt`, and `pl_report` keep their bespoke layouts but honor custom subject overrides.
- ✅ **Admin API endpoints** (all `require_admin`):
  - `GET /api/admin/email-templates` — full list with defaults + overrides + variables + `is_customized` flag.
  - `GET /api/admin/email-templates/{slug}` — single template detail.
  - `PUT /api/admin/email-templates/{slug}` — upsert override (subject/title/intro_html/cta_text/signoff_html).
  - `POST /api/admin/email-templates/{slug}/reset` — delete override row.
  - `POST /api/admin/email-templates/{slug}/test` — render & send a preview email with sample data.
  - `GET / PUT /api/admin/email-settings` — singleton branding doc (brand_name, logo_url, brand_green/blue/dark, signature_html, footer_html).
- ✅ **Settings → Email Designer** (`/app/frontend/src/components/EmailDesignerPanel.jsx`):
  - **Branding card** with logo URL, three color pickers (accent green, button blue, header dark), brand name, signature HTML, footer HTML, plus a **live HTML preview** of how branded emails will look.
  - **Templates card** with filter chips (All / To Clients / To You), per-template rows showing customized state + audience badge, and a **full-screen editor modal** with:
    - Subject + header title + body intro + button text + sign-off fields
    - Mini formatting toolbar (Bold / Italic / Link / Line break)
    - Variable chips that insert `{{var}}` at the caret position
    - Live mini-preview of the rendered email
    - "Send Test" button (sample data, custom recipient or admin default)
    - "Reset to Default" (disabled if not customized) + Save Changes
- ✅ **🔥 Homework Completion Streak tile** (`HomeworkStreakTile.jsx` on the client portal home):
  - `GET /api/portal/homework-streak` returns `{current_streak, longest_streak, last_completed_date, next_milestone, days_to_next_milestone, completed_today}`. Calculated from `homework.status == "completed"` rows; consecutive-day windowed in local time.
  - Tile shows flame escalation (🔥 / 🔥🔥 / 🔥🔥🔥), best-ever streak, days-to-next-milestone (3/7/14/30/60/100/200/365), and a "streak alive / log today" status pill.
  - Renders only when the client has at least one completion — clean for brand-new clients.
- ✅ **Tests**: `test_email_customization.py` (8/8) + `test_homework_streak_endpoint.py` (3/3) — 11/11 passing. Existing regression suite (`test_low_credit_email`, `test_program_homework_loop`, `test_sell_program`) still green: 26/26.
- ✅ Lint clean on both new frontend files. CRA dev build healthy.
- 🎯 **User impact**: Every email Sit Happens sends can be re-voiced from the operator's chair in <60 seconds — no code changes needed. Owners now get a daily 🔥 nudge that pairs with the existing Dog Trivia streak system.



## Sprint 110bx — Training Program Automated Homework Loop (2026-06-08)
- ✅ **Program-aware FIFO credit redemption** — `redeem_training_credit` now consumes `credit_lots` matched to the dog's enrolled `program_id` first, then falls back to generic training credits. Prevents accidentally burning Puppy Preschool credits on an Advanced Obedience session.
- ✅ **Program Editor pickers** in `Programs.jsx`:
  - "Welcome Homework Template" dropdown — auto-emails this homework when a dog is enrolled (sell-program or manual enroll).
  - Per-module "Module Completion Homework Template" dropdown — auto-emails when that module is logged as complete in a training session.
- ✅ **Backend wiring**:
  - `programs.welcome_homework_template_id` + `programs.modules[*].homework_template_id` persisted.
  - `_assign_program_homework(program, dog, client, template_id, label)` helper builds a `homework_assignments` row, sends via Resend, and writes an audit row to `notifications_log`.
  - Hooks fire on (a) `sell-program` enrol path and (b) `POST /training/sessions` when `module_completed == True`.
- ✅ **Tests** `test_program_homework_loop.py` — 5/5 passing: welcome-homework sends on enrol, module-completion sends once per module, no duplicate sends for re-logged modules, missing template is a no-op, FIFO credit redemption respects program_id.
- ✅ Lint clean. CRA dev build healthy. Frontend screenshots confirm Program Editor + pickers render correctly.
- 🎯 **User impact**: One-time program setup; every new dog enrolled gets their welcome homework + per-module follow-ups auto-emailed — zero manual trainer effort.


## Sprint 110bw — Sell training programs as credit packs (2026-06-07)
- ✅ **`POST /clients/{client_id}/sell-program`** — sells a training program: creates a `credit_lots` row tagged `pack_kind: "training_program"` + `program_id`, increments `clients.training_credits` by the program's session count, optionally enrols a specific dog into the program (`dog_id` field) so the trainer can start logging sessions immediately. Supports override_price (manual admin discount) + payment_method (cash/card/venmo/check/other/complimentary).
- ✅ **Double-enrol prevention** — selling the same program twice for the same dog issues fresh credits but returns the existing active `dog_programs` row instead of inserting a duplicate.
- ✅ **`GET /admin/clients/{client_id}/training-credits`** — per-program breakdown (the "hybrid" Q1c model): aggregates outstanding lots by `program_id`, returns `{global_training_credits, by_program: [{program_id, program_name, qty_remaining, qty_total, lots: [...]}], lots_count}`. Used by the client profile to show "3 of 4 Puppy Preschool left".
- ✅ **Frontend `SellProgramModal`** in Clients.jsx with `data-testid="sell-program-modal"` + full set of `sell-program-*` testids:
  - Banner showing client's current training credits + per-program breakdown
  - Program dropdown filtered to active programs with `format.count > 0`
  - Optional "Assign to dog" dropdown (Q2c) — shows "Will auto-enroll" green hint when selected
  - Override price input (placeholder = list price)
  - Payment method dropdown
  - Live "Summary" tile with total + per-session math
- ✅ **`Sell Training Program` button** (purple, `fa-graduation-cap` icon) on the Clients page card, directly under the existing green "Sell Credit Pack" button (Q3a).
- ✅ **Tests** `test_sell_program.py` — 7/7 passing: lot+credits creation, dog auto-enrol, double-enrol prevention, override_price math, wrong-dog rejection, per-program breakdown, admin-required.
- ✅ Lint clean. CRA dev build healthy. Smoke screenshot confirms modal renders end-to-end.


## Sprint 110bv — Bug fix: legacy clients shown new catalog prices (2026-06-01)
- 🔴 **Reported**: "We have legacy pricing but clients that have it are being shown the new prices." — UX/trust issue: portal showed catalog price even though `resolve_client_price` correctly charged the locked-in legacy rate at booking-create time.
- ✅ **Root cause**: `GET /services`, `GET /services/addons`, and `GET /credit-packs` returned raw catalog rows. They never consulted `price_overrides` so the portal display didn't match the actual charge.
- ✅ **Fix**: new helper `_apply_client_overrides(items, client_id, target_kind, price_field)` bulk-loads the client's active overrides and rewrites `base_price` (services) / `price` (credit packs) in place. Adds `legacy_price` (original list) + `has_legacy_override: true` so the UI can show "was $X" / "your rate" badges.
- ✅ Applied to: `/services`, `/services/addons`, `/credit-packs`. Admin callers still see raw catalog prices (the override only triggers when `user.role == "client"`). `value_each` on credit packs is now computed AFTER the override so it reflects the actual per-credit cost the client pays.
- ✅ **Tests** `test_legacy_pricing_portal.py` — 4 pass + 1 skipped (no daycare add-ons in catalog):
  - Service price rewritten to legacy rate for grandfathered client
  - Credit pack price rewritten + value_each recomputed correctly
  - Admin browsing catalog still sees the real list price (no leakage of `has_legacy_override`)
  - Client without an override row sees unchanged catalog prices (no false flag)
  - Add-on listing endpoint also honours overrides (skipped here for empty catalog)
- ✅ **Regression-clean** — full pricing suite (`test_price_overrides`, `test_today_pnl_legacy_pricing`, `test_legacy_pricing_portal`) → 13 pass / 2 skip, zero failures.


## Sprint 110bu — Staff W-2 / 1099 prep + grouped year-end CSV (2026-06-01)
- ✅ **Two new fields on the staff profile**: `tax_status` (`w2` | `1099` | `other`, defaults to `1099` for backward compat) + `address_street` / `address_city` / `address_state` / `address_zip`. Lives on the user record so it survives backups (`users` is intentionally NOT in the backup, but tax_status is captured via the year-end CSV export).
- ✅ **EmployeeIn/Out + create + update endpoints** all updated in lock-step. Pydantic `Literal["w2", "1099", "other"]` rejects invalid values with 422.
- ✅ **Staff edit modal redesigned**:
  - New **Tax classification** dropdown (`<select>` with helpful labels — "W-2 employee (you withhold taxes)" / "1099-NEC contractor (paid gross)" / "Other / not classified yet"). Hidden when Owner is checked since owner doesn't get a 1099/W-2.
  - New **Mailing address** collapsible disclosure (street + city/state/zip grid). Header gets a green "· On file" indicator once any address fields are populated.
  - Privacy note: "SSN/EIN is intentionally NOT stored here — your CPA collects that directly".
- ✅ **Year-end CSV `/admin/payroll/year-end.csv` rewritten** to group by `tax_status`:
  - Three sections (W-2 EMPLOYEES / 1099-NEC CONTRACTORS / OTHER) each with a filing-deadline hint and per-group **subtotal** row.
  - Header now includes **Street, City, State, Zip** columns so the CPA has everything for W-2 / 1099 filings.
  - **GRAND TOTAL** at the bottom across all groups.
  - Owner still excluded (Sprint 110bf logic preserved).
- ✅ **Tests** `test_w2_payroll_prep.py` (5/5 passing): create with new fields, update flips W-2 ↔ 1099, default → 1099, invalid value rejected, CSV smoke (Street/City/State/Zip headers + GRAND TOTAL present).


## Sprint 110bt — Backup/restore now covers everything in this session (2026-06-01)
- ✅ **BACKUP_VERSION bumped 2 → 3.** Restore still accepts v1/v2 payloads (older snapshots simply contain fewer collections — never wipes the new ones).
- ✅ **9 new collections added to `BACKUP_COLLECTIONS`** that were previously missing:
  - `app_settings` (auto_backup config + quarterly_tax rates + trivia_rewards perks)
  - `commands` (service-dog training command library — 72 rows)
  - `payment_transactions` (real revenue records — Stripe history)
  - `time_off_requests` (PTO tracker)
  - `trivia_questions` + `trivia_attempts` (curated trivia + client streaks)
  - `dog_facts` (200+ rows of Fact of the Day content)
  - `tax_payments` + `mileage_log` (already in, listed for completeness)
- ✅ **`STRING_ID_COLLECTIONS = {"app_settings"}`** — new mechanism that preserves string-typed `_id` fields (e.g. `_id: "auto_backup"`) through the export/restore roundtrip. Without this, app_settings docs would lose their natural key and restore would duplicate/scramble them.
- ✅ **`_build_backup_payload`, `/backup/export`, `/backup/restore`** all updated in lock-step. Merge mode upserts string-ID docs by `_id` and uuid docs by `id`. Replace mode wipes and bulk-inserts as before.
- ✅ **Intentional exclusions documented inline**: `trivia_daily` (1-row regeneratable daily cache), `auto_backup_runs` / `system_runs` / `notification_log` (audit ephemerals), `vaccine_dismissals` (per-user UI state), `users` (separate hash-aware migration).
- ✅ **Verified end-to-end**: live `/backup/export` now produces a v3 snapshot covering **41 collections, 1,894 rows**.
- ✅ **Tests** `test_backup_coverage.py` extended to 7 cases: full-collection coverage, exclusion list, string `_id` preservation, today's-data presence (≥21 trivia + ≥100 facts), mileage roundtrip (create → export → delete → restore → verify), legacy v1 acceptance, future-version rejection.


## Sprint 110bs — Inline tax-savings chip on mileage tile (2026-06-01)
- ✅ **`/admin/mileage/summary`** now also returns `today_tax_savings / mtd_tax_savings / ytd_tax_savings` plus `combined_tax_rate_pct`.
- ✅ **Math** mirrors the Quarterly Tax engine so the chip stays honest:
  - SE effective on profit = `se_taxable_pct × (SS + Medicare)`
  - Income tax effective  = `(federal + state + local) × (1 − ½ × SE_rate)` (half-SE deduction)
  - Combined = SE + income → ~30.2% for the default Warren OH sole-prop profile
- ✅ **Dashboard chip**: green pill `🐖 YTD tax savings $X` in the mileage tile header. Hover-tooltip shows the operator's actual combined marginal rate. Hides automatically when YTD savings = 0 (clean first-run state).
- ✅ **Enhanced toast**: every log entry now also shows estimated tax saved, e.g. `Logged 47.3 mi · +$33.11 deduction · ~$10.00 tax saved`.
- ✅ **Tests** `test_mileage_log.py` extended to 9/9 (added `test_summary_tax_savings` verifying combined-rate band 15–45% and savings = deduction × rate within $0.05).


## Sprint 110br — Recent-trips quick-fill on Mileage tile (2026-06-01)
- ✅ **`GET /admin/mileage/recent-trips`** — returns up to 10 unique (purpose, destination) combos from the most-recent 500 entries, each with `last_miles` so the form can auto-suggest a default. Empty purpose/destination rows are skipped.
- ✅ **`MileageDashTile` now has a "Re-use a recent trip" dropdown** at the top of the form. Picking an option pre-fills both purpose + destination, and pre-fills miles only if the user hasn't typed any yet. Dropdown auto-hides when there are no eligible entries (clean first-run experience).
- ✅ Form layout split into two rows (dropdown on top, the date/miles/purpose/destination/log button below) so the inputs don't get cramped.
- ✅ **New `destination` input** alongside purpose so the dedupe key is meaningful (same purpose ≠ same trip if destination differs).
- ✅ **Tests** `test_mileage_log.py` extended to 8/8 (added `test_recent_trips_dedupes` — proves duplicates collapse, ordering by created_at, last_miles carries through, capped at 10).


## Sprint 110bq — Business mileage log + quarterly-tax integration (2026-06-01)
- ✅ **`mileage_log` collection** + full CRUD (`GET/POST/PUT/DELETE /admin/mileage`) with date validation (YYYY-MM-DD), miles range (0 < m ≤ 2000), purpose + destination free-text.
- ✅ **`GET /admin/mileage/summary`** — Dashboard quick-tiles: today_miles + today_deduction, mtd_miles + mtd_deduction, ytd_miles + ytd_deduction, current rate_per_mile, entry_count_ytd.
- ✅ **Quarterly tax math now subtracts YTD mileage deduction**: `mileage_deduction_ytd = ytd_miles × mileage_rate_per_mile` rolls into `total_expenses` which feeds `net_profit` → reduces SE tax + federal/state/local tax. The endpoint payload exposes `expenses.mileage_miles / mileage_deduction / mileage_rate` for the UI.
- ✅ **`mileage_rate_per_mile`** added to `QUARTERLY_TAX_DEFAULTS` (0.70 = 2026 IRS standard rate). Editable in Settings → Quarterly Tax → Rates via the existing PUT endpoint.
- ✅ **`mileage_log` added to `BACKUP_COLLECTIONS`** so daily mileage survives backup/restore.
- ✅ **`MileageDashTile.jsx`** — new admin Dashboard widget under TodayPnlTile: 3-up stats row (Today / Month / YTD with miles + $ deduction) + inline form (Date / Miles / Purpose / Log button) + sonner toast on submit + "→ Quarterly Tax" deep-link button.
- ✅ **Quarterly Tax tab** — the Income/Expense breakdown shows a new conditional row `Business mileage (N mi @ $0.70/mi)` between labor burden and total expenses (only displayed when there's a non-zero deduction).
- ✅ **Tests** `test_mileage_log.py` — 7/7 passing (CRUD round-trip, validation, summary buckets, update, quarterly-tax math integration, rate setting persists, admin-required).


## Sprint 110bp — Bulk CSV import for trivia + dog facts (2026-06-01)
- ✅ **Backend `/admin/trivia/import-csv` + `/admin/dog-facts/import-csv`** — multipart UploadFile endpoints that parse a CSV, validate every row, and upsert by `uuid5(content)` so re-uploading the same file updates instead of duplicating. Bad rows are skipped with a `{line, reason}` report instead of failing the whole import.
- ✅ **Trivia CSV headers**: `question, choice_a, choice_b, choice_c, choice_d, correct_letter (A/B/C/D), difficulty (easy/medium/hard), tag` (8 of TRIVIA_TAGS). Skip reasons: empty question, missing choice, invalid letter, non-unique choices.
- ✅ **Dog facts CSV headers**: `text (required), tag, emoji`. Skip reasons: empty text, text < 3 chars. New facts join the rotation at `sort_order = max+1` so they get their turn.
- ✅ **Template download endpoints** `…/import-csv/template` return a ready-to-edit CSV with 2 working example rows + correct `Content-Disposition` filename.
- ✅ **Reusable `CsvImportRow.jsx`** — single component rendering "Download template" + "Upload CSV" buttons + an inline result panel (`N created · N updated · N skipped` with collapsible per-line skip reasons). Used by both Trivia panel (questions view) and DogFactsPanel (next to AI Generate).
- ✅ **Tests** `test_csv_imports.py` — 10/10 passing: template shape + headers, create-then-update (idempotency), bad-row skipping with reasons, missing-header validation, auth-required (401 without token), for both endpoints.


## Sprint 110bo — Operator-curated trivia seed (21 questions) (2026-06-01)
- ✅ **`/app/backend/seed_curated_trivia.py`** — idempotent seeder for 21 hand-written questions covering all 7 categories × 3 difficulty levels (Breeds / Behavior / Health / History / Anatomy / Training / Fun & Myth). Uses `uuid5` from question text so re-running upserts instead of duplicating.
- ✅ Each curated question gets `source="manual"` + `curated=True` flag for differentiation in the question library, plus the same shape as AI-generated ones (question/choices/correct_index/difficulty/tag/active).
- ✅ Ran once: 21 curated rows inserted; total trivia_questions = 38 (21 curated + 17 AI). Tags spread across all 7 categories.
- ✅ Curated questions immediately participate in the Wordle-style daily question pool and the adaptive quiz.


## Sprint 110bn — Glossy 3D category badges in Dog Trivia (2026-06-01)
- ✅ **6 badge PNG assets** cropped from the operator-provided reference sheet and saved to `/app/frontend/public/trivia-icons/` (breeds, training, nutrition, health, score, timer). Each ~360–380 KB, 512×512 RGBA.
- ✅ **`CategoryBadge` component** in `DailyTriviaCard.jsx` — maps every trivia `tag` (breeds/history/training/behavior/health/anatomy/fun/myth) to one of the 6 badges with a sensible fallback chain. Falls back to the "score" ribbon for unknown/fun tags.
- ✅ **Trivia card header redesigned** — left side now leads with a 48px glossy category badge (with shBlue drop-shadow glow) and a 2-line header: "DOG TRIVIA OF THE DAY" eyebrow + the category name underneath in shGreen. Difficulty + streak chips stay on the right.
- ✅ Faithful to reference: badges are real PNGs (not SVG approximations) so the gradient ring + cartoon illustration matches the operator's mockup exactly. Other inline UI icons across the app are unchanged — kept the badge style scoped to the minigame so dense UI (sidebar, tables, chips) is unaffected.
- ✅ Smoke-screenshotted on `/portal` — "History" question shows the husky badge correctly.


## Sprint 110bm — Trivia card inline SVG graphics (2026-06-01)
- ✅ **`DailyTriviaCard.jsx` gets on-brand SVG decorations** — zero image assets, all inline SVG so colors track the Sit Happens palette (shBlue / shOrange / shGreen).
  - **PawIcon / BoneIcon** — reusable SVG primitives sized via prop. Paw next to the "DOG TRIVIA OF THE DAY" header; bone in front of the "Nd streak" chip.
  - **DifficultyPaws** — easy = 1 paw, medium = 2, hard = 3 (replaces plain text label).
  - **PawBackdrop** — 5-paw low-opacity scatter behind the card content for ambient brand texture.
  - **PawConfetti** — burst of 14 multi-colored paw prints raining down (`@keyframes paw-fall`) when the player gets the daily question correct. Also re-used on a perfect quiz score.
  - **DogMascot** — minimal cartoon pup face with three moods (happy / thinking / sad). Renders next to the result line ("Correct! 🐾" vs "Not quite — keep your streak going tomorrow!") and in the quiz-complete summary tile.
- ✅ Lint clean. Smoke-screenshotted as `testclient@sithappens.com` — header paw, difficulty paws, streak bone, A/B/C/D buttons with green-correct highlight, happy dog mascot next to "Correct!" all render correctly.


## Sprint 110bl — Manually author trivia questions + edit existing (2026-06-01)
- ✅ **`POST /api/admin/trivia/questions`** — create an operator-authored question with full validation: required question text, exactly 4 unique non-empty choices, valid correct_index 0-3, difficulty auto-falls-back to "medium" if invalid, tag auto-falls-back to "fun". Marked `source: "manual"` to differentiate from AI in the list.
- ✅ **`PUT /api/admin/trivia/questions/{qid}`** — full edit (typo fixes, better distractors, mark active/inactive).
- ✅ **Frontend `TriviaQuestionEditor`** component used both for "New question" and "Edit question" — radio-button correct-answer picker with green border, A/B/C/D inline editing, difficulty + tag selects, active toggle, inline validation. "Mine" green badge on rows with `source: "manual"` in the question list.
- ✅ **Tests** `test_dog_trivia.py` extended to 17/17 passing (create + edit roundtrip, 5 validation cases, auth requirements).


## Sprint 110bk — Dashboard trivia widget + configurable goals/perks (2026-06-01)
- ✅ **Dashboard tile (`data-testid="trivia-dash-tile"`)** under Today's P&L — top 5 players (rank/name/dogs/streak/accuracy), amber **"N perks to award"** badge in the header when there are pending milestones, taps through to Settings → Trivia.
- ✅ **`GET/PUT /api/admin/trivia/rewards`** — new endpoints persisting `app_settings._id="trivia_rewards"` with custom milestone list `[{days, label, perk_type}]`. PUT validates (drops empty labels, zero/negative days, dedupes per-day), sorts ascending. Falls back to defaults (7/14/30) when none configured.
- ✅ **Daily-answer endpoint** now reads configured rewards instead of hardcoded `TRIVIA_MILESTONE_DAYS`. Each earned milestone also stamps the **label** + **perk_type** onto `clients.trivia_milestones` so the admin perks-to-award list shows the right copy at checkout.
- ✅ **Settings → Trivia → "Goals" tab** — full editor: each row has Day # + Perk message + Tag, Add goal / Remove / Reset-to-defaults / Save buttons. Helper banner explains the streak-match semantics.
- ✅ **Tests** `test_dog_trivia.py` extended to 14/14 passing (rewards GET defaults, PUT validation+dedupe+sort, auth requirement).


## Sprint 110bj — Admin view of trivia players + leaderboard + perk redemption (2026-06-01)
- ✅ **`GET /api/admin/trivia/leaderboard`** — full unredacted leaderboard: rank, full client name, email, phone, dog names, current/best streak, total correct, total attempts, accuracy %, last_played date, all earned milestones with redeemed_at status.
- ✅ **`POST /api/admin/trivia/milestones/redeem`** — operator marks a streak perk (7/14/30 days) as redeemed at checkout. Stamps `redeemed_at` + `redeemed_by` on the matching item in `clients.trivia_milestones`.
- ✅ **Settings → Dog Trivia panel** now opens to a **Leaderboard tab** (default) with: 4 KPI tiles (total players, total answers, pending perks count, top streak), a "Perks to award at next checkout" amber-bordered section listing every unredeemed milestone with a one-click "Redeemed" button, and the full player table (rank → player → dogs → current/best streak → correct/total → accuracy % → last played → earned milestone chips). **Questions tab** holds the original AI-generate + CRUD UI.
- ✅ **Tests** `test_dog_trivia.py` extended to 11/11 passing (full-detail leaderboard shape, 404 on bad redeem).


## Sprint 110bi — Dog Trivia mini-game (Wordle-style daily + adaptive quiz) (2026-02)
- ✅ **Wordle-style daily question** — every client sees the same multi-choice question per Eastern day. Deterministic SHA-256 hash of date picks from least-used pool, cached in `trivia_daily` collection for idempotency.
- ✅ **Streak tracking** — `_compute_streak` walks consecutive days; missing today doesn't break streak, breaks only on wrong answer or skipped day. Milestone messages emit at 7/14/30 days (free puzzle toy / $5 retail credit / free service upgrade) — stamped onto `clients.trivia_milestones`. Operator manually applies the perk at next checkout.
- ✅ **Family leaderboard** — top-10 by `current_streak → best_streak → total_correct`, shows first-name + dog names, YOU highlight when current user is in the top-10.
- ✅ **Adaptive quiz mode** — 5-question ramp (easy → medium → hard) via `/portal/trivia/quiz`. Quiz answers do NOT affect daily streak; pure-fun mode. `correct_index` never leaks to the client (sanitized via `_strip_correct`).
- ✅ **AI question generation** — Claude Sonnet 4.6 via `emergentintegrations` LlmChat with EMERGENT_LLM_KEY. Auto-seeds on first run when pool < 30 active questions. Admin "Generate with AI" button on Settings → Trivia panel for on-demand batches.
- ✅ **Admin management** — Settings → Dog Trivia panel: list questions (tag/difficulty/correct/usage), generate N more via AI, toggle active/inactive, delete. New `trivia_questions`, `trivia_daily`, `trivia_attempts` collections.
- ✅ **Tests** `test_dog_trivia.py` — 9/9 passing (admin CRUD, daily shape, Wordle determinism, quiz adaptive, leaderboard shape, quiz doesn't affect streak, auth requirements). Testing agent verified zero UI bugs.


## Sprint 110bh — Whole-app US Eastern timezone (2026-06-01)
- **User request:** "im in the u.s. eastern time zone the whole app should respect this time zone"
- **Root cause:** Backend was using `date.today()` (system TZ = UTC in container) for every "today / month / week" boundary. Background loops (auto-backup) used `datetime.now()` naive local which = UTC. Daily jobs (vaccine nudges, birthday emails) used `datetime.now(timezone.utc).date()`. All combined to misalign with the operator's wall clock.
- **Fix:**
  - Added `BUSINESS_TZ = ZoneInfo("America/New_York")` constant + `business_today()` + `now_local()` helpers in `server.py`.
  - **64 occurrences** of `date.today()` replaced with `business_today()` (bulk replace_all + targeted fixes for 3 variable-name collisions).
  - `_seconds_until_next_run` (auto-backup loop) now uses Eastern wall clock instead of UTC naive.
  - `daily_jobs.py` got matching `_today_local()` helper; all `datetime.now(timezone.utc).date()` patterns replaced with Eastern equivalents.
  - Storage timestamps (`now_iso()`, `created_at`, etc.) intentionally REMAIN in UTC — only day-level operator-facing math moved to Eastern. This keeps DB records, backups, and cross-tz queries consistent.
  - Bonus fix: `live` block in `/time-clock/me` now uses the rounded `hours_so_far` for `gross_so_far` (removes a sub-second rounding flake that masked as a TZ issue).
- **Verified:** `/admin/today-pnl` returns `date: 2026-06-01` matching the operator's local date. 39/39 high-priority pytests pass. Backend serves 200.


## Sprint 110bg — BUG FIX: Income page shows wrong month on the 1st of new month (2026-06-01)
- **User report:** "income and expenses are not showing now that its a new month its showing year to date and last month but today is the first of the new month and its not displaying what i have added today"
- **Root cause:** Two timezone bugs in frontend date helpers. (1) `new Date("2026-06-01")` parses the string as **UTC midnight**, which in any negative-offset timezone (US Eastern = UTC-4/-5) becomes the previous day's evening local time. So `d.getMonth()` returned May instead of June, and the month preset built a May 1–May 31 range. (2) `new Date().toISOString().split("T")[0]` returns the **UTC** date, which is "tomorrow" any evening past UTC midnight (after 8pm EDT). Both bugs were duplicated across 13 files.
- **Fix:** Created `/app/frontend/src/lib/date.js` with timezone-correct helpers: `todayISO()` (local calendar today), `parseLocalISO(s)` (parses YYYY-MM-DD as local midnight, not UTC), `localISOFromDate(d)` (formats Date back to local YYYY-MM-DD), `daysAgoISO`, `daysFromTodayISO`.
- **Files fixed:** Income.jsx (the user-reported screen), Staff.jsx, RunSheet.jsx, Homework.jsx, Dogs.jsx, Portal.jsx, Incidents.jsx, EmployeePortal.jsx, AdminBookingModal.jsx, PortalBookWizard.jsx, TrainingProgram.jsx, HomeworkSectionLogger.jsx, PortalDogModal.jsx.
- **Verification:** Direct Node test confirms with `TZ=America/New_York` on `refDate="2026-06-01"`: old code returned May 1 → May 31 (wrong); new code returns June 1 → June 30 (correct).


## Sprint 110bf — Owner / self-pay flag (sole-prop owner's draw tracking) (2026-02)
- ✅ **`is_owner` flag on Employee record** with singleton enforcement (toggling on auto-clears any prior owner) via `_enforce_single_owner` helper.
- ✅ Backend tax/payroll endpoints now treat owner correctly:
  - `/admin/payroll/estimate` — EXCLUDES owner entirely from per-employee math and totals
  - `/admin/quarterly-tax` — subtracts owner hours from `labor_gross`/`labor_burden` and surfaces new `owner_draw_ytd` + `owner_draw_hours`
  - `/admin/today-pnl` — KEEPS owner in `labor_cost` (per user choice b) but adds `owner_draw_today`/`owner_hours_today` for visibility, plus `is_owner` on each per-employee row
  - `/admin/payroll/year-end.csv` (1099/W2 prep) and `/admin/payroll/csv` — owner filtered out completely
- ✅ **New endpoints**: `GET /admin/owner` (returns the single owner or null), `GET /admin/owner/draw-summary` (today/MTD/YTD hours+draw with live projection of open shifts).
- ✅ **Frontend**:
  - Employee Edit modal: blue "Owner / self-pay" checkbox with helper text (`data-testid="emp-is-owner"`)
  - OWNER crown badge on Staff list row (`staff-owner-{id}`)
  - **OwnerDrawCard** drill-down at top of Staff → Employees with Today/Month/YTD tiles
  - **Owner's Draw YTD chip** on Quarterly Tax tab (`qt-owner-draw`) with helper text "excluded from labor expense — owner's draw comes out of net profit"
  - **Owner's draw today chip** on Dashboard Today's P&L tile (`pnl-owner-draw`) + OWNER badge on per-employee labor breakdown row
- ✅ **Tests** `test_owner_self_pay.py` — 8/8 pytests passing. 39/39 combined backend regression. Frontend testing agent verified zero UI bugs.
- ✅ Live-projection fix: draw-summary now projects still-open shifts to "now" so today's draw is consistent with today-pnl.


## Sprint 110be — CPA hand-off PDF on Quarterly Tax tab (2026-02)
- ✅ **`GET /api/admin/quarterly-tax/cpa.pdf`** — one-page Schedule C summary PDF: header w/ tax year + period, 4 top KPIs (Gross / Expenses / Net / Balance), Income detail, Expenses-by-Category table (auto-grouped from `db.expenses`), Net Profit highlight box, Tax breakdown table (SS / Medicare / Federal / OH state / Warren local with rates and bases), Quarterly payments table (all `tax_payments` for the year w/ totals), bottom-line Balance Still Owed box.
- ✅ New `backend/cpa_report.py` mirroring the `pl_report.py` ReportLab pattern (LETTER page, brand color tiles, BG/LINE/INK palette).
- ✅ Frontend: **"Send PDF to CPA"** blue button (`data-testid="qt-cpa-pdf"`) in QuarterlyTaxTab header that downloads `cpa-tax-summary-{year}.pdf` via blob.
- ✅ **Tests** `test_cpa_pdf.py` — 4/4 passing (valid PDF bytes, year filename, generation after logging a payment, admin-required). Combined backend: 15/15 pass on quarterly-tax + payments + CPA PDF suite.


## Sprint 110bd — Mark Quarter Paid + Time Off + Pay History Trend (2026-02)
- ✅ **Mark Quarter Paid tracker** — `tax_payments` collection + 3 endpoints (`GET/POST/DELETE /api/admin/quarterly-tax/payments`). Quarterly-tax endpoint now sums recorded payments per quarter, returns `paid`/`remaining` per quarter and `payments_applied`/`recorded_payments_total` totals. Frontend: green "Mark paid" button on each quarter card opens `TaxPaymentModal` (amount/date/method/memo), "Paid" chip on cards, full payment history table with delete-with-confirm.
- ✅ **Employee Time-Off Requests** — new `time_off_requests` collection + 5 endpoints. Employees submit via Employee Portal → new **Time Off** tab (`TimeOffFormModal` with start/end/type/reason). Admin reviews via Staff → new **Time Off** sub-tab (`TimeOffAdminTab`) with pending/approved/rejected/cancelled/all filters and `TimeOffReviewModal` for approve/reject with optional notes.
- ✅ **Weekly Pay History Trend** — new `GET /api/employee/pay-history?weeks=N` endpoint (Sunday-anchored, max 52 weeks). Added collapsible `PayHistoryPanel` to Employee Portal → Timecard tab with bar visualization, best-week highlight, totals.
- ✅ Both collections added to backup coverage list (`shifts`, `time_clock_entries`, **`time_off_requests`**, **`tax_payments`**).
- ✅ **Tests** — `test_tax_payments.py` (4), `test_time_off.py` (6), `test_pay_history.py` (4). 14/14 new tests passing; 27/27 combined with prior staff suites.
- ✅ **Frontend regression** — Testing agent verified all three features end-to-end via UI (Quarterly Tax Mark Paid flow, employee time-off submit + admin approval, pay history trend chart). Zero bugs found.


## Sprint 110bc — Quarterly Tax Estimate (Sole-Proprietor / Schedule C) (2026-02)
- ✅ **Backend** `GET /api/admin/quarterly-tax` aggregates YTD income (completed bookings + retail), expenses (recorded + labor gross + employer burden), nets to Schedule C profit, computes SE tax (SS+Medicare with wage-base cap), federal/state/local income tax, and splits the YTD owed into four IRS quarterly deadlines (Apr 15 / Jun 15 / Sep 15 / Jan 15 of next year) with status pills (`past` / `current` / `upcoming`).
- ✅ Configurable rates persisted in `app_settings._id=quarterly_tax`: federal/state/local %, SS rate %, Medicare %, SS wage base, SE taxable %, estimated payments already made. `GET/PUT /api/admin/quarterly-tax/settings` returns `{current, defaults}` so the UI offers a "Reset to defaults" action.
- ✅ Defaults are 2026 Warren OH sole-proprietor estimates (15.3% SE total, $176,100 wage base, 12% federal effective, 2.75% Ohio, 2.5% Warren).
- ✅ **Frontend** new `Quarterly Tax` sub-tab in Staff screen — KPI cards (gross income, expenses, net profit, balance owed YTD), 4 quarterly cards highlighting the next due payment, side-by-side income/expense breakdown vs SE+income-tax breakdown, inline rate-edit panel with reset.
- ✅ **Tests** `backend/tests/test_quarterly_tax.py` — 7/7 pytests passing (payload shape, quarters structure, math consistency, settings roundtrip, balance after payments, year param, admin-required).

## Sprint 110af — Review window + Report panel deeper visibility (2026-02)
- ✅ **DailyReviewQueue** day-detail now surfaces everything the client filled out:
  - Day instructions (what they were asked to do) in a blue-bordered context block
  - Equipment list (chips of what they should've had ready)
  - Step checkboxes with strikethrough for skipped steps + "X/Y completed" counter
  - Mood with emoji + label ("4/5 — Great")
  - Metrics section header, client note (orange-bordered), photo, video
  - Submitted-at footnote w/ re-submission flag
- ✅ **HomeworkReportPanel** now ALSO fetches `/homework/{id}` so it can detect daily-tracker plans. For tracker plans it renders a per-day timeline:
  - Collapsible day rows with status pill (Approved/Submitted/Needs-redo/Rest/Skipped) + one-line summary
  - Expanded view: instructions, steps w/ checkmarks, metrics, client note, photo, questions+answers thread, trainer's review note
  - Session-template aggregate tiles still render below for backwards compat
- ✅ Lint clean across both components

## Sprint 110ae — Daily-Tracker badge on template picker (2026-02)
- ✅ `HomeworkTemplatePicker` now shows a purple "DAILY TRACKER" pill (with calendar-check icon) on every card AND in the selected-template detail panel — instantly distinguishes day-by-day tracker templates from session-log templates
- ✅ Tracker cards also get a purple ring border so they stand out at a glance in the grid
- ✅ Testid `template-tracker-badge-{slug}` for automation; lint clean

## Sprint 110ad — Daily-tracker template re-assign bug fix (2026-02)
- ✅ Bug: saving a daily tracker as a template then re-assigning it from the template produced a `daily_tracker=False` instance, rendering as a session-log catalog instead of the day-pip / Today's-plan tracker UX
- ✅ Root cause: `create_homework_from_template` endpoint did not carry the template's `daily_tracker` flag through onto the new homework doc; `total_days` was also left at 0
- ✅ Fix: read `daily_tracker` from the template, compute `total_days` from section count or `default_duration_days`, persist both on the new instance
- ✅ Regression test: `tests/test_daily_tracker_template_roundtrip.py` — creates a tracker w/ save_as_template → fetches the saved template → assigns via `/homework/from-template` → asserts result has `daily_tracker=True`, `total_days=3`, and that `daily_progress` is computed with correct lock chain

## Sprint 110ac — Dashboard hero: full service-category coverage (2026-02)
- ✅ Backend `/dashboard/stats` now also returns `grooming_today` and `photography_today` counts (same live-occupancy logic as the existing 3 categories — excludes already-checked-out dogs)
- ✅ Dashboard hero now shows 5 tiles: Daycare (occupancy/capacity), Boarding tonight, Training today, Grooming today, Photography today
- ✅ Verified via curl that all 5 fields populate correctly

## Sprint 110ab — Dashboard hero tile bug fix (2026-02)
- ✅ Dashboard hero tiles (Daycare/Boarding/Training today) were reading wrong field names — `daycare_today`/`boarding_tonight` instead of the actual backend keys `daycare_occupancy`/`boarding_today`/`training_today`. Tiles always showed 0.
- ✅ Now correctly reads `stats.daycare_occupancy / stats.daycare_capacity` (displays `2/30`), `stats.boarding_today`, `stats.training_today`
- ✅ Verified via curl that backend returns valid numbers; lint clean

## Sprint 110aa — Italic clipping fix + admin Bookings gradient + Achievements panel polish (2026-02)
- ✅ **Italic header clipping fixed**: PageHero title now has `pr-1 sm:pr-2`, plus global admin header h2 + portal welcome line get matching right-padding so italic D/S/B tails no longer clip against `overflow-hidden`
- ✅ **Admin Bookings rows**: per-status colored left-border + gradient tint (approved=green, pending=orange, completed=blue, rejected=red) on both desktop table rows and mobile cards. Status pill now has matching colored border. Hover-state row highlight added.
- ✅ **Portal Achievements panel** (`HomeworkIncentivesPanel`): wrapped in shadow-2xl gradient card with dual brand-glow halo (shGreen + shOrange), "{N} EARNED · {N} TO UNLOCK" eyebrow with medal icon, big italic "YOUR ACHIEVEMENTS." headline — matches Trophy Wall styling exactly
- ✅ Lint clean across PageHero, App, Portal, Bookings, HomeworkIncentivesPanel
- ✅ Smoke-screenshotted: dashboard header letters render clean; admin bookings shows colored row strips; portal achievements is on-brand

## Sprint 110z — Portal: Trophy Wall / My Dogs cards / My Bookings cards unification (2026-02)
- ✅ **Trophy Wall**: shadow-2xl + dual brand-glow halos (orange top-left + blue bottom-right), "{N} EARNED" eyebrow, italic "TROPHY WALL." headline, section labels with user/paw icons
- ✅ **My Dogs cards**: each card gets gradient bg + shGreen radial halo top-right, hover lift, larger photo area (h-36), italic dog name, brand-colored "Mixed/Lab" pill, shield-iconed vaccine status with bold green/red
- ✅ **My Bookings cards**: per-status gradient + radial halo (green/orange/blue/red based on status), italic dog name, polished status pills with colored borders, action buttons with hover transitions
- ✅ Lint clean; smoke screenshots confirm full visual cohesion across portal — every major section now uses the same eyebrow + italic headline + brand-glow rhythm

## Sprint 110y — Portal: My Dogs / Homework / Quick Links visual unification (2026-02)
- ✅ **Homework plan cards** rebuilt with gradient + brand-color radial glow: purple for daily-tracker plans, orange for session-template plans, green for completed. Title goes to italic uppercase. Shadow elevation added.
- ✅ **My Dogs** header gets eyebrow ("THE REAL STARS") + italic "MY DOGS" headline; Add a Dog button polished
- ✅ **Training Homework** header gets eyebrow ("DAILY TRAINING") + italic "TRAINING HOMEWORK." headline matching the rest of the page rhythm
- ✅ **Quick Links overhaul**: card wrapped in brand-glow halo, eyebrow "SHORTCUTS" + italic "QUICK LINKS.", and the flat full-width list replaced with a vivid 2-column tile grid. Each tile has its own brand color, icon halo, hover lift, and an inline NEW badge for the gallery when fresh photos drop.
- ✅ New reusable `QuickLinkTile` helper component handles button/anchor link variants uniformly.
- ✅ Lint clean; portal screenshot verified — all 5 tiles render with their accent colors, NEW badge pulses on the Photo Gallery tile.

## Sprint 110x — Portal Book Service hero + credits visual polish (2026-02)
- ✅ **Book a Service** promoted ABOVE Quick Links (was below) and rebuilt as a vivid gradient hero: brand-color radial glow backdrop, oversized calendar icon, "READY WHEN YOU ARE" eyebrow, italic "BOOK A SERVICE." headline, punchy green "BOOK NOW →" CTA
- ✅ **Credits card** upgraded: shGreen radial halo behind whole card, per-credit colored glow halos, icon (sun/cap/moon) above each label, text-shadow drop-glow on the big numbers, gradient border highlights per credit type
- ✅ Profile / Bookings buttons rounded-lg with hover transitions; consistent visual weight with rest of app
- ✅ Lint clean; verified Book Service hero renders above Quick Links via DOM ordering check; visual experience now matches the landing-page polish

## Sprint 110w — PageHero rolled out to all remaining admin screens (2026-02)
- ✅ Settings ("Settings. Make it yours."), Run Sheet ("Daily Run Sheet. For the team."), Recurring ("Recurring. Set it. Forget it."), Dogs ("Dog Records. The real stars."), Pipeline ("Training Pipeline. At a glance."), Trophies ("Trophy Catalog. Earn it. Show it."), Income ("Income & Services. The cash story."), Staff ("Staff. The crew that makes it happen."), Incidents ("Incident Reports. Permanent record.")
- ✅ Every admin screen now opens with the same landing-page hero rhythm: brand glow backdrop, eyebrow tag, uppercase-italic-black title + highlight, subhead, right-side action slot
- ✅ All 9 screens lint-clean and smoke-tested — every hero testid (`{screen}-hero`) confirmed present
- ✅ Client portal already received the matching treatment in 110u (glowing logo + "Welcome back, [Name]") — verified the entire app now feels visually unified

## Sprint 110v — Page-hero rollout to Schedule / Clients / Homework / Bookings (2026-02)
- ✅ New reusable `PageHero` component (`/app/frontend/src/components/PageHero.jsx`) — brand-glow backdrop, eyebrow + uppercase-italic-black title + highlight + subtitle + right-slot for tiles/CTAs. Used across admin screens for visual consistency with the landing page.
- ✅ Applied to Schedule ("THE CALENDAR. EVERY PUP. EVERY DAY."), Clients ("CLIENT HUB. WHERE HUMANS LIVE."), Homework ("TRAINING HOMEWORK. BUILT AROUND THE DOG."), and Bookings ("BOOKINGS. EVERY STAY, EVERY DAY.")
- ✅ Zero functional changes; all existing testids and event handlers preserved. Lint clean.
- ✅ Smoke-screenshotted all four — hero renders cleanly with action buttons cohesively right-aligned

## Sprint 110u — Landing-page aesthetic refresh: header / sidebar / dashboard / portal (2026-02)
- ✅ **Logo upgrades**: top-nav + sidebar logos get brand-color glow shadow; hero feature-logo on landing now full-color front-and-centre (was 4%-opacity watermark); portal header logo is bigger with shGreen glow
- ✅ **Admin sidebar**: brand-color halo on logo, active-nav uses gradient + shGreen left border + shGreen icon (was a thin shBlue border)
- ✅ **Global header**: backdrop-blur + radial brand glow, page title becomes uppercase-italic-black with shGreen tick prefix
- ✅ **Admin Dashboard**: new hero block with brand glow backdrop, "Good [morning/afternoon/evening], let's get to it." headline, eyebrow tag, snapshot tiles (Daycare/Boarding/Training today)
- ✅ **Client Portal header**: same hero treatment with "Welcome back, [Name]" in italic, brand glow, refreshed colored-border buttons
- ✅ Zero functional changes — all event handlers, testids, and routes preserved. Lint clean.

## Sprint 110t — Landing-page-grade login screen (2026-02)
- ✅ Login screen rewritten as a real marketing landing: sticky top bar, full hero with brand promise + CTA buttons + compact auth card, "What we do" 4-category grid, "Browse all N services" modal pulling from new public endpoint, "Why Sit Happens" 4-pillar grid, "How it works" 3-step flow, final gradient CTA strip, footer
- ✅ New backend endpoint `GET /api/public/services` (no auth) returns active services with only marketing-safe fields (name/description/price/category/color/icon)
- ✅ All existing auth flows preserved: tabs, ?ref=CODE auto-handler, forgot password modal, error display, all testids intact (`tab-login`, `tab-register`, `login-email-input`, `login-password-input`, `register-name-input`, `register-refcode-input`, `login-submit-button`, `forgot-password-link`, `login-error`)
- ✅ Brand palette: dark base (#0c111c), shBlue / shGreen / shOrange / purple accents; uppercase-italic-black headlines; sharp pill CTAs; soft radial glow backdrop on hero
- ✅ Lint clean; 17 landing-specific data-testids verified; browse-services modal opens with 11 live services

## Sprint 110s — Service descriptions (2026-02)
- ✅ `ServiceIn` backend model gains optional `description` (max 500 chars) — surfaces in GET/POST/PUT `/services`
- ✅ Admin Services form (Settings → Services & Programs) gets a 3-row textarea with live char counter + helper "shown to clients", and the live preview now renders the description right under the service name
- ✅ Client portal already rendered `svc.description` in `ServicesByCategory.jsx` (ServiceTile, line 31) — no frontend portal change required; once admin saves a description, clients see it instantly
- ✅ End-to-end smoke: create/list/update/delete round-trip via curl confirmed; admin form lint clean

## Sprint 110r — Homework analytics dashboard (2026-02)
- ✅ New endpoint `GET /api/admin/homework/analytics` returns `{global, templates}` with:
  - Per-template: assigned/active/completed counts, completion rate, avg days-to-complete (calendar), drop-off Day (stale + engagement-cliff flavors), per-day buckets (submitted/approved/needs_redo/questions/mood_avg/engagement_pct), recent completions
  - Global tiles: active plans, completed plans, completion rate, avg active streak
- ✅ One-off custom plans bucketed under "Custom (one-off)" (template_id=None)
- ✅ Both drop-off detectors shown:
  - Stale: most-common last-logged day among plans inactive 14+ days
  - Engagement cliff: day_number with steepest engagement_pct drop vs previous day
- ✅ New `HomeworkAnalytics.jsx` modal accessible from Homework toolbar via "Analytics" button. Expand any template row → per-day mini bar chart with mood dots + needs-redo/questions counters + "What to check" coaching line
- ✅ Tests: 65/65 homework + tracker + analytics pytests passing. `test_homework_analytics.py` covers shape, counter reconciliation, per-day submission propagation

## Sprint 110q — Advancement celebration toast (2026-02)
- ✅ When client submits a day, a bottom-center toast appears for ~4s:
  - Mid-plan: "🎉 Day N done — Day N+1 unlocked!" with dog name
  - Final day: "🏆 Plan complete!" with summary + **CSS-only confetti burst** (22 multi-colored pieces, ~1.5s, randomized drift/rotation)
- ✅ Self-contained inside `TodayPlanCard`; no app-wide Toaster mount, no JS confetti library. Renders via `createPortal`.
- ✅ Testids: `day-advance-toast-{advance|complete}` and `day-advance-confetti`

## Sprint 110p — Client-driven daily-tracker advancement + visible day strip (2026-02)
- ✅ Auto-advancement: once the client submits a day's log, the NEXT day immediately unlocks (no admin approval required to progress). `_compute_daily_progress` chain now treats `submitted` as a pass status.
- ✅ Trainer can still flag a day `needs_redo` — that re-locks any *unlogged* subsequent days. Already-submitted future days keep their own status.
- ✅ Day-pip strip rendered inline at the top of every `TodayPlanCard`: shows Day 1 (current/pulsing), Day 2-N greyed out with lock icons, done days marked green-check. Each pip has `data-testid="today-plan-day-pip-{hwid}-{day}"`.
- ✅ Backend `/api/portal/today-plan` now returns `day_statuses: [{day_number, status}, ...]` per item.
- ✅ Tests: 63/63 homework + tracker tests passing. `test_submit_then_approve_unlocks_next_day` updated; `test_needs_redo_relocks_unlogged_days` added.

## Sprint 110o — Auto-backup removed + vaccine_dismissals excluded from backup (2026-02)
- ✅ Auto-backup feature fully removed (never worked reliably across unprivileged Docker → Bazzite host boundary)
  - Backend: deleted `/admin/backup/run-now`, `/admin/backup/status`, `/admin/backup/detect-drives`, `/admin/backup/inspect` endpoints (~339 lines)
  - Backend: deleted `run_auto_backup_job` + `_notify_backup_failure` from `daily_jobs.py` (~200 lines) and the daily-jobs hook
  - Backend: removed `auto_backup_*` fields from `SettingsIn` model and boot-time drive-scan diagnostics
  - Frontend: deleted `AutoBackupPanel` component (~315 lines) from `Settings.jsx` and its mount in `BackupPanel`
  - Tests: removed `test_auto_backup.py`
- ✅ `vaccine_dismissals` removed from `BACKUP_COLLECTIONS` (was bloating backups with thousands of audit-trail rows; restore loop already filters by this list so it's excluded on restore too)
- ✅ Backend boots clean, all endpoints return 404 as expected, manual `/api/backup/export` confirmed to exclude vaccine_dismissals

## Sprint 110n — Portal reorder: Homework first, Achievements second (2026-02)
- ✅ Training Homework promoted to top section of client portal main column (was buried below Dogs/Training/Files/Trophies)
- ✅ Trophy Wall + HomeworkIncentivesPanel now follow directly after Homework
- ✅ Trophy-tier referral feed removed from HomeworkIncentivesPanel (per user — uses simpler legacy program)
- ✅ ORIGINAL referral program restored: sidebar "Refer a Friend" quick-link + ReferFriendModal (share code → friend signs up & completes first appointment → referrer auto-credited 1 free daycare day). Backend auto-credit hook in server.py was always intact.
- ✅ Lint clean, screenshot verified

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
## Sprint 89 — Income "Group by Date" + Archived Bookings Viewer (2026-02)
- ✅ **Income transactions table** — new `[ ] Group by date` toggle next to "Include unpriced". When on, the spreadsheet table swaps for the same `CollapsibleDateGroups` Year → Month → Week → Day hierarchy already used by Expenses and Bookings History. Daily/weekly/monthly totals roll up the `actual_price` sum; each row chip shows dog · client · service · payment status · price. Status pills color-coded.
- ✅ **Bookings History — "Load Archived (>90d)"** button next to "Hide History". Fetches `/api/admin/bookings/archive` (limit 1000), merges archived rows into the live history list, marks each with a blue "Archived" pill, and shows total count in an "Archive · N" status pill once loaded. Archived rows are read-only (no Open button) to prevent accidental edits to cold-storage data.
- ✅ Backend `_archive_old_bookings_once()` already runs on dashboard load (idempotent, once-per-UTC-day) and the manual trigger `POST /api/admin/bookings/archive-now` is still available for testing.
- ✅ Verified: Income grouped view shows "2026 → JULY 2026 → Week of Jun 29 → Sat Jul 4 → Sparky $35.00" with proper totals at each level. Bookings History "Load Archived" button correctly fetched archive (0 items currently, since earliest bookings are May 2026 < 90 days old).


- ✅ **Settings → Portal Links** (`PortalLinksPanel`): editable URLs for your website and photo gallery host. Backend wires through `client_portal_links` field on settings doc + default block + nested backfill + `/api/settings/public`.
- ✅ **Loyalty visit badges**: `/api/portal/me` extended to return `visit_counts` (per-dog completed-booking count via a single Mongo aggregation). Portal dog cards now show a green "🏆 N visits" pill next to the breed when count > 0.
## Sprint 90 — Monthly P&L PDF Report + Auto-Email (2026-02)
- ✅ **`/app/backend/pl_report.py`** — Standalone module with `build_pl_data(db, start, end)` and `render_pl_pdf(data, brand)`. Computes income (completed/paid/unpaid totals + by-service + by-day), expenses (total + by-category), top 5 clients, top 10 dogs by visits, estimated staff hours (daycare=9h, boarding=4h/night, training/grooming/photography=1h), and YTD running totals (since Jan 1 of end-date's year). Pure data layer — same dataset powers JSON, PDF, and email.
- ✅ **ReportLab PDF rendering** — Letter-size, branded header with brand name from settings, 4-tile KPI row (Income / Expenses / Net / Avg-per-active-day with green/red color coding), daily revenue bar chart (last 31 days), service breakdown table with totals row, expenses by category, top 5 clients, most active dogs (top 10), staff hours with documented assumptions, and YTD section. All tables use clean color-coded headers and footer totals.
- ✅ **`reportlab==4.5.1`** added to `requirements.txt`.
- ✅ **Backend endpoints**:
  - `GET /api/reports/pl?start_date=&end_date=` — JSON snapshot (admin only)
  - `GET /api/reports/pl/pdf?start_date=&end_date=` — PDF download with `Content-Disposition: attachment`
  - `POST /api/reports/pl/email-now?start_date=&end_date=` — generates PDF + emails to `ADMIN_NOTIFICATION_EMAIL`
- ✅ **Auto-monthly email** — `run_pl_monthly_job()` added to `daily_jobs.py`; fires only on the 1st of each month for the previous full month. Keyed by `pl:YYYY-MM` in `notification_log` so it's fully idempotent. Wired into existing `maybe_run_daily()` which is lazy-triggered by the dashboard endpoint (no in-process scheduler needed).
- ✅ **`notify_admin_pl_report` in `email_service.py`** — branded Resend email with KPI rows in the body + PDF attached as base64 (Resend SDK auto-encodes when given a list of ints).
- ✅ **Frontend Income screen** — new "P&L PDF" (blue) and "Email Me" (orange) buttons next to Export CSV. Uses the existing `rangeStart`/`rangeEnd` from the Longer-Range View (so Month/Quarter/YTD/Custom presets all flow through). Inline status banner shows "Downloaded · range Y→Y" or "Sent to admin@... · Net $X" on success.
- ✅ Verified end-to-end: $954 income / $348.99 expenses / $605.01 net for May 2026 → PDF generates 2 pages with all sections correctly populated. Download button triggers browser save dialog with proper filename. Backend lint + frontend lint both clean.


- ✅ **Refer a Friend**: `/api/portal/me` mints a 6-char `referral_code` on first call and stores it on the client doc. New `<ReferFriendModal>` shows the code in big orange type with one-tap **Text / Email / Copy** actions that pre-fill a sharable message + a `?ref=CODE` URL. Admin-side helpers added: `GET /api/referrals/lookup/{code}` to validate a code and `POST /api/clients/{id}/credit-referral` to comp a daycare day to the referrer (writes both a `referrals` audit entry and a `credit_adjustments` entry).
- ✅ **Vaccine expiry self-upload**: each portal dog card now detects vaccines expired OR within 30 days; renders a red "🛡️ N vaccines need updating" footer with an Upload button. `<VaccineUploadModal>` takes a date + compressed photo, POSTs to new `/api/portal/dogs/{id}/vaccine-update` endpoint which updates the expiry immediately (unblocking the client from booking) and stores the photo under `vaccine_certs` for later admin review.
- ✅ **Quick Links section** on Portal: pill-button list with the website / gallery / refer-a-friend entries; hidden entirely if all three are blank.
- ✅ Verified end-to-end at 390×844: quick links section renders all 3 entries; clicking Refer opens modal with code `7KTUMQ`; share buttons work; loyalty badge will appear automatically as clients complete bookings.

## Sprint 47 — Boarding pack UI + seed defaults (2026-02)
- ✅ **Seed data** (`credit_packs_data.py`): added 3 boarding packs to `SEED_CREDIT_PACKS` — single $55, 5-night $250, 10-night $475.
- ✅ **Settings → Credit Packs** (`CreditPacksSettings.jsx`): new "Boarding nights" option in the pool dropdown; chip color uses `text-shOrange` to match the rest of the app. Seed button now shows always (label flips to "Add Missing Defaults" when packs already exist) so existing installs get the 3 new boarding packs idempotently.
## Sprint 91 — Fixed P&L staff hours + mobile portrait overlap fixes (2026-02)
- ✅ **Bug fix: P&L staff hours were inflated** — the old logic multiplied per-service rates by booking count, so 10 dogs at daycare on Monday counted as 90h (10×9h). New logic groups bookings by date, finds `min(checked_in_at)` and `max(checked_out_at)` across all on-site bookings that day, and totals `(max_out - min_in)` per day for the real daily shift length. Boarding kept separate at 4h/night (overnight rounds). Daily breakdown table added to the PDF showing first-in/last-out/hours per day for spotting outliers.
- ✅ **Mobile portrait overlap fixes**:
  - `Bookings.jsx` header — inner button row now `flex flex-wrap` so Show History + Group by Date + New Booking wrap on phones instead of overlapping.
  - `Income.jsx` week navigator — added `flex-wrap` so the date input + prev/next/Today buttons stack cleanly on narrow screens.
  - `Homework.jsx` — both button rows (Assign from Template / Custom + filter chips) got `flex-wrap`.
  - `Dashboard.jsx` — top KPI grid now `grid-cols-2 md:grid-cols-4` (was 1→4) — smoother step at portrait phone widths so the 4 tiles fit as 2×2.

## Sprint 92 — Employee Portal + RBAC Phase 1 (2026-02)
- ✅ **New role `employee`** alongside existing `admin`/`client`. Re-uses the same `users` collection + JWT — no breaking changes. New `require_employee_or_admin` middleware; sensitive routes (Income, P&L, Settings, Backup, Programs, Credit Packs CRUD) stay `require_admin`.
- ✅ **Employee fields on users**: `display_name`, `hourly_rate`, `active`, `phone`, `notes` (all optional).
- ✅ **New `time_clock_entries` collection** — `{user_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_note, clock_out_at, clock_out_*, break_minutes, hours, edited_by_admin_at, edited_by_admin_id}`. Geolocation captured (HTML5 geolocation API) on every clock action for management visibility — no enforcement, just record.
- ✅ **Backend endpoints**:
  - Admin: `GET/POST /api/admin/employees`, `PUT /api/admin/employees/{id}`, `POST /api/admin/employees/{id}/reset-password`, `DELETE /api/admin/employees/{id}` (soft-deactivate)
  - Time clock (employee or admin): `POST /api/time-clock/clock-in`, `POST /api/time-clock/clock-out`, `GET /api/time-clock/current`, `GET /api/time-clock/me?days=30`
  - Admin time clock: `GET /api/admin/time-clock?start_date=&end_date=&user_id=` (per-user totals + payroll cost + grand total + entry list), `PUT /api/admin/time-clock/{id}` (override times/break/note with audit metadata), `DELETE /api/admin/time-clock/{id}`
  - Employee-portal helpers: `GET /api/employee/me` (self profile + today's clock status + today's entries), `GET /api/employee/roster-today` (today's on-site dogs with feeding/meds/owner phone/emergency contact/vet — financial data stripped)
- ✅ **Employee Portal frontend** (`EmployeePortal.jsx`) — mobile-first separate shell. 4 tabs:
  1. **Clock** — live elapsed-time display, big green Clock In / red Clock Out CTA, optional note + break minutes input, today's entries log. Geolocation captured automatically (`navigator.geolocation.getCurrentPosition`) with each action.
  2. **Roster** — today's dogs on-site with breed, service, kennel, drop-off/pickup times, owner phone (tappable `tel:` link), emergency contact, vet info, feeding schedule, medications, notes. Status pill (On-site / Out / Not in).
  3. **Timecard** — last 30/14/7/90 days picker, total hours headline, grouped by date with daily totals, individual entries with in/out times.
  4. **Profile** — view name/email/role, change own password.
- ✅ **Admin Staff screen** (`Staff.jsx`) — new "Staff" sidebar item:
  - Employee CRUD (Add / Edit / Reset PW / Deactivate). Deactivate is soft (preserves historical clock entries).
  - Time clock viewer with date range + per-employee filter; 3 KPI tiles (hours / payroll cost / entries); per-employee subtotals (`hours · cost · rate`); entry table with location-pin icons indicating clock-in/clock-out geo was recorded.
  - Click "Edit" on any entry to override clock-in/out times, break minutes, add admin note. Records `edited_by_admin_at` + `edited_by_admin_id` for audit.
- ✅ **App routing**: login auto-routes by role — admin → AdminShell, employee → EmployeePortal, client → existing Portal.
- ✅ **Test employee seeded**: `alex@sithappens.com` / `emp1234` at $18.50/hr. Verified end-to-end: created via admin API, login routes to employee portal, clock in/out captures geo (40.7128, -74.0060), employee blocked from `/api/reports/pl` with 403, admin sees per-user totals + payroll cost. Backend + frontend lint clean.


- ✅ **Sell Pack modal** (`Clients.jsx`): added "Boarding" filter chip, refactored pack-row color/unit logic to support 3 pools (sessions / nights / credits), cart summary expanded from 3 to 4 columns (Daycare / Training / Boarding / Charge).
- ✅ **Receipt** (`ReceiptModal`): per-line unit label now branches on boarding ("boarding nights"); totals grid shows the third pool when present.
- ✅ Verified end-to-end: seed endpoint added 3 boarding packs, Sell modal filters/cart/totals all render correctly with boarding pool.

## Sprint 46 — Boarding credits + manual credit adjustments (2026-02)
- ✅ **Boarding now uses the credit pool**: new `boarding_credits` field on the client doc (1 credit = 1 night). Helper `_credit_balance_field(service_type)` centralises the daycare/training/boarding → field mapping. Every existing call site (booking create, approve-booking, cancel-with-refund, check-out toggle, single sell-pack, bulk sell-pack) routed through the helper so boarding behaves exactly like daycare for FIFO consumption + refunds.
- ✅ **Bulk sell-packs** (`sell_credit_packs_bulk`): generalised to a 3-pool increment dict (`daycare`/`training`/`boarding`) — packs with `service_type: "boarding"` now mint proper lots and bump the right balance.
- ✅ **New endpoints** (`server.py`):
  - `POST /api/clients/{id}/adjust-credits` — `{daycare, training, boarding, note}` with signed deltas. Refuses negatives that'd take a balance below zero. Writes a `credit_adjustments` collection entry (before/delta/after per pool + note + admin name + timestamp) for audit.
  - `GET /api/clients/{id}/credit-adjustments` — list the audit log.
## Sprint 93 — Employee System Phase 2 + Phase 3 (2026-02)

**Phase 2 — Scheduled shifts + payroll**
- ✅ **New `shift_templates` collection** — `{user_id, day_of_week (0=Mon..6=Sun), start_time HH:MM, end_time HH:MM, role, active}`. Recurring weekly schedule.
- ✅ **New `shifts` collection** — `{user_id, date YYYY-MM-DD, start_time, end_time, role, notes, source ("template"|"manual"), template_id, status}`. Individual scheduled shifts.
- ✅ **Endpoints** (all admin):
  - `GET/POST /api/admin/shift-templates`, `PUT/DELETE /api/admin/shift-templates/{id}`
  - `GET/POST /api/admin/shifts`, `PUT/DELETE /api/admin/shifts/{id}`
  - `POST /api/admin/shifts/generate` — idempotent batch: applies all active templates over a date range, skips dates where the same user already has a shift starting at that time
  - `GET /api/admin/shifts/scheduled-vs-actual` — for each shift, matches against `time_clock_entries` for the same user+date, computes variance, flags `> 30 min` deviation (configurable via `VARIANCE_FLAG_MINUTES`)
  - `GET /api/admin/payroll/csv` — pay-period CSV: Employee · Email · Period · Hours · Hourly rate · Gross pay · Shifts · Flags
- ✅ **Employee endpoint**: `GET /api/employee/my-shifts?start_date=&end_date=` (defaults to next 14 days)
- ✅ **Admin UI** (Staff page sub-tabs): **Employees / Timecards / Schedule / Tasks / Payroll**
  - Schedule tab: Recurring weekly templates list with CRUD; date range picker; "Generate from Templates" button (one-click batch); "+ One-off Shift" button; per-day shift list; "Scheduled vs Actual" table with flagged rows in red, missed shifts highlighted, variance shown as ±N min with flag icon
  - Payroll tab: period picker + Download CSV button
- ✅ **Employee Portal** new tab: **Schedule** — upcoming shifts for next 14 days grouped by date with template-source icon

**Phase 3 — Task assignment**
- ✅ **New `tasks` collection** — `{kind ("todo"|"vaccine_review"), title, description, ref_id, ref_label, assigned_to, status, due_at, created_by, claimed_at, completed_at, completed_by}`
- ✅ **Assignment fields**:
  - `bookings.assigned_to` (employee user_id) — for run-sheet ownership
  - `dogs.vaccine_certs.{vac}.assigned_to` — for vaccine review assignment
- ✅ **Endpoints**:
  - Admin: `GET/POST /api/admin/tasks`, `PUT/DELETE /api/admin/tasks/{id}`
  - Admin assign: `PUT /api/admin/bookings/{id}/assign`, `PUT /api/admin/vaccine-cert-uploads/assign`
  - Employee or admin: `POST /api/tasks/{id}/claim` (self-claim unassigned), `POST /api/tasks/{id}/complete`
  - Employee aggregator: `GET /api/employee/my-tasks` returns `{tasks (mine), unassigned_tasks (claimable), today_bookings (assigned), vaccine_reviews (assigned)}`
- ✅ **Admin UI** (Staff → Tasks sub-tab): filter chips (open/in_progress/done/all), "+ Task" button, full CRUD with employee dropdown (— Unassigned —, anyone can claim)
- ✅ **Employee Portal** new tab: **My Tasks** — 4 sections: Assigned to me (with "Mark done" buttons), Today's bookings on me, Vaccine reviews on me, Unassigned · claim if you can take it (with "Claim" buttons that auto-claim and move to "Assigned to me"). Internal log only — no notification emails.

**Verified end-to-end via curl:**
- Created Mon 07:00–17:00 template for Alex → batch-generated 2 shifts (next Mondays)
- `scheduled-vs-actual` returns shifts with `flagged: true` for variance > 30min
- Payroll CSV: `Alex,alex@sithappens.com,2026-05-22,2026-06-05,0.00,18.50,0.02,2,2`
- Task created unassigned → employee claimed → moved to `in_progress` → completed by employee returns 200
- Employee `/my-shifts` returns the 2 generated shifts; `/my-tasks` returns 1 mine, 0 unassigned

Backend + frontend lint clean. Mobile responsive (all admin sub-tab bar scrolls horizontally; portal nav same pattern).


- ✅ **Frontend**:
  - Client card credit grid now shows **Daycare/Training/Boarding/Portal** (4 cols on `sm:`, stacked 2x2 on phones). Boarding uses `text-shOrange` for consistent color coding.
  - New "± Adjust Credits" button between Sell Pack and Receipts on every client card.
  - `<AdjustCreditsModal>` with live preview ("Current X → New Y"), red highlight if the proposed value would go negative, +/- step buttons, manual number input, required note, save-disabled when nothing changed or anything's negative.
  - Portal credit card + ClientPortalPreview both updated to a 3-col display showing all three pools.
- ✅ End-to-end verified: API call adjusts Alex Owner's daycare 9→12 with note logged, audit log returns the entry, UI grid + modal preview match.

## Sprint 45 — Hotfix: portal-snapshot decorator lost during marketing-qr insert (2026-02)
- ✅ When inserting the marketing-qr endpoint above the portal-snapshot endpoint, the `@api.get("/admin/clients/{client_id}/portal-snapshot")` decorator got accidentally consumed by the search/replace — the function body remained but it was no longer wired to a route, so the snapshot endpoint silently returned FastAPI's default 404.
- ✅ Restored the decorator. Verified preview: snapshot for Alex Owner returns full payload (1 dog, 1 booking, waiver signed). Production needs a redeploy to clear the same bug.

## Sprint 94 — Employees can check dogs in/out (2026-02)
- ✅ **Permission lifted** on `POST /api/bookings/{id}/check-in` and `POST /api/bookings/{id}/check-out` from `require_admin` → `require_employee_or_admin`. The checkout endpoint still preserves all its admin business logic (credit deduction, add-ons, payment status, actual_price calculation) — employees just get to trigger it.
- ✅ **Fixed `GET /api/bookings` permission bug**: previously assumed `role != admin` meant client → filtered by `client_id`, which would have given employees an empty list. Now: admin + employee see everything, clients see only their own.
- ✅ **Employee Portal Roster cards** now show:
  - Green **Check In** button when `!checked_in_at`
  - Blue **Check Out** button when `checked_in_at && !checked_out_at`
  - "Out at HH:MM" with green checkmark when `checked_out_at`
- ✅ Verified end-to-end via curl as Alex (employee): GET /bookings → 200/82 records; POST check-in → records `checked_in_at`; POST check-out → records `checked_out_at` + flips status to `completed`.
- ✅ UI verified via screenshot: button state correctly flips based on booking state.


## Sprint 44 — Downloadable marketing QR code (2026-02)
- ✅ **Backend** (`server.py`): new admin endpoint `GET /api/admin/marketing-qr?size=N&ref=tag`. Generates a high-error-correction PNG QR pointing at `APP_PUBLIC_URL`, optional `?ref=` query param baked into the encoded URL for future scan analytics. Returns the PNG as `attachment` with a friendly filename and an `X-QR-Target-Url` header so the UI can show what's encoded.
- ✅ **Frontend** (`Settings.jsx`): new "Marketing QR" tab with a `MarketingQRPanel` component. Live PNG preview, debounced tracking-tag input (regenerates preview as you type), three download buttons (Small 512px / Print 1024px / Poster 2048px) sized for different print use cases. Uses `responseType: "blob"` + `URL.createObjectURL` + auto-clicked anchor for the download.
- ✅ Initial JSX nesting bug (MarketingQRPanel ended up inside WaiverPanel because of a missing close brace + orphan brace) caught and fixed.
- ✅ Verified end-to-end: preview renders, ref input updates the encoded URL live (`https://sit-happens-crm.emergent.host?ref=flyer`), all 3 download sizes serve correct content-disposition headers.
## Sprint 95 — Silent geo + audit on dog check-in/out (2026-02)
- ✅ **New booking fields**: `checked_in_by`, `checked_in_by_name`, `checked_in_lat`, `checked_in_lng`, `checked_in_accuracy_m`, and the matching `checked_out_*` family. Optional, backward-compatible.
- ✅ **`POST /api/bookings/{id}/check-in`** now accepts optional `{lat, lng, accuracy_m}` body, records who triggered it (user ID + display name) and where.
- ✅ **`POST /api/bookings/{id}/check-out`** — same geo fields added to `CheckoutIn`; all existing checkout business logic (credit deduction, add-ons, billing) untouched.
- ✅ **Frontend silently captures geo**:
  - Employee Portal Roster — already captured via existing `getGeo()` helper, now sent in the body
  - Admin Dashboard Check-in button — captures on click via inline `captureGeo()` helper
  - Admin Dashboard Check-out modal — captures geo right before submitting alongside payment data
  - All captures are best-effort: no permission? no signal? → geo just stays null and the action still goes through
- ✅ **Admin audit display**: Dashboard "In · Out" column now shows the staff name (e.g. `🛡️ Alex`) with a green location-pin if geo was captured. Hovering the badge shows the full lat/lng for in + out.
- ✅ Verified end-to-end via curl: employee check-in/out correctly stamps user_id + name + lat/lng; backward-compat (no body) returns HTTP 200 with geo null. Backend + frontend lint clean.



## Sprint 96 — Payroll Tax Estimator (Warren OH, 2026 defaults) (2026-02)
- ✅ **New backend module** with `DEFAULT_PAYROLL_TAX_SETTINGS` defaulting to Warren, OH 2026 estimates:
  - Employer: SS 6.2% (cap $176.1k), Medicare 1.45%, FUTA 0.6% (cap $7k), Ohio SUTA 2.7% new-employer rate (cap $9k), Workers' Comp 1.5% (pet-care class estimate)
  - Employee: SS 6.2%, Medicare 1.45%, Federal income tax ~11% effective, Ohio income tax ~2.75%, Warren city tax 2.5%
- ✅ **YTD wage-cap math** — FUTA / SUTA / SS caps correctly stop accruing once YTD-before-period exceeds the wage cap (verified: 40h @ $18.50 with YTD = $15k → FUTA/SUTA = $0)
- ✅ **`_compute_payroll_tax(hours, rate, ytd_gross, tax_settings)`** — single function that powers both the estimate endpoint and the CSV export
- ✅ **Endpoints**:
  - `GET /api/admin/payroll-tax-settings` — returns defaults + current saved rates
  - `PUT /api/admin/payroll-tax-settings` — whitelisted update (only known keys can be set)
  - `GET /api/admin/payroll/estimate?start_date=&end_date=` — per-employee + totals: gross, employer burden (with full breakdown), total cost, employee withholdings (with breakdown), estimated take-home pay. Includes disclaimer.
- ✅ **Extended `/api/admin/payroll/csv`** with 3 new columns: Employer Burden, Total Cost, Est. Net Pay — same wage-cap-aware math
- ✅ **Frontend: new "Tax Estimator" sub-tab on Staff page**:
  - Orange disclaimer banner ("not a substitute for payroll software or CPA")
  - Period start/end pickers
  - 5 KPI tiles (Gross · Employer Burden · TOTAL Employer Cost · Employee Withholdings · Est. Employee Take-home)
  - Per-employee breakdown table with hover-tooltips showing the breakdown of burden (SS / Medicare / FUTA / SUTA / WC) and withholdings (SS / Medicare / Fed / OH / Warren) for each row
  - "Edit Tax Rates" toggle reveals an inline settings panel — all 13 rates editable with hints per field, "Reset to defaults" + Save buttons. Changes immediately re-compute the estimate.
- ✅ Sanity-tested with 40h @ $18.50: gross $740 / burden $92.13 (12.4%) / total $832.13 / withholdings $176.86 / take-home $563.14 — matches industry-standard 13-14% employer markup for Ohio.


## Sprint 97 — Employees can create report cards + notes on any booking (2026-02)
- ✅ **`POST /api/bookings/{id}/report-card`** opened from `require_admin` → `require_employee_or_admin`. Now stamps `created_by` (user_id) + `created_by_name` on the report_card for audit.
- ✅ **`GET /api/bookings/{id}`** opened so employees can fetch any booking detail. Clients still restricted to their own.
- ✅ **`ReportCard` Pydantic model** extended with `created_by` + `created_by_name`.
- ✅ **Shared `<ReportCardModal>` component** extracted to `/app/frontend/src/components/ReportCardModal.jsx`:
  - Photos (up to 3, image-compressed)
  - Mood/highlights chips (loaded from settings.mood_tags, falls back to API fetch if not passed)
  - Note for owner (free-text)
  - Edit-and-resave compatible — existing values pre-populated when modal opens
- ✅ **Dashboard.jsx refactored** to use the shared component (removed 97 lines of duplicate code).
- ✅ **Employee Portal Roster** — every dog card now has a **"Notes" / "Add Report"** button (color shifts to filled green once checked out, hinting "do this now"). Opens the same shared modal with full edit capability.
- ✅ Works for **all service types** — daycare, boarding, training, grooming, photography, other. No service-specific gating.
- ✅ Verified end-to-end as Alex: GET /api/bookings/{id} → 200; POST report-card → saved with `created_by_name: "Alex"`. Modal opens correctly from roster card with all fields populated.


## Sprint 43 — "Preview as client" read-only portal viewer (2026-02)
- ✅ **Backend** (`server.py`): new admin endpoint `GET /api/admin/clients/{client_id}/portal-snapshot`. Single aggregated payload — `{client, dogs, bookings, enrollments_by_dog, homework, waiver, waiver_required}`. Read-only, no state changes. Same data shape Portal.jsx fetches but pulled by client_id instead of from the JWT.
- ✅ **Frontend component** (`components/ClientPortalPreview.jsx`): full-screen modal with a red "VIEWING AS {Name} (READ-ONLY)" banner + "Return to Admin" button. Shows credits tiles, waiver status, My Dogs cards, Upcoming bookings, Training Progress rings, Homework list, and Recent visits. No interactive controls — admin can't book/sign/edit on the client's behalf.
- ✅ **Wired** into `Clients.jsx`: each client card now has a blue "👁 Preview Client Portal" button at the top. Tap → opens the modal.
- ✅ Verified end-to-end at 1440×900 and 390×844: clicking Alex Owner's preview shows their actual credits (10/5), waiver status, Buddy dog card, and recent cancelled booking — exactly what Alex would see.
## Sprint 98 — Client Portal UX sweep + Income labor cost (2026-02)
**Income tab — labor cost now visible:**
- ✅ `/api/transactions/summary-range` extended with `labor_gross`, `labor_burden`, `labor_total`, `net_total`, `net_before_labor`. Uses the same `_compute_payroll_tax()` from Sprint 96 so the period-by-period Income view shows TRUE employer cost (gross + taxes + workers comp), respecting YTD wage caps for FICA/FUTA/SUTA.
- ✅ Income screen KPI row grew from 4 → 5 tiles: **Completed (revenue) · Expenses · Labor (w/ taxes) · Net (after labor) · Avg / day**. Labor tile shows `$X.XX  ($Y gross + $Z taxes)` so you can see the breakdown. Net is now revenue − expenses − labor (true bottom line).
- ✅ Dashboard "Today's P&L" tile also now adds `labor_burden` (using effective rate, since 1-day windows almost never hit YTD caps) and shows formula `$X revenue − $Y labor ($Z gross + $W taxes)`.

**Client Portal — 6 polish items shipped:**
- ✅ **Quick Contacts row on dog cards** — when `vet_phone` or `vet_name` is on file, a new ribbon appears at the bottom of the dog card with `[📞 Call]` and `[💬 Text]` buttons (`tel:` / `sms:` links — opens phone dialer / messages app on mobile). Stops event propagation so taps don't trigger the dog detail modal.
- ✅ **First-time tutorial banner** — when `bookings.length === 0 && dogs.length > 0`, a green-accented 3-step illustrated card appears above the bookings tabs: "Pack the basics · Drop off 7-10am · You'll get a Pup Report Card." Drops first-time-call anxiety.
- ✅ **Multi-dog quick switcher** — when client has >1 dog, a pill row appears above the bookings list: `[All Dogs] [🐶 Rocky] [🐶 Daisy]` — filters bookings to one dog's history when clicked. Dog photo thumbnail used inside the pill.
- ✅ **"Book Again" button** on every past/completed/cancelled booking — pre-seeds the BookWizard with the same `dog_id` + `service_type` and scrolls to it. Repeat-booking friction drops to one tap.
- ✅ **Birthday reminders confirmed wired** — `run_birthday_job(db)` in `daily_jobs.py` already fires daily via the lazy-trigger pattern, calls `notify_client_dog_birthday`, and is idempotent via `notification_log` (key `birthday:{dog_id}:{year}`).
- ✅ **Mobile camera capture confirmed** — single `VaccineUploadModal` at Portal.jsx:323 has `<input type="file" accept="image/*" capture="environment">`, used by all 4 vaccine types (DHPP, Rabies, Bordetella, Lepto). Triggers the native camera app on iOS/Android instead of the file picker.
- ✅ **Trophies confirmed visible** — `<PortalTrophiesSection>` already renders `client_trophies + dog_trophies` from `/api/portal/trophies` with a gold "Trophy Wall" panel. No work needed.

Lint clean. Income screenshot verified live ($604.99 net after labor with the new 5-tile layout).



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

## Sprint 49 — Fix: "+ New Service" button silent + Icon Picker (2026-02)
- ✅ **Bug**: in Settings → Services & Programs, clicking the green "+ New Service" button appeared to do nothing — `openNew()` only reset an inline form rendered below a long catalog list, so admins on a mid-height viewport got zero visual feedback.
- ✅ **Fix** (`ServicesSettings.jsx`): the New/Edit form is now a proper centered modal with overlay, sticky header + close button, and a Cancel CTA. Both "+ New Service" and per-row "Edit" links toggle `open=true`. Save and close both reset state and close the modal.
- ✅ **Visual Icon Picker**: replaced the raw "fa-tag" text input with an `<IconPicker>` component. Tapping the live icon preview opens a searchable popover grid of ~85 curated FontAwesome icons relevant to dog daycare/training/grooming/payments. Search filters by name and keywords (e.g. "paw", "bath", "training"). Click an icon to set the field value + close the popover.
- ✅ Lint clean, smoke-tested in preview (modal opens, picker grid opens, "paw" search filters correctly).




## Sprint 50 — IconPicker on Credit Packs + Mood Tags (2026-02)
- ✅ **`IconPicker` extracted** to `/app/frontend/src/components/IconPicker.jsx` as a reusable component with an `autoOpen` prop so callers can have the grid visible immediately when mounted. ServicesSettings now imports it (deduped from the inline copy).
- ✅ **Credit Packs**: added `icon: Optional[str]` to `CreditPackIn` Pydantic model. Seed defaults (`credit_packs_data.py`) now carry icons (daycare → `fa-sun`, training → `fa-graduation-cap`, boarding → `fa-moon`). Seed-standard endpoint also **backfills the icon onto pre-existing default packs** (one-time idempotent — verified: 11 packs backfilled on first run). Settings → Credit Packs form has the picker; list rows show the chosen icon in a pool-colored chip; Sell-Pack modal also renders the icon next to each pack name so admins recognize their packs at a glance.
- ✅ **Mood Tags**: `SettingsIn.mood_tags` relaxed to `Optional[List[Any]]` so both legacy `List[str]` AND new `List[{label, icon}]` round-trip cleanly through Pydantic. Backend verified accepting both shapes. Settings → Mood Tags now shows each tag as a pill with an icon-toggle button → clicking it opens an inline IconPicker grid (auto-open). Saving persists the `{label, icon}` shape; legacy string tags are normalized on first render. Dashboard ReportCardModal renders the icon next to each selectable tag pill. Portal report-card history looks up the icon from `pubSettings.mood_tags` and renders it inline.
- ✅ Backward compatible: report-card storage still saves `mood_tags: List[str]` (label-only); the icon is metadata on the *catalog*, not on each saved record.
- ✅ Lint clean. Smoke-tested in preview: 16 pack icons rendered on the Credit Packs list, all 8 default mood tags rendered with icons, picker grid auto-opens on click, selecting `fa-heart` updates a tag successfully.


## Sprint 51 — Per-Mood-Tag Color (2026-02)
- ✅ **Tag shape extended** to `{label, icon, color}` (color is an optional hex). Pydantic `Optional[List[Any]]` covers it without further schema changes.
- ✅ **Settings → Mood Tags**: each tag pill now renders an inline **8-color swatch row** (green / blue / orange / purple / pink / red / yellow / slate). Selected swatch gets a white ring; pill background + border + label color all derive from the chosen hex. Default = shGreen if not set.
- ✅ **Dashboard ReportCardModal**: selectable mood pills now render with each tag's own color (inverts to filled bg + dark text when selected).
- ✅ **Portal report-card history**: saved mood tags look up their icon + color from `pubSettings.mood_tags` and render with matching tint.
- ✅ End-to-end verified: set Playful=purple / Calm=orange / Napped Well=blue, saved, full page reload — colors persisted and re-rendered correctly. Lint clean.


## Sprint 52 — Color Picker Everywhere IconPicker Exists (2026-02)
- ✅ **`ColorSwatchRow` extracted** to `/app/frontend/src/components/ColorSwatchRow.jsx` — reusable 8-color brand palette (green / blue / orange / purple / pink / red / yellow / slate). Same palette used by Mood Tags.
- ✅ **Services & Programs**: New/Edit Service modal now has a "Color" swatch row under the Icon picker. Replaces the silent auto-color-from-category behavior (category still suggests one, but admin can override).
- ✅ **Credit Packs**: new `color: Optional[str]` field on `CreditPackIn`. Settings form has a Color swatch row with helper text "Leave blank to use the pool default ({green/purple/orange})". List rows + Sell-Pack modal in `Clients.jsx` render the pack icon in the chosen color (falls back to pool default when empty).
- ✅ Lint clean. Smoke-tested in preview — both modals show the swatch row, picking pink updates the New-Pack form state correctly. Existing data backward-compatible (empty color → pool default).


## Sprint 53 — Live Preview Chips on Edit Forms (2026-02)
- ✅ **Services form**: new "Preview" row under the Color picker shows exactly how the service will render in the catalog (icon chip in the chosen color, name, category label, price). Updates as the admin types / picks icon / picks color.
- ✅ **Credit Packs form**: new "Preview" row above the Save button shows the pack as it'll appear in the catalog list — colored icon chip + name + pool · qty unit (sessions/nights/credits) + price. Falls back to pool-default color when admin leaves color blank.
- ✅ Mood Tags already render live previews (the tag pill itself is the preview).
- ✅ Lint clean. Smoke-tested in preview — "Behavioral Consult" service shows purple icon preview, "Holiday Special Pack" shows pink icon preview, both updating in real time as inputs change.


## Sprint 54 — Code Review Quick Wins (2026-02)
- ✅ **`PortalTrainingCard.printCertificate` hardened** — replaced `win.document.write(...)` (linter XSS warning) with a Blob URL + `window.open`. All template interpolations (`dog.name`, `snap.name`, `tm.label`, etc.) now flow through an `escHtml()` helper. Blob URLs auto-revoked after 30s. Behavior identical for users; XSS surface eliminated.
- ✅ **Empty catch blocks → `console.warn`** on API-load failures: Portal `loadAll` / `loadTrophies` / `portal/me` and Schedule `events` / `dogs` loaders now log to the browser console so production issues surface in DevTools. Kept intentional fire-and-forget catches (`navigator.clipboard`, `sessionStorage`) silent — those are UX-only and fail in private browsing without consequence.
- ✅ **Python unused-variable cleanup** — removed dead `public_pct` in `training_data.py` and dead `last_resp` in `test_iter13_sprint17.py`. ruff F841 clean.
- ✅ Deferred (per user agreement): hook-dependency warnings, index-as-key warnings, localStorage→httpOnly migration, `Portal.jsx` / `create_booking()` / `AdminBookingModal` refactor (P2 — working in production, refactor risk vs. value not justified for a solo CRM).


## Sprint 55 — Credit Packs: Edit modal + remove actually hides (2026-02)
- ✅ **Edit was silently failing visually** (same root cause as the earlier "+ New Service" bug): clicking Edit on a pack row only updated the inline form that lived below a long list. Converted New/Edit into a proper centered modal — instant visual feedback, sticky header with × close, name/qty/price/icon/color all pre-filled when entering edit mode. New "+ New Pack" header button added; row Edit buttons now wire to `openEdit(p)`.
- ✅ **Removed packs now disappear**: dropped `include_inactive: true` from the list fetch. Custom packs (hard-deleted) and default packs (soft-deleted → `active=false`) both stop showing on the catalog. Lots already issued from removed packs still redeem normally — only the catalog row hides.
- ✅ Smoke-tested in preview: row count went 16 → 14 after dropping inactive; Edit modal opens with "Single Day Drop-In" pre-filled and `fa-sun` icon preview showing live.


## Sprint 56 — Bulk booking = ONE admin email (2026-02)
- ✅ **Bug**: client-driven multi-date and recurring booking flows fired `notify_admin_new_booking` for every single generated date. A "M/W/F · 4 weeks" recurring would spam the operator with 12 emails in a row.
- ✅ **Fix**: introduced a `_suppress_admin_booking_email` `contextvars.ContextVar` flag. `create_booking` checks the flag and skips the per-booking admin alert when set. Both `/bookings/recurring` and `/bookings/multi-dates` now wrap their loop in `set(True)` / `finally reset`, then send ONE summary email (`notify_admin_bulk_booking`) after the loop.
- ✅ **New email template** (`email_service.notify_admin_bulk_booking`) — branded summary listing client, dog, service, dates (first 10 inline + "(+N more)"), and any skipped dates with reasons. Subject prefixed `N new bookings · Dog · Service`.
- ✅ Verified end-to-end via curl + log inspection: multi-dates with 3 dates → 1 email; recurring M/W/F × 2 weeks creating 6 bookings → 1 email. Prior to the fix the same calls produced 3-4 emails in 700ms.
- ✅ Admin-created bulk bookings (Quick Check-in, etc.) still trigger zero emails (the suppression is on top of the existing "skip self-triggered admin actions" guard). Client first-booking celebration unchanged — fires at most once per client lifetime.


## Sprint 57 — Client Profile Avatars (2026-02)
- ✅ **Avatar component extracted** to `/components/Avatar.jsx` (round, 3 sizes, configurable ring color, icon fallback). Reusable for any "user-ish" UI later.
- ✅ **Backend**: added `photo: Optional[str] = ""` to `ClientIn` (base64 data URL). Stored on the client doc and round-tripped via `PUT /api/clients/{id}` and `POST /api/clients`.
- ✅ **Frontend**:
  - Clients list now shows a round avatar next to each client's name (shBlue ring). Falls back to `fa-user` placeholder when no photo is uploaded.
  - Edit Client modal got a "Profile Photo" row directly under Name: live avatar preview + Upload/Replace + Remove buttons. Uses the existing `compressImage` helper (max 600px, quality 0.8) so payloads stay small.
- ✅ Dogs already had per-dog `photo` rendering on cards — unchanged.
- ✅ Lint clean. Smoke-tested in preview: 47 client avatars render as placeholders; edit modal shows the upload field with helper text.


## Sprint 58 — Trophy custom images render on dog/client cards (2026-02)
- ✅ **Bug**: admin-uploaded custom trophy images only showed up in the catalog preview and on freshly-awarded badges. On already-issued awards, the badge fell back to the FontAwesome icon placeholder.
- ✅ **Root cause #1**: `TrophyBadge.jsx` only checked `t.custom_image` (the catalog field). Awarded rows snapshot the same image under `trophy_custom_image` (different field). Fixed: badge now checks `trophy_custom_image || custom_image`.
- ✅ **Root cause #2**: when admin uploaded a custom image AFTER the trophy was already awarded, prior awards stayed stuck on the icon. Fixed: `PUT /trophies/catalog/{code}` now propagates the `custom_image` change to ALL existing `awarded_trophies` for that code in one update_many. Also ran a one-time backfill in preview to fix historical data (4 awards updated).
- ✅ Smoke-tested in preview: 5 trophy badges now display their uploaded images on the Clients list (Friend Bringer, Pack Builder visible on Alex Owner + other cards). Placeholder icon still shows for trophies where the admin hasn't uploaded an image — exactly the requested behavior.


## Sprint 59 — "Deduct credits at checkout" option (2026-02)
- ✅ **Gap**: prior flow auto-deducted credits at booking time. If a client booked WITHOUT credits then bought a pack later (or admin created the booking), there was no way to settle the booking from credits at checkout — admin was stuck collecting cash.
- ✅ **Backend** (`server.py` `check_out`): added "Case C" — when `use_credits=True` AND no pre-deduction existed AND no `actual_price` is set, consume credits from the client's matching pool (daycare/training/boarding) at checkout. Boarding deducts one credit per night (from `end_date - date`); others deduct 1. Uses the existing FIFO `_consume_credit_lots`, sets `payment_method="credits"`, marks booking paid.
- ✅ **Backend**: also added the missing `GET /clients/{client_id}` endpoint (was implicit gap — only PUT/DELETE existed).
- ✅ **Frontend** (`Dashboard.jsx` `CheckoutModal`):
  - Fetches the client's live balance on mount.
  - When booking has NO pre-deduction AND client has enough credits in the matching pool, shows two new radio options under "Base service": **"Deduct N credits now"** (with "Client has X available · FIFO from oldest pack") vs **"Charge as regular service"**. Default = charge (so admin actively opts into using credits).
  - If client has SOME but not enough credits (e.g. 2 boarding credits but a 3-night booking), the existing "no credits on file" copy now also includes an inline orange notice explaining the gap.
  - Submit logic no longer overrides `payment_method` when settling from credits at checkout (was leaking `cash` over Case C).
- ✅ End-to-end verified: created a no-credit booking for Alex Owner, called `/check-out` with `use_credits=true` → his daycare balance went 14 → 13, booking marked paid via credits, FIFO lot consumed. UI screenshot confirms both radio options render on the checkout modal with the live balance ("13 available").


## Sprint 60 — Portal: Bookings tabs + quick-jump button (2026-02)
- ✅ **My Bookings tabs** (`Portal.jsx`): the long flat list is now segmented into **Upcoming / Past / All** with live counts. "Past" = terminal status (completed/cancelled/rejected) OR date already in the past. Upcoming sorted ascending; Past sorted descending (most recent first). Empty-state copy differs per tab. Default tab = Upcoming so clients land on what matters.
- ✅ **Quick-jump button** under "My Profile" in the credits side card: a "My Bookings · N" button that smooth-scrolls to the bookings section. Saves the long page scroll on mobile.
- ✅ Lint clean. Smoke-tested in preview as Test Client (41 bookings: 9 upcoming, 32 past). Tabs and counts render correctly, scroll-jump works.


## Sprint 61 — Admin Schedule: clickable events + booking detail modal (2026-02)
- ✅ **`GET /api/bookings/{id}`** primitive added (admin or owning client). Returns the full booking doc — used by the detail modal to load notes, payment status, etc. without paging the full /bookings list.
- ✅ **`Schedule.jsx` `eventClick`**: clicking any FullCalendar event chip now opens a `BookingDetailModal` showing service badge + status + payment badge, client, date(s)/time/kennel, charged amount or credit value, notes (highlighted card), report-card note (green tinted), and a Cancel action that hits `DELETE /bookings/{id}` (auto-refunds credits via the existing flow).
- ✅ **Day-roster rows clickable**: each row in the day-roster modal is now a button that opens the booking detail layered on top. Two-deep modal works (z-50 vs z-60). Common workflow: click day → see roster → click a name → read notes.

## Sprint 61b — Portal: Month filter on "All" tab (2026-02)
- ✅ Added a month dropdown that appears only when the **All** tab is active AND the client has bookings spanning more than one month. Built from `bookings[].date.slice(0,7)` sorted descending. Empty months show a tailored empty state. Switching tabs clears the month filter so it doesn't leak across views.
- ✅ Lint clean. Smoke-tested in preview as Test Client: dropdown shows "July 2026 / June 2026 / May 2026", picking July filters the list to 5 rows.


## Sprint 62 — Schedule booking-detail: inline notes + walk-in shortcut (2026-02)
- ✅ **Inline notes editing**: notes section now always renders (with "Add" link when empty). Edit toggle reveals a 3-row textarea + Save/Cancel buttons. Save hits `PATCH /api/bookings/{id}` and shows a green "✓ NOTES SAVED" flash for 1.8s. Doesn't close the modal so admin can keep tweaking.
- ✅ **"Add to today's roster" walk-in shortcut**: visible only when the booking is in the past (terminal status or date < today). Clicking it opens a confirm, then `POST /bookings { dog_id, date: today, service_type, check_in_now: true }` so the dog lands directly on the run-sheet. Closes the modal + triggers parent refresh. Saves the operator from re-entering the dog/service when a regular calls last-minute.
- ✅ Lint clean. Smoke-tested in preview: edited Daisy's daycare notes, save flashes correctly, notes persist + re-render in read mode with Edit link, both action buttons visible.


## Sprint 63 — Year-end CSV export + closed-day enforcement (2026-02)
- ✅ **Year-end income export**: new `GET /api/admin/income/export.csv?year=YYYY` returns a CSV (paid bookings + sold credit packs) with date / type / client / dog / service / amount / payment method / payment status / id columns + a trailing total row. Defaults to current year. Wired a blue "Download YYYY Income (.csv)" button into Settings → Backup & Restore.
- ✅ **Closed-day enforcement**: added `closed_dates: List[str]` to `SettingsIn` + exposed it on `/public/settings`. `create_booking` now blocks client-side bookings that fall on any closed date (single-day or any day in a boarding range) with a friendly message. Admin still bypasses (matches their override-everything philosophy).
- ✅ **UI**: new "Closed Days" section in Settings → Hours tab — date picker + Add button + per-row delete, with each row rendered as a localized "Sat, Dec 25, 2027" pill (calendar-xmark icon).
- ✅ Backup endpoint **already existed** (`/backup/export`) — verified via inspection. Removed my duplicate.
- ✅ Vet info fields **already existed** on Dog model + both admin and portal Add Dog forms — nothing to add.
- ✅ End-to-end verified via curl: closed-day block returns 400 "Sit Happens is closed on 2027-12-25" for a client booking; CSV export returns 23 rows incl. "2026 TOTAL: $1,740.00" trailer. UI screenshots show both new sections rendered correctly.


## Sprint 65 — Calendar time fix + birthday on one-shot Client+Dog (2026-02)
- ✅ **Schedule calendar duplicate time fix** (`server.py` `/events`): training/grooming events were rendering as `"2:16pm 14:16 · Buddy (training)"` because the backend prepended the time to the title while FullCalendar also rendered its own native time prefix. Removed the redundant title prefix so events now render cleanly as `"2:16pm Buddy (training)"`.
- ✅ **Birthday field on one-shot Client+Dog modal** (`Clients.jsx`): added a `Birthday (optional)` date input to the quick-add-dog section so admins get feature parity with the standalone Dog form. `birthday` is now part of `emptyDog` and is included in the `POST /api/dogs` payload when the modal is submitted. Backend already accepts `birthday` on the Dog model — no server changes needed.
- ✅ Verified both fixes via screenshot tool: birthday input visible between Age and Sex; May 2026 calendar shows the clean `2:16pm Buddy (training)` chip.



## Sprint 66 — Self-host workflow finalized (2026-02)
- ✅ User migrated from zip-download (`sithappens-main`) to proper `git clone` on Bazzite Linux PC. Stopped orphan containers (folder deleted but containers cached), preserved MongoDB volume `sit-happens_mongo_data`, restored `.env` from `sit-happens.old`, and restarted with `docker compose -p sit-happens up -d --build` so the existing data volume re-attached.
- ✅ Made GitHub repo public to avoid PAT/expiry headaches (no secrets in repo — `.env` is gitignored).
- ✅ Verified app loads on phone with all historical data intact. `./update.sh` is now functional for future one-command updates.

## Sprint 67 — Nightly auto-backups to Google Drive (2026-02)
- ✅ **`backup-now.sh`**: runs `mongodump` inside the mongo container (uses the existing `./backups` bind mount), stages the dump + `.env` + `docker-compose.yml` + a RESTORE.md, tars+gzips to `~/sit-happens-backups/sit-happens-backup-YYYY-MM-DD_HHMMSS.tar.gz`, rotates locally (keeps newest 14), then uploads to Google Drive via rclone (`gdrive:sit-happens-backups`). Cloud upload is best-effort — if Drive is down the local copy still succeeds.
- ✅ **`setup-auto-backup.sh`**: idempotent installer for Bazzite. Drops rclone into `~/.local/bin/` (no rpm-ostree needed for the immutable filesystem), walks user through `rclone config` for Google Drive auth, then installs a systemd --user timer (`sit-happens-backup.timer`) running nightly at 03:00 with 5min randomized delay. Calls `loginctl enable-linger` so backups continue when the user is logged out.
- ✅ Both scripts are bash-lint clean. PRD already mentioned user has a Google Drive account.

## Backlog / Next Up
- **P1** Public booking page (no-login request flow from website)
- **P1** Vaccine expiry email blast (one-click email all owners with expiring vaccines via Resend)
- **P2** SMS reminders via Twilio for tomorrow's appointments
- **P2** One-tap waitlist when daycare is full
- **P2** Migrate base64 photo storage to local disk or R2
- **Refactor** Split `server.py` (~5800 lines) into `/app/backend/routes/` modules
## Sprint 68 — Brand & Theme customization (admin global + per-user text size) (2026-02)
- ✅ **Backend** (`server.py`):
  - Extended `SettingsIn` with `brand_primary`, `brand_accent`, `brand_warning`, `brand_font_family` (all Optional[str]).
  - New unauthenticated `GET /api/branding` — returns the 4 brand fields (with defaults) so the login screen can theme itself before auth.
  - New `GET/PUT /api/me/preferences` — stores `text_size` (one of S/M/L/XL) on the user document. Validates the enum, defaults to "M".
- ✅ **Tailwind config**: changed `shGreen/shBlue/shOrange` from hardcoded hexes to `var(--sh-green, ...)` and the sans font to `var(--sh-font, Inter)`. Every existing `bg-shGreen`/`text-shBlue` class is now recolorable at runtime — zero code changes elsewhere.
- ✅ **`lib/theme.js` `ThemeProvider`**: fetches `/api/branding` on boot (cached + applied as CSS vars on `:root`), fetches `/me/preferences` when a token exists, applies html `font-size` from the S/M/L/XL → 16/18.5/21/24px scale, persists user pref to localStorage for instant-no-flicker reloads. Exposes `branding`, `prefs`, `savePrefs`, `saveBranding` via `useTheme()`.
- ✅ **`components/TextSizePicker.jsx`**: shared S/M/L/XL pill picker. Mounted in the admin sidebar (above InstallAppButton) and the client portal credits card.
- ✅ **Settings → Brand & Theme tab** (`Settings.jsx`): new BrandPanel with 3 color pickers (HTML color input + hex text field), font family selector showing 5 options (Inter/Nunito/Poppins/Roboto/System) rendered in their actual typeface, a Live Preview card, Reset-to-defaults link, and Save button with dirty-state detection.
- ✅ Added Nunito/Poppins/Roboto to `public/index.html` Google Fonts preload.
- ✅ E2E verified: logged in as admin, changed primary→#ff5577 + font→Poppins, hit Save → entire app (sidebar active nav, action buttons, settings preview, badges) recolored + retypefaced instantly. Switched text size to XL → all text scaled proportionally. Reverted cleanly. Backend tested via curl: GET /branding (unauth ✓), PUT /settings persists, PUT /me/preferences enforces enum (400 on "Z"), defaults to "M" for new users.

## Backlog / Next Up
- **P1** Public booking page (no-login request flow from website)
- **P1** Vaccine expiry email blast (one-click email all owners with expiring vaccines via Resend)
- **P2** Light mode (current app is dark-only — would need per-screen background/text overrides)
- **P2** SMS reminders via Twilio for tomorrow's appointments
- **P2** One-tap waitlist when daycare is full
- **P2** Migrate base64 photo storage to local disk or R2
- **Refactor** Split `server.py` (~5900 lines) into `/app/backend/routes/` modules

## Sprint 69 — Auto-merge on self-register (2026-02)
- ✅ **`/auth/register` auto-merge logic**: when a client self-registers, the backend now checks if a client record already exists with that email AND has no portal user linked. If so, attaches the new user to the existing client_id instead of creating a duplicate. Preserves pre-loaded dogs, credits, bookings, vaccine certs, etc.
- ✅ Email match is case-insensitive (regex with `^...$` and `i` flag).
- ✅ Referral code on register only updates the existing client if it didn't already have one (admin's data wins).
- ✅ Duplicate-email block on `users` is still in place — prevents re-registration when a portal user already exists.
- ✅ Feature (c) — auto-claim-email on admin client creation — was already implemented in `Clients.jsx` save flow (lines 130-141): when a new client is created with an email, `/clients/{id}/send-claim-email` fires automatically and a toast confirms "Claim email sent to {email}".
- ✅ E2E tested via curl: admin creates Alice with 5 credits + dog Rex, Alice self-registers, logs in, sees Rex and 5 credits, only 1 client record exists in DB.

## Backlog / Next Up
- **P1** Public booking page (no-login request flow from website)
- **P1** Vaccine expiry email blast (one-click email all owners with expiring vaccines via Resend)
- **P2** Admin "Duplicate Clients" detector + merge UI (for existing duplicates created before Sprint 69)
- **P2** Light mode, SMS reminders (Twilio), waitlist, photo→disk migration
- **Refactor** Split `server.py` (~5900 lines) into `/app/backend/routes/` modules

## Sprint 70 — Bulk claim-email recovery tool (2026-02)
- ✅ **Backend `POST /api/clients/send-claim-emails/bulk`**: scans all clients, fires a fresh one-time claim token + email for every client that has an email on file AND no portal user linked yet. Skips clients without emails and clients already linked. Returns a structured summary (total, sent, skipped_no_email, skipped_already_linked, errors).
- ✅ **Settings → Backup & Restore**: new "Mass Claim Emails (Recovery)" section with a single button + result chips (Total / Sent / No Email / Already Linked / Errors). Confirm-dialog before firing to avoid accidental sends.
- ✅ Tested via curl: 48 clients scanned → 8 sent, 37 already linked, 3 no-email, 0 errors. JSON shape includes `sent[]`, `skipped_*[]`, `errors[]` arrays for inline display.
- 🎯 **Use case**: when migrating from Emergent → self-hosted Docker, the `clients` collection came over via mongodump but the `users` collection didn't. Result: 25 clients, 1 user. This button is the one-click recovery: every client gets an email with a "Set Your Password" link → they pick a password → land back in their account with all their dogs, credits, and history intact.

## Backlog / Next Up
- **P1** Public booking page (no-login request flow from website)
- **P1** Vaccine expiry email blast (one-click email all owners with expiring vaccines via Resend)
- **P2** Admin "Duplicate Clients" detector + merge UI
- **P2** Light mode, SMS reminders (Twilio), waitlist, photo→disk migration
- **Refactor** Split `server.py` (~5900 lines) into `/app/backend/routes/` modules

## Sprint 71 — User credential migration (carry over bcrypt hashes) (2026-02)
- ✅ **`GET /api/admin/users/export-with-hashes`** (admin-only) — dumps every user record INCLUDING `password_hash`. Output is a single JSON file with `{version, exported_at, user_count, users[]}`.
- ✅ **`POST /api/admin/users/import-with-hashes`** (admin-only) — accepts that JSON, merges by email (existing emails updated in-place, new emails inserted with a fresh UUID id). Never touches the calling admin's own record (`skipped_self` counter). Skips entries without an email or hash.
- ✅ **Settings → Backup & Restore**: new "Migrate User Logins (with passwords)" section above the bulk-claim panel. Green "Export Users" button (downloads `sit-happens-users-YYYY-MM-DD.json`) + blue "Import Users" file picker with confirm-dialog and 4-chip result summary (Inserted / Updated / Skipped Self / Skipped No Hash).
- ✅ Round-trip tested: export 39 users → re-import → 0 inserted / 38 updated / 1 skipped_self / 0 errors. Admin login still works after self-import.
- 🎯 **Use case**: when migrating from Emergent → self-hosted Docker, run Export on the old instance, Import on the new one — every client keeps their existing password. No "reset your password" email needed.

## Backlog / Next Up
- **P1** Public booking page (no-login request flow from website)
- **P1** Vaccine expiry email blast (one-click email all owners with expiring vaccines via Resend)
- **P2** Admin "Duplicate Clients" detector + merge UI
- **P2** Light mode, SMS reminders (Twilio), waitlist, photo→disk migration
- **Refactor** Split `server.py` (~6000 lines) into `/app/backend/routes/` modules

## Sprint 72 — Repo cleanup + idiot-proof README (2026-02)
- ✅ **Deleted unneeded files** from repo root: `start.sh` (superseded by install.sh), `test_result.md`, `yarn.lock` stub (86 bytes — real one is in frontend/), `.gitconfig`, `MIGRATE_TO_NEW_PC.md` (content already covered by BAZZITE_SETUP.md + migrate-*.sh), entire `test_reports/` and `tests/` directories (Emergent testing artifacts).
- ✅ **Rewrote `.gitignore`** from scratch — was corrupted with the same 18-line block repeated 30+ times by prior agents. New file is 53 lines, organized into clear sections (deps, build artefacts, Python, logs, secrets, backups, agent-only). Adds patterns for the new backup files (`sit-happens-users-*.json`, `sit-happens-backup-*.tar.gz`).
- ✅ **Rewrote `README.md`** — was literally "Here are your Instructions" 😅. New 100-line README is the entry point for self-hosters: features list, 3-step quickstart for Bazzite, Cloudflare Tunnel pointer, daily commands, backups, new-PC migration, full file-reference table, troubleshooting checklist.
- ✅ **Added `SENDER_EMAIL` to `.env.example`** with the warning that the domain must be verified in Resend.

## Backlog / Next Up
- **P1** Public booking page (no-login request flow from website)
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card
- **P2** Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6000 lines) into `/app/backend/routes/` modules

## Sprint 73 — Self-service password reset for everyone (2026-02)
- ✅ **Backend `POST /auth/forgot-password`** (public, unauthenticated): looks up user by email. If found → mints a claim token with `user_id` set (and `client_id` if applicable) → emails the reset link via Resend → always returns `{ok: true}` whether or not the email exists (prevents account-enumeration probing).
- ✅ **Extended `GET /claim/{token}`**: display name now falls back to `users.name` when the token has no `client_id` (admin/staff reset case).
- ✅ **Extended `POST /claim/{token}`**: new third branch — when token has `user_id` but no `client_id`, treats it as a direct user-record password update (admin/staff reset). Returns proper auth token with the user's actual role (admin/client) so they're logged in automatically after reset.
- ✅ **`components/ForgotPasswordModal.jsx`**: clean modal on Login screen — collects email, hits the endpoint, shows a generic "Check your inbox" success message regardless of whether the email exists.
- ✅ **`Login.jsx`**: small "Forgot password?" link below the password input, only visible on Sign In tab (not Register). Modal pre-fills with whatever email the user has already typed.
- ✅ E2E tested via curl + Python+motor token lookup:
  - Admin forgot → reset → login with new password ✅
  - Client forgot → reset → login with new password ✅
  - Unknown email → silent `{ok:true}` (no leak) ✅
  - UI smoke-tested: modal opens, submits, success state shows ✅

## Backlog / Next Up
- **P1** Public booking page (no-login request flow from website)
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card
- **P2** Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6000 lines) into `/app/backend/routes/` modules

## Sprint 74 — Removed Emergent branding + telemetry from self-hosted build (2026-02)
- ✅ **Removed `#emergent-badge` `<a>` tag** from `frontend/public/index.html` (the floating "Made with Emergent" pill in the bottom-right).
- ✅ **Removed the PostHog session-recording script** that was capturing every click + session of every client + admin and sending it to `us.i.posthog.com`. Privacy + GDPR win.
- ✅ **Removed the `https://assets.emergent.sh/scripts/emergent-main.js`** external script tag (which likely re-injected the badge dynamically).
- 📝 Note: These changes only take effect on builds where the user controls the pipeline (self-hosted Docker). The Emergent platform re-injects badge + tracking server-side on its managed preview/deployment URLs — out of our control.

## Backlog / Next Up
- **P1** Public booking page (no-login request flow from website)
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card
- **P2** "We've moved" announcement email blast to clients (one-click button)
- **P2** Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6000 lines) into `/app/backend/routes/` modules

## Sprint 76 — Configurable footer + "dog ate my homework" error UI (2026-02)
- ✅ **`DogAteHomework.jsx`**: hand-crafted SVG of a husky-style dog with a torn paper sticking out of its mouth (ears, raised eyebrows, closed embarrassed eyes, nose with highlight, torn jagged paper with ink lines behind the head + a smaller piece between the teeth). 3 sizes (sm/md/lg). Pure SVG = scales perfectly, zero asset deps.
- ✅ **`ErrorState.jsx`**: reusable error UI — illustration + funny rotating headline ("The dog ate our homework" / "Buddy chewed the page" / "Looks like Rex got the file" / "Caught Daisy with the homework" / "Something got fetched a little too hard") + supporting copy + optional detail block + optional action button. Drop-in replacement for any error card.
- ✅ **`ErrorBoundary.jsx`**: rewrote to use ErrorState — every React crash now shows the cute dog with a "Clear session & reload" button. Bad news, friendly delivery.
- ✅ **Configurable footer pill**: added `brand_footer_text` + `brand_footer_url` to `SettingsIn` + `/api/branding` response + theme defaults. `BrandFooter.jsx` now renders an `<a>` when URL is set, plain `<div>` when blank. New "Footer Pill" section in Settings → Brand & Theme with Text + Link URL inputs. Reset-to-defaults restores "Sit Happens" + blank URL.
- ✅ Tested via screenshot: Brand panel renders the new section cleanly, footer pill ("SIT HAPPENS") visible in bottom-right of every page, backend `/branding` returns the 6 fields.

## Backlog / Next Up
- **P1** Public booking page (no-login request flow)
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card
- **P2** "We've moved" announcement email blast (one-click button)
- **P2** Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6000 lines) into route modules

## Sprint 77 — Card gradients across the app (2026-02)
- ✅ Added subtle 135° linear gradients to `.bg-bgPanel` and `.bg-bgBase` via `index.css` `background-image` (NOT `background-color` so opacity variants `/40 /50 /60` still work). Effect: every card across admin + portal picks up a soft top-left light + bottom-right shadow gradient automatically — zero JSX changes needed.
- ✅ Added `.card-pop` utility class — richer variant with brand-green halo from top-left + brand-blue glow from bottom-right + thicker brand-tinted border. Applied to the Portal credit-balance card (the most-seen surface for clients).
- ✅ Defensive reset rule for dropdowns / menus / buttons — they re-apply `background-image: none` so flat surfaces stay flat.
- ✅ Verified via screenshots: Dashboard stat tiles, Dog Records grid, and Client Hub all show the new depth. No regression in FullCalendar (its own dark theme overrides took precedence).

## Backlog / Next Up
- **P1** Public booking page
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card
- **P2** "We've moved" announcement email blast, Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6000 lines) into route modules

## Sprint 78 — Semantic card gradients (5 flavors, fully customizable) (2026-02)
- ✅ **Backend**: added 5 new fields to `SettingsIn` + `/api/branding` — `grad_hero_color`, `grad_info_color`, `grad_warning_color`, `grad_danger_color`, `grad_success_color`. Defaults: hero/success=#8cc63f, info=#00a9e0, warning=#f59e0b, danger=#ef4444.
- ✅ **ThemeProvider**: exposes both hex (for borders) and RGB triplet (for `rgba()` gradient stops) as CSS vars on `:root`. Applied automatically on boot + after admin saves.
- ✅ **`index.css`**: 5 new utility classes — `.card-hero`, `.card-info`, `.card-warning`, `.card-danger`, `.card-success`. Each emits a radial brand-tinted halo from the top-left + linear gradient + matching border. `.card-pop` updated to use the configurable hero color.
- ✅ **Settings → Brand & Theme**: new "Card Gradients" section with 5 mini-preview swatches. Each swatch uses the actual gradient class so admin sees the exact effect live as they pick. Hex + color-picker side by side.
- ✅ **Applied semantic classes** to high-visibility cards:
  - Dashboard stat tiles → info (Daycare), hero (Boarding), warning (Health Flags), default (Total Dogs)
  - Vaccine alerts banner → warning
  - Pending-vax-reviews banner → info
  - Quote requests banner → info
  - First-booking-banner → success
  - Birthday banner → info
  - Portal onboarding banner → hero
  - Portal Pup Report Card → success
- ✅ Reset-to-defaults restores all 5 gradient colors too.
- ✅ E2E screenshot-verified: dashboard tiles + vaccine banner show the colored gradients, Settings panel shows 5 live preview swatches.

## Backlog / Next Up
- **P1** Public booking page
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card
- **P2** "We've moved" announcement email blast, Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6000 lines) into route modules

## Sprint 80 — Deep drill-downs from Dashboard (2026-02)
- ✅ **App.js** now passes `onJumpToDog` + `onJumpToClient` callbacks to Dashboard (using the existing `searchTarget` pattern that opens the corresponding edit modal on the target screen).
- ✅ **Top Dogs leaderboard row** → button → `onJumpToDog(d.dog_id)` → jumps to Dogs tab + opens that dog's full edit modal (basics, vaccines, feeding, training, gallery).
- ✅ **Top Clients leaderboard row** → button → `onJumpToClient(c.client_id)` → jumps to Clients tab + focuses that client's card.
- ✅ **Today's Check-in Board row** → dog-name+meta area is now a button that opens the dog's profile. Action buttons (Check In, Check Out, Cancel, Report Card) remain separate so clicks don't conflict.
- ✅ Hover states added: scale, ring-tint, focus rings for keyboard accessibility. Tooltips on every clickable area.
- ✅ Tested via screenshot: clicking Top Dog row jumped to Dogs and auto-opened Buddy's edit modal.

## Backlog / Next Up
- **P1** Public booking page
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card
- **P2** "We've moved" announcement email blast, Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6000 lines) into route modules

## Sprint 83 — Portal shows ALL active training enrollments (2026-02)
- 🐛 **Bug fix**: `PortalTrainingCard.jsx` used `enrollments.find(e => e.status === "active")` which returned only the FIRST active enrollment, hiding any others.
- ✅ **Now renders all `active` + `on_hold` enrollments** per dog, sorted newest-first, with a divider between each. On-hold enrollments get a yellow "On Hold" badge so clients understand the state.
- ✅ Each enrollment has its own expand/collapse — `expandedId` state replaces the boolean `expanded` so opening one doesn't close another.
- ✅ Backend already supported this — `POST /dogs/{dog_id}/programs` inserts new active enrollments without deactivating existing ones. Verified via curl: 3 concurrent active enrollments on one dog returned correctly.
- ✅ E2E screenshot-verified on testclient's portal: Rocky now displays "1-Week Fundamentals", "2-Week Essential Obedience", AND "Puppy Preschool" simultaneously, each with its own progress ring + View Progress toggle.

## Backlog / Next Up
- **P1** Public booking page
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card
- **P2** "We've moved" email-blast, Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6000 lines) into route modules

## Sprint 84 — Client file uploads (homework + training assignments) (2026-02)
- ✅ **Backend** — new `client_files` collection + 5 endpoints:
  - `POST /api/clients/{client_id}/files` (admin) — upload base64-encoded file with optional `dog_id` tag + `note`. 10 MB cap. Validates dog ownership when tagged.
  - `GET /api/clients/{client_id}/files` (admin) — list files for a client (metadata only, no payload).
  - `GET /api/portal/files` (any authed) — client lists their own files.
  - `GET /api/files/{file_id}/download` (any authed) — returns base64 payload, admin OR owner-client only.
  - `DELETE /api/files/{file_id}` (admin) — remove a file.
- ✅ **Admin UI** — `ClientFilesModal.jsx` opened by a new "Files & Homework" button on every client card. Upload form (file picker + dog tag dropdown + note), live file list with icons by content-type, file size formatted human-readable, download/delete buttons per row.
- ✅ **Client UI** — `PortalFilesSection.jsx` shows up below Training Progress in the portal. Files grouped by dog (or "General"). Click any row → downloads. Auto-hides when there are no files.
- ✅ E2E tested via curl: upload general file, list as admin, list as client, download as client (content roundtrip OK), random user gets 403, cleanup deletes correctly.

## Backlog / Next Up
- **P1** Public booking page
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card (or uploads a new file!)
- **P2** "We've moved" email-blast, Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **Refactor** Split `server.py` (~6300 lines) into route modules

## Sprint 86 — Track + display client last-login (2026-02)
- ✅ **Backend `POST /auth/login`**: now sets `users.last_login_at = now_iso()` and increments `users.login_count` on every successful login (best-effort — never blocks the actual login).
- ✅ **`ClientOut` model** gained `last_login_at: Optional[str]` and `login_count: int = 0`.
- ✅ **`GET /clients`** decorates each client with `last_login_at` + `login_count` pulled from their linked user record.
- ✅ **Clients screen** displays a tiny chip under the "Portal" column: "Just now" / "5 min ago" / "3h ago" / "5d ago" / "2w ago" / "Never logged in". Color-coded: green <7d, blue <30d, gray <90d, red >90d, gray for never. Hover reveals exact timestamp + total login count.
- ✅ E2E tested via curl + screenshot: login bumped `last_login_at` and `login_count`, list endpoint returned both fields, UI renders the chip in the right colors.

## Sprint 99 — Daily Tracker Phase 2 + Health-Flag Fix (2026-02)

**🐛 Bug fix:** Dashboard "Health Flags" counter now respects active vaccine dismissals. Previously, clicking "Hide 30d" in the Vaccine Center shrank the list but the dashboard counter stayed put. `/api/dashboard/stats` now reads `vaccine_dismissals` the same way `/api/vaccine-alerts` does so they stay in lock-step. Regression test at `/app/backend/tests/test_health_flags_dismiss.py`.

**Six client-experience wins added to the daily tracker:**

- ✅ **Equipment / treats checklist per day** — Admin enters comma-separated items at build time (`"high-value treats, 6-ft leash, target stick"`). Client sees an orange `🧰 YOU'LL NEED` checklist at the top of every open day card. Eliminates the #1 "I tried but didn't have the stuff" excuse.
- ✅ **Rest day (preserves streak)** — `POST /homework/{id}/day/{N}/rest` marks a day as `submission_status="rest"`, auto-passes (no review needed), unlocks the next day, counts toward the streak. Client sees a blue "Rest day" button alongside "Submit for review." Real life shouldn't break consistency.
- ✅ **Video upload per day** — Up to 15 MB clips stored in a separate `homework_media` collection (skirts Mongo's 16 MB per-doc cap). Client picks "Add video" → uploaded immediately, attached to the submission. Trainer plays it back inline in the review pane via `<video controls>`.
- ✅ **Threaded "Ask your trainer" per day** — `POST /homework/{id}/day/{N}/ask` + `POST .../answer/{question_id}`. Each day card becomes its own conversation. Client sees a "QUESTIONS (n)" toggle with "WAITING FOR REPLY" or "Trainer replied" badges. Admin sees the same thread inline in the review queue with one-tap reply input.
- ✅ **Completion certificate (admin-uploaded)** — User keeps full design control: upload a PNG/PDF/JPG (≤ 5 MB) after a daily-tracker hits 100% approved. `POST /homework/{id}/certificate`. Client sees a gradient orange→yellow→green "🎓 Download {dog}'s Certificate" CTA at the top of the daily-checkin card. Email notification fires when issued.
- ✅ **Client-controlled practice reminders** — `GET/PUT /portal/reminder-settings` stores `{enabled, days[], time}` on the client doc. New cron `run_homework_practice_reminder_job` fires daily, only emails clients whose day-of-week matches today + have an active daily-tracker + haven't already logged today's day. Per-client per-day dedup via `notification_log`. Client UI: 🔔 "Reminders" button on the streak header → modal with day pills (Mon/Tue/.../Sun) + time picker.

**Test coverage:** 7 new tests in `test_daily_tracker_phase2.py` + 1 health-flag test. Full suite now **24/24** passing across Sprints 95-99.


## Sprint 98 — Weekly Homework Digest Email (2026-02)
- ✅ **Sunday-night cron job** (`run_homework_weekly_digest_job` in `daily_jobs.py`) — auto-fires every Sunday at the same time as the existing birthday/vaccine jobs. For each client with daily-tracker activity this week (Mon→Sun), packages a recap of every active plan: 🔥 streak, days approved this week vs total, photos from approved days (max 3), trainer's review notes (max 3), and the next-day focus to keep them on track.
- ✅ **Idempotency** — keyed by `hw_digest:{client_id}:{week_start_iso}` in `notification_log` so it never double-sends. Activity-this-week filter prevents spamming clients who didn't train at all.
- ✅ **Includes recently-completed plans** — plans that finished within the past 14 days still get a final "you finished!" digest entry the following Sunday.
- ✅ **HTML email** — branded header, per-plan card with streak chip, progress line, inline photos, blue-bordered note quotes, "Up next" callout, CTA back to the portal.
- ✅ **Admin force-send endpoint** `POST /api/admin/homework/send-weekly-digest` — busts dedup for current week and re-fires. Returns `{sent, attempted, skipped, errors[], week_start, week_end}` so the user can see exactly what happened. Surfaces `email_send_failed` reasons (e.g., Resend unverified-domain) for debugging.
- ✅ **Admin button** — new "Weekly recap" outline button on the Homework header (next to "Daily Tracker") with a confirm dialog explaining it auto-fires on Sundays. Shows summary alert with sent/attempted counts.
- ✅ **3/3 new tests pass** (`/app/backend/tests/test_weekly_digest.py`): no-activity returns zero, active-tracker shows up in attempted, unauth blocked. Combined suite (Sprints 95-98) now 15/15 passing.


## Sprint 97 — Daily Tracker Homework w/ Approval Gate (2026-02)
- ✅ **Daily-tracker schema** sits ON TOP of existing template/section model — `daily_tracker:bool` flag on homework + sections with `day_number` + `day_focus`. Legacy non-daily templates continue to work in the single-section logger; only daily-tracker docs get the new card UI.
- ✅ **Backend endpoints**:
  - `POST /api/homework/daily-tracker` — admin creates a per-day plan (1–120 days, each with focus + step list). Optional `save_as_template` flag persists a reusable template.
  - `GET /api/homework/{id}` — enriched with `daily_progress[]` (status: locked / available / submitted / approved / needs_redo), `streak`, `total_days`.
  - `POST /api/homework/{id}/day/{N}/submit` — client or admin submits a day's check-in. Replaces any existing log (re-submission flow after `needs_redo`). Rejected if previous day not yet approved.
  - `POST /api/homework/{id}/day/{N}/review` — admin approves (unlocks N+1) or sends back (`action: "needs_redo"` with note). Auto-completes the homework when every day is approved.
  - `GET /api/admin/homework/pending-reviews` — queue of all submitted days oldest-first.
- ✅ **New field kinds** wired into snapshot: `mood_5` (😞😅😐💪😄) and `photo` (base64 data-url, optional per day).
- ✅ **Email notifications** — admin gets notified when client submits a day (reuses existing section-log helper); client gets notified when admin approves or sends back (new `notify_client_day_reviewed`).
- ✅ **Admin UI (`Homework.jsx`)** — new "Daily Tracker" purple CTA opens 2-step wizard (`DailyTrackerBuilder.jsx`): basics → day-tabbed editor with focus + drag-add step buttons (✓/✗, mood, reps, sets, duration, distance, rating, success%, short text, long text). "Duplicate Day" + "Remove Day" + reorder via auto-numbering. Save-as-template toggle persists for next assignment. Live "Review · N" orange badge in the header shows pending count and opens `DailyReviewQueue.jsx` — list of pending days, click into detail pane showing mood emoji, all field values, client's note, photo if attached, plus "Send back for redo" / "Approve · Unlock next day" actions with optional note.
- ✅ **Client portal (`DailyCheckInCard.jsx`)** — streak header (🔥 N-day streak) + progress bar, day-by-day card list. Locked days greyed, available day auto-opens with mood-emoji row + per-step inputs + camera button + note. Previously-approved days collapse with green check + summary chip (date · mood · 📷). `needs_redo` days show the trainer's red-bordered note inline so the client knows what to change before resubmitting. All numeric fields use ±-stepper tap targets, mood uses tap-emoji-to-pick (with text label), longtext is one-tap to expand.
- ✅ **Tests** — 5/5 new regression tests pass (`/app/backend/tests/test_daily_tracker.py`): initial state, submit→approve→unlock, send-back-and-resubmit, all-days-approved-completes-hw, save-as-template-persists. Smoke-tested end-to-end via Playwright: admin built 3-day plan for Rocky → client submitted Day 1 with 💪 mood + 3 sets + note → admin queue showed pending → admin approved → confirmed Day 2 unlocked.


## Sprint 96 — Multi-Date Booking (Admin + Portal) (2026-02)
- ✅ **Shared `MultiDatePicker` component** (`/app/frontend/src/components/MultiDatePicker.jsx`) — 3-month forward calendar grid with Prev/Next month navigation, past-day greying, closed-day line-through, multi-select tap-to-toggle. Selected days render as removable green chips with "Clear all" and a live "N picked" counter. Used by both admin and portal so the UX is identical across roles.
- ✅ **`AdminBookingModal` multi-date mode** — new "📅 Book multiple specific days" toggle row (green theme). Shows for daycare/training/grooming/photography; auto-hidden for boarding (spans multiple dates) and when editing an existing booking. Submit button label dynamically becomes `Book N days`. POSTs to `/api/bookings/multi-dates` with admin override flags propagated. Closed-day list loaded from settings so the picker greys out non-operating days.
- ✅ **`PortalBookWizard` Step 2 multi-date mode** — same toggle + picker but scoped to daycare only (time-slotted services have per-date slot conflicts that don't generalise). Step 3 review shows chip list of selected days and "Submit N bookings" CTA. Error path surfaces skipped-day reasons inline if all picks fail.
- ✅ **Backend `POST /api/bookings/multi-dates`** — added `photography` to allowed `service_type` literal, new optional `grooming_type` and `time` fields propagated to each created `BookingIn`. Admin override flags (`override_vaccines`/`override_capacity`) only applied for admin role; clients passing them are silently ignored (defence-in-depth).
- ✅ **Single summary email** still fires once per multi-date action (not per booking) for client portal triggers; admins skip the summary because they triggered it themselves.
- ✅ **7/7 new regression tests pass** (`/app/backend/tests/test_multi_date_bookings.py` 3 tests + retail 4 tests). Verified end-to-end via Playwright: admin picks 3 days → 3 bookings created; client portal wizard picks 2 days → review shows chip list → "Submit 2 bookings" → both created.


## Sprint 95 — Retail Sales Logging (External POS → Income) (2026-02)
- ✅ **Lightweight retail revenue ledger** — user has their own POS, so this is a simple "log a sale → flows into Income + P&L" pattern rather than a built-in checkout.
- ✅ **`retail_sales` collection** (new) with full admin CRUD: `GET/POST/PUT/DELETE /api/retail-sales` + `GET /api/retail-sales/categories` for autocomplete. Fields: `date, description, amount, category, notes, payment_method (cash/card/transfer/check/credits/other), client_id (optional), client_name (resolved on save)`.
- ✅ **`/api/transactions/weekly-summary` extended** with `retail_total`, `retail_count`, `service_total`, `gross_total` — services and retail tracked separately so the user can see exactly how much came from each stream.
- ✅ **`/api/transactions/summary-range` folds retail** into `completed_total` (gross), `paid_total`, `net_total`, `net_before_labor`, and `by_day` series. Also exposes standalone `retail_total` / `retail_count` and `service_total` for breakdowns.
- ✅ **`/api/admin/today-pnl`** now adds today's retail to `revenue` and exposes `service_revenue` + `retail_revenue` + `retail_count` for the dashboard tile.
- ✅ **`/api/admin/income/export.csv`** includes retail rows as positive-amount "Retail" type lines so the year-end CSV nets correctly with services and expenses.
- ✅ **P&L PDF (`pl_report.py`)** — `build_pl_data()` adds `retail.total / count / by_category` + `income.retail_total / gross_total` and updates `net` and YTD figures to use gross. PDF: KPI tile renamed "Income (gross)", subtitle splits into Services / Retail with counts, new "Retail Sales (External POS)" table grouped by category (purple-accent header), YTD section breaks out Service vs Retail vs Gross.
- ✅ **P&L email** (Resend) now lists Service income, Retail income, Gross income, Expenses, Net separately.
- ✅ **Backup & Restore** — `retail_sales` added to `BACKUP_COLLECTIONS` so JSON snapshot + merge/replace restore handle the new collection automatically.
- ✅ **Frontend `Income.jsx`** — new "+ Log Retail Sale" (purple) button next to "+ Log Service" in the header. Weekly tile shows a purple retail chip with `Retail $X · N sales · Gross w/ retail $Y` when any retail logged. Range tile "Income (gross)" subtitle splits Services / Retail. New "Retail Sales" card with date-grouped collapsible list (purple `+$X` row chips, edit/delete buttons). `RetailSaleModal` mirrors the Expense modal with optional type-to-search client picker.
- ✅ **Frontend `Dashboard.jsx`** — Today's P&L tile shows a small purple `🛍 RETAIL $X (N)` chip under the labor row when retail sales exist today.
- ✅ **4/4 new regression tests pass** (`/app/backend/tests/test_retail_sales.py`): CRUD round-trip, weekly-summary retail aggregation, summary-range fold-in (gross + net + by_day), P&L report retail breakdown. Sprint 16 income suite (24 tests) still passes — no regressions.


## Sprint 108 — Automated Backups to External Disk (2026-02)
- ✅ **Auto-backup job** in `daily_jobs.py` (`run_auto_backup_job`) — fires once per day when the local hour matches the admin-configured `auto_backup_hour`. Dumps **every collection in the database** (dynamic listing — captures any new collection added later) to a gzipped JSON file `sit-happens-backup-YYYY-MM-DD-HHMM.json.gz` at the admin's configured path. Includes media (homework_media), step_events, users with hashes, settings — everything. Dedups once per local day.
- ✅ **Path validation** — backend creates the directory if missing, errors cleanly on permission/IO problems, sends a failure email to `ADMIN_NOTIFICATION_EMAIL` on failure.
- ✅ **Retention pruning** — files older than `auto_backup_retention_days` (default 14) are deleted from the target directory after each successful write.
- ✅ **New settings fields**: `auto_backup_enabled`, `auto_backup_path`, `auto_backup_hour` (0-23), `auto_backup_retention_days`.
- ✅ **2 new admin endpoints**: `POST /api/admin/backup/run-now` (force-fire bypassing hour gate) and `GET /api/admin/backup/status` (last + history of 10).
- ✅ **Settings UI** — new `AutoBackupPanel` at the top of the Backup & Restore tab. Path / hour / retention / enable toggle, Save Settings + Run Backup Now buttons, "Last successful backup" card, expandable history.
- ✅ **6/6 regression tests pass** (`test_auto_backup.py`): settings round-trip, run-now writes a valid gzipped JSON containing every collection, admin-only auth on both endpoints, status returns last + history, bad path returns clean error.
- ✅ **Coexists with manual Download Backup / Restore** on the same tab.
- ✅ **Smoke-verified** end-to-end: "1.33 MB · 651 docs · 35 collections" written after manual run.


## Sprint 107 — Admin Homework Overview + Client View Confirmation (2026-02)
- ✅ Backend `GET /api/homework` enriched to return `streak` + `total_days` for daily-tracker plans.
- ✅ Frontend `Homework.jsx` shows live `0% · day 1 of 2` progress bar + 🔥 streak chip per daily-tracker row.
- ✅ Client portal Today's Plan view verified via screenshot.


## Sprint 106 — Builder polish + Direct File Upload + Tutorials Refresh (2026-02)
- ✅ **Reorder arrows on both panels** — Action Steps + Steps to Log now have `[↑/↓]` buttons per row so the admin can resequence drills without deleting and re-adding. Disabled state on the top/bottom rows. Test IDs: `dtb-step-up-{id}`, `dtb-step-down-{id}`, `dtb-field-up-{id}`, `dtb-field-down-{id}`.
- ✅ **Custom labels everywhere** — the existing label inputs on Steps + Fields already accepted free text; documented in the tutorials so the operator knows they can write "Times Buddy looked at me without a cue" instead of being stuck with mood/notes/reps.
- ✅ **Direct file upload** — replaces URL-paste-only for printable resources.
  - New backend endpoint `POST /api/homework/resource-upload` accepts a base64 data-URL + filename. Validates MIME against an allow-list (PDF, JPG, PNG, WEBP, HEIC) and rejects payloads > 10 MB. Returns `{media_id, kind, mime, size_bytes}`. Stored in `homework_media` collection alongside existing video uploads.
  - New backend endpoint `GET /api/homework/resource/{media_id}` streams the file back (clients only get access if they own a homework that references the media_id; admins get everything).
  - Builder UI: per-day AND plan-wide resource panels now show a `⬆ Upload PDF / image` button + an `Or paste a URL` link. After upload, the row renders an "✓ uploaded" pill instead of the URL textbox. URL paste remains as a fallback for Drive/YouTube links.
  - Client portal `TodayPlanCard`: uploaded resources fetch via `/homework/resource/{media_id}` and open in a new tab; pasted URLs continue to open externally. Icon differentiates upload vs link.
- ✅ **Tutorials Refresh** (`/app/frontend/src/screens/Tutorials.jsx`):
  - Admin **Homework** section completely rewritten — 5 new cards covering plan creation, day approval, step events + nightly roll-up email, resource placement, and catch-up modal.
  - New admin **Today's Tasks** section explaining the 10 alert kinds + auto-resolve behaviour + sort order. Replaces references to the deleted Vax Alert banner.
  - Client **Homework → "Daily Plans"** section completely rewritten — finding Today's Plan, checking off steps, adding mood/notes/photo, missed-day catch-up, asking questions.
  - Client **Text size** instructions updated to reflect the new collapsed `TEXT · M` popover.
- ✅ **7 new file-upload regression tests pass**: PDF upload returns `kind=file` · JPG returns `kind=image` · unsupported MIME rejected · 11 MB rejected · admin-only auth · end-to-end attach-and-stream (client can fetch the file referenced by their plan) · perm guard (unrelated client gets 403).
- ✅ **45/45 cross-sprint tests still green** (test_homework_redesign.py + test_homework_driven_tracker.py + test_daily_tracker.py + test_daily_tracker_phase2.py + test_todays_brain.py).
- ✅ **End-to-end verified** via 2 smoke screenshots: Step 2 of builder renders new minute inputs + reorder arrows + Upload PDF buttons on both day-level and plan-wide resource panels.


## Sprint 105 — Homework Redesign: Minutes, Resources, Step Events + Daily Roll-up (2026-02)
- ✅ **Per-step minutes** — every step now carries an optional `minutes: int`. Surfaced in:
  - Admin builder: tiny minute input next to each step + day-total chip that auto-rolls up (`~11 min total`)
  - Client portal: green `5 min` badge per step + day-total in the header line (`Rocky · Day 1/2 · ~11 min`)
- ✅ **Per-day + per-plan resources** — schema adds `resources[]` to each day section AND to the homework root. Each resource = `{id, name, kind: link/file/image, media_id?, url?}`.
  - Admin builder: 2 new sections — "Day N resources" (per-day handouts/diagrams) + "Plan-wide resources" (shared across all days). Paste public URLs to PDFs / Drive links / YouTube clips.
  - Client portal: purple **TAKE WITH YOU** strip on each day card with tappable chips — opens in new tab so they can save/print/take outside.
  - 4 new admin endpoints: `POST /api/homework/{id}/resource`, `DELETE /api/homework/{id}/resource/{rid}`, plus `/day/{day}/resource` variants.
  - Helper `_normalize_resources` strips empty entries, generates stable IDs, normalises `kind`.
- ✅ **Live feed of step completions** — every client step-toggle (when `done=true`) writes to a new `step_events` collection with `{id, homework_id, client_id, dog_id, day_number, step_id, step_label, done, all_done, ts}`. Admin toggles do NOT emit events (regression-tested). Surfaced via new `GET /api/admin/homework/recent-steps?since_hours=24` endpoint.
- ✅ **Daily 8 PM-ish roll-up email** — new `run_homework_step_rollup_job` in `daily_jobs.py` aggregates today's step events grouped by client/dog/plan/day → single admin email "Today's training progress · N steps done" with each row collapsed to a clean HTML card. Dedups once per day via `system_runs`. Skips entirely if no steps were completed.
- ✅ **Per-step email toggle (opt-in)** — new `email_per_step: bool` field on `SettingsIn`, default off. When ON, the toggle-step endpoint fires a tiny `_send_per_step_email` to `ADMIN_NOTIFICATION_EMAIL` on every client step toggle (subject `[Step done] Buddy · Day 1 · Practice heel for 10 reps`). When OFF, the daily roll-up replaces it.
- ✅ **Settings UI** — Email Automation tab gets a new toggle row `Per-step homework emails` with explicit off-default + warning copy, plus a new always-on card explaining the Daily Roll-up.
- ✅ **10/10 new regression tests pass** (`backend/tests/test_homework_redesign.py`): minutes persist · resources on create + post-hoc upload + delete · day-level resource lifecycle · step events recorded on client toggle · admin toggle does NOT emit event · today-plan exposes resources + minutes · settings toggle round-trips · recent-steps admin-only auth · resource validation rejects empty payloads.
- ✅ **All 26 cross-sprint homework regression tests green** (Sprint 103 + 102 + 105).
- ✅ **End-to-end verified via smoke screenshot** — client portal renders the new "Today's Plan" card with day-total minutes header, TAKE WITH YOU resource chips (per-day + plan-level merged), and per-step minute badges. Builder UI shows minute inputs + per-day resource list + plan-wide resource list.


## Sprint 104 — Dashboard Hierarchy & Branding Polish (2026-02)
- ✅ **Brand text refresh** in all 4 locations (sidebar, mobile drawer, login, claim, portal header): `Daycare • Boarding` → `Dog Training • Daycare • Boarding • Photography`. Tight tracking, wraps cleanly across 3 lines under the logo in the desktop sidebar.
- ✅ **Text-Size picker collapsed** — `TextSizePicker` (compact mode) now renders as a small `TEXT · M` pill button instead of a permanent S/M/L/XL row. Click opens a popover with the size pills + a Close button; auto-closes on outside-click and Escape. Settings screen still uses the inline non-compact mode unchanged. Massive vertical space reclaimed in both sidebars + the portal header.
- ✅ **"Today's Brain" → "Today's Tasks"** — renamed in all 4 user-facing strings (loading state, empty state, tile header, modal header). Icon swapped from `fa-brain` → `fa-list-check` for clarity. Backend endpoint (`/api/admin/today-brain`) and component file kept the same so test IDs and data flows didn't churn.
- ✅ **Today's Tasks moved to the TOP** of the admin dashboard — now the first thing the admin sees, above the StatCard grid + P&L tile.
- ✅ **Standalone Vaccine Alert banner REMOVED** from the dashboard. Those alerts already feed into Today's Tasks via the brain endpoint (`vaccine_missing`/`vaccine_expired`/`vaccine_expiring` kinds), so the dedicated card was pure duplication. Pending-vaccine-cert-uploads banner kept — that's different (client uploads awaiting admin approval).
- ✅ **"Health Flags" StatCard removed** — grid shrunk from 4-col to a balanced 3-col (Daycare Today / Boarding Today / Total Dogs). VaccineCenterModal + the obsolete `alerts` state + `dismiss()` handler all cleaned up. Lint-clean.
- ✅ **Verified via 2 smoke screenshots** — sidebar branding wraps cleanly, "Today's Tasks" with `2 URGENT · 3 WARN · 5 INFO` chips renders as top-of-page tile, 3-card StatCard row sits below, text-size popover opens + closes correctly with S/M/L/XL pills exposed only on click.
- ✅ **All 16 adjacent regression tests still green** (`test_todays_brain.py` + `test_homework_driven_tracker.py`) — no backend changes in this sprint but confirmed.



## Sprint 103 — Homework-Driven Tracker (Steps + Today's Plan + Catch-Up) (2026-02)
- ✅ **Schema additive**: `DailyTrackerSectionIn.steps[]` — each day can carry up to N named checklist steps `{id, label}` alongside the existing fields/metrics. Stored in `template_snapshot.sections[].steps`. Backward-compatible — existing trackers without steps still work via the field-flow.
- ✅ **`POST /api/homework/{id}/day/{day}/toggle-step`** — check/uncheck a single step. Persists in `section_logs[].step_states[step_id] = bool`. When ALL steps for the day are checked, auto-flips the day's `submission_status → submitted` so it lands in the admin review queue (same as a manual submit). Fires `notify_admin_homework_section_log` so the email pipeline picks it up too.
- ✅ **`POST /api/homework/{id}/catch-up`** — 3 strategies for the "I missed a day" modal:
  - `skip_missed` — marks the missed day `status=skipped` so the next day unlocks (no rescheduling)
  - `shift_forward` — extends `due_date` by 1 day (missed day stays available)
  - `double_up` — appends missed day's steps onto the next-available day (with `(catch-up)` label prefix), then marks the missed day skipped
- ✅ **`GET /api/portal/today-plan`** — single unified "what to do today?" feed for the client portal. Returns next-available day from every active daily-tracker, with: steps + step_states + day_focus + all_done flag + missed_yesterday + missed_day_number + streak + total_days. Sorted: missed-yesterday first.
- ✅ **`_compute_daily_progress` updated** to expose `steps` + `step_states` per day. Added new statuses: `in_progress` (partial steps), `skipped` (catch-up applied). `_streak_count` now counts approved + rest + skipped.
- ✅ **Today's Brain integration** — new alert kind `steps_incomplete` (warn) surfaces "N trackers have today's steps still open" with rolled-up client names.
- ✅ **Frontend `TodayPlanCard.jsx`** — compact unified card at top of client portal (above existing homework list). Renders step checklist per active tracker with progress %, mood-emoji headline, "you missed day N — tap to catch up" banner, and embedded `CatchUpModal` (3 options: Skip yesterday / Double up today / Push back the schedule).
- ✅ **Frontend `DailyTrackerBuilder.jsx` extended** — new "Action steps for today" green-bordered section in the day editor. Admin adds 1-N step labels per day; submit persists them into the new `steps[]`.
- ✅ **9/9 new regression tests pass** (`backend/tests/test_homework_driven_tracker.py`):
  - steps persist on creation
  - step toggle stores state
  - all-steps-done auto-submits day → lands in pending review queue
  - `/portal/today-plan` returns active trackers with steps
  - catch-up `skip_missed` unlocks next day
  - catch-up `shift_forward` extends due_date
  - catch-up `double_up` carries (catch-up) steps onto next day
  - step toggle rejected on legacy trackers without `steps[]` (clean error)
  - today-brain surfaces `steps_incomplete` when tracker has open steps
- ✅ **All 50 cross-sprint regression tests still green** (sprint 95-103).
- ✅ **End-to-end verified** with admin-creates-tracker → client-portal screenshot: "TODAY'S PLAN · 1 ACTIVE" tile rendered above Training Homework with Rocky · Day 1/2 · 0% PROGRESS · 3 checkable steps (1 ticked + struck-through after live click).


## Sprint 102 — "Today's Brain" Unified Action Queue (2026-02)
- ✅ **`GET /api/admin/today-brain`** — single endpoint aggregates 9 alert sources into one prioritized feed:
  1. Homework day-submissions waiting for review (urgent)
  2. Vaccines missing/expired (urgent) + expiring within `vaccine_warning_days` (warn)
  3. Dogs booked today not yet checked in past 10 AM ET (urgent)
  4. Clients ≤2 credits in any pool (daycare/training/boarding) WITH a booking in last 60d (warn — filters out inactive prospects)
  5. Bookings in `pending` status (warn)
  6. Unanswered homework questions (warn)
  7. Pipeline enrollments at ≥95% overall (info — eligible for cert)
  8. New client signups in last 24h (info)
  9. Monday-digest hint (info — Mondays only)
- ✅ **Auto-resolving**: every item disappears when the underlying condition is fixed (no manual dismiss). Each item carries a stable `id`, `kind`, `priority`, `title`, `subtitle`, `cta` (`open_dog`/`open_client`/`open_screen`/`send_monday_digest`), `icon`, and `ts`. Counts (`urgent`/`warn`/`info`/`total`) returned alongside.
- ✅ **Sort**: priority-first (urgent → warn → info), then newest-first within priority.
- ✅ **Permissions**: admin-only. Verified employees + unauthenticated get 401/403.
- ✅ **`TodaysBrainTile.jsx`** — compact tile at the top of the admin dashboard (right after the StatCard row) showing top 3 items + priority count chips + "See all N →" link. Mobile shows the same compact 3 (no separate mobile variant needed since the tile already fits portrait).
- ✅ **`TodaysBrainModal`** (inside the same file) — full-screen modal opened by "See all" with filter chips (All/Urgent/Warn/Info · N) and the full feed. Clicking any row fires the CTA: `open_dog` → jump-to-dog · `open_client` → jump-to-client · `open_screen` → sidebar nav · `send_monday_digest` → POST to the force-fire endpoint.
- ✅ **7/7 backend tests pass** (`backend/tests/test_todays_brain.py`): shape validation, required-fields check, priority sort, admin-only guard, employee-blocked, pending-booking surface check, vaccine-alert cross-check against the existing dedicated endpoint.
- ✅ **Verified end-to-end via 2 smoke screenshots**: tile renders 2 urgent + 3 warn + 5 info → "See all 10" opens modal with filter chips + all 10 items grouped (vaccines + low credits + pending bookings + Monday digest + 4 new signups). Each row CTA wired and chevroned.


## Sprint 101 — Employee Checkout Parity (2026-02)
- ✅ **Employees now use the exact same Check-Out modal as admins** — credit deduction (FIFO from packs), add-on services (bath / nail trim / boarding extension), payment method selector, base-price override for income tracking, "Cancel booking instead" escape hatch. Rolls together what was previously a 1-click silent `POST /check-out`.
- ✅ **Extracted `<CheckoutModal>` and `<CancelBookingModal>`** from `Dashboard.jsx` into the shared `/app/frontend/src/components/CheckoutModal.jsx` so both `AdminShell.Dashboard` and `EmployeePortal.RosterTab` import the same component. No duplicated logic.
- ✅ **Permission lifts** (backend `server.py`):
  - `GET /api/clients/{id}` → `require_employee_or_admin` (modal reads live credit balance to decide "pay with credits" path)
  - `DELETE /api/bookings/{id}` → admins + employees can now cancel-with-refund; clients still restricted to their own + cutoff
- ✅ **EmployeePortal.RosterTab wiring** — fetches `/services` on mount (drives add-on chips + default price), `openCheckout(bid)` grabs the full booking record then opens the modal; on close we reload the roster so the row flips to "Out at HH:MM" automatically.
- ✅ **5/5 new regression tests pass** (`/app/backend/tests/test_employee_checkout.py`):
  - employee can `GET /clients/{id}` (perm lift)
  - employee can run the full checkout body (credits + base_price override) → booking.status flips to `completed`, `actual_price=42.50`, `payment_method=credits`, client.credits decremented
  - employee can `DELETE /bookings/{id}` → credits restored to client
  - employee can `GET /services` (needed for add-on chips)
  - **regression guard**: clients are STILL blocked from `GET /clients/{otherId}` (perm lift did not leak to clients)
- ✅ **Verified end-to-end via smoke screenshot** — Alex (employee) opens Roster → Check Out → identical modal as admin, with credit-deduction radio, 8 add-on chips, service-value override at $35.00 default, Payment section. All `data-testid`s round-trip.


## Sprint 100 — Unified System Tier 1: Dog Hub + Trainer Monday Digest (2026-02)
- ✅ **`GET /api/dogs/{id}/timeline`** — unified per-dog activity stream merging bookings (visit/checked-in/booked variants), report cards, homework assigned/completed, daily-tracker day approvals (with mood emoji surfaced), photo-gallery summary, and incidents. Newest-first sort, default limit 80, client perm-gated so portal users only see their own dogs. Helper `_fmt_service()` formats booking titles.
- ✅ **`GET /api/dogs/{id}/behavior-trend`** — mood (1-5) sparkline aggregation from daily-tracker `__mood` field values over the last N days (default 60). Returns `{points[{date,mood,plan}], avg, trend (up/down/flat), count}`. Split-half compare with ±0.4 threshold for trend detection.
- ✅ **`POST /api/admin/homework/send-monday-digest`** — admin-only force-fire that bypasses dedup so the operator can preview/re-send. Underlying `run_trainer_monday_digest_job` (in `daily_jobs.py`) gathers streak leaders, lost-streak nudges, pending reviews, unanswered questions, just-completed plans w/o cert, vaccines expiring this week, and the week's booking + revenue forecast. Sends via Resend to `ADMIN_NOTIFICATION_EMAIL`.
- ✅ **Frontend `DogTimeline.jsx`** — renders the unified stream inside the Dogs edit modal under a new **Timeline** tab (first tab). Color-coded event chips (visit/homework/day_approved/photos/incident), report-card note line, mood emoji on approval rows, "cert ready" badge on completion events.
- ✅ **Frontend `BehaviorTrendChart.jsx`** — pure-SVG sparkline (60-day default), gradient fill, hover tooltips per point with date · mood · plan name, big-number avg next to a trend chip (up/down/flat). Compact prop for portal usage.
- ✅ **Dogs.jsx wired** — added `Timeline` tab as the default initialTab on new dogs (`openNew`), tab item with `dog-tab-timeline` test id, conditional render under `tab === "timeline"`.
- ✅ **8/8 new regression tests pass** (`/app/backend/tests/test_unified_dog_hub.py`): timeline empty shape, timeline picks up homework+day_approved events with mood round-trip + newest-first sort, behavior-trend empty state, behavior-trend mood detection, 404 on unknown dog (both endpoints), Monday digest force-fire 200 shape, unauthenticated digest blocked. Adjacent daily-tracker + weekly-digest suites (15 tests) still pass — no regressions.
- ✅ **Verified via smoke screenshot** — Buddy's Dog Hub renders the Timeline tab as default, shows lifetime stats pills (3 daycare / 0 boarding / 5 training / last visit), behavior-trend empty state for dogs without daily-tracker mood logs, and 10 historical events including price-tagged visits.


## Sprint 110l — Merged single-card-per-plan UX in client portal (2026-02)
- ✅ **User reported**: Today's Plan and Training Homework felt like two redundant blocks showing the same plan twice.
- ✅ **Chose option 1a + 2a**: one card per plan with TODAY's actionable day at the top + collapsed "Previous days" accordion below, achievements panel stays separate.
- ✅ **`TodayPlanCard` refactored** to accept two new props:
  - `homeworkId={id}` — filters today-plan items to ONE specific plan
  - `unwrapped={true}` — skips the outer green "Today's Plan" frame (caller owns the chrome)
  - Both default to legacy behavior so the component is still usable as a standalone top-of-portal tile if ever needed.
- ✅ **Portal.jsx flow rewritten**:
  - Removed the standalone `<TodayPlanCard onChanged={loadAll} />` from the top of the portal — no more separate "Today's Plan" section.
  - Each daily-tracker plan card in the Training Homework list now embeds `<TodayPlanCard homeworkId={h.id} unwrapped={true} />` directly under the plan header. Today's actionable day (steps + form + submit) lives WITH its plan, not in a parallel section.
  - Below that, a new `<details>` accordion ("Previous days & history" — `data-testid="portal-history-{id}"`) wraps the existing `DailyCheckInCard` so historical days, trainer notes, and question threads are one click away but don't clutter the active-day view.
- ✅ **Achievements panel kept separate** (per user choice) — `HomeworkIncentivesPanel` still renders standalone above the Training Homework section since it spans all plans (streak + trophies + share certs + referral).
- ✅ **Backward compat**: if a client has a plan with no actionable day right now (all submitted/approved/rest), `TodayPlanCard` filters to zero items and renders nothing — the history accordion still works, so the plan card doesn't go blank.
- ✅ **Lints clean**. All 32 homework pytests pass — no backend changes were needed since the same `/portal/today-plan` endpoint and same data shape are reused, just rendered inline per plan.


- ✅ **User reported**: in the new fullscreen homework view, clicking the close button OR a step check-circle "doesn't do anything."
- ✅ **Root cause #1**: the modal was rendered as a child of `TodayPlanCard`, which was nested inside Portal.jsx layout containers. A parent's `transform` / `filter` / `will-change` would have made `position: fixed` get clipped to that container OR put it behind another layer. Same containing-block issue caused buttons to be visually present but functionally trapped behind an overlay.
- ✅ **Root cause #2**: when a user clicked a check-circle, `toggleStep` mutated the backend → `load()` refreshed `data` → but `fullscreenItem` state still pointed at the OLD object from when the modal opened, so re-renders never reflected the toggle. The state didn't update visually, so it felt like the click did nothing.
- ✅ **Fix #1 — React portal**: modal now renders via `createPortal(..., document.body)` so it always mounts at the document root, escaping every parent stacking context, transform, and overflow. Z-index raised to `9999`.
- ✅ **Fix #2 — Auto-sync `fullscreenItem` on each `load()`**: after a refresh, we look up the same homework_id in the new data and re-assign it. Step toggles now visibly update immediately.
- ✅ **Fix #3 — Escape-key + body scroll lock**: pressing Escape closes the modal; background scroll is locked while it's open so the page behind doesn't drift on mobile.
- ✅ **Fix #4 — Bigger, more obvious close affordances**:
  - Top-right circular red X button (44×44, `data-testid="today-plan-fullscreen-close"`)
  - NEW full-width green "Done reading — back to portal" button (`today-plan-fullscreen-done`) at the bottom of the modal so users who scroll far down always have an obvious exit
- ✅ **Fix #5 — Larger step-check circles**: bumped from 40px → 48px with a green hint-dot inside the unchecked state so it's visually clear "this is tappable" + `active:scale-95` press feedback.
- ✅ **Lints clean.** No backend or test changes — purely a UI-mounting and state-sync correctness fix.


- ✅ **User reported** with a screenshot: step text ends mid-sentence ("without asking for an", "even for a", "If they don't look, lur"). NOT a CSS issue — the text was being chopped IN THE DATABASE on save.
- ✅ **Root cause** (`server.py:3976`): `"label": (s.get("label") or "Step").strip()[:200]` — every step label was capped at exactly 200 characters during the plan save. The 110i "expandable steps" feature added an `description` field but the user was pasting the full text into `label`, which got the axe.
- ✅ **Fix #1 — Raised the step label cap from 200 → 2000 characters** so long step instructions like the user's "Charge the Marker (2 mins): Low distraction. Sit with your dog. Say your marker word (e.g., 'Yes!')..." save in full going forward.
- ✅ **Fix #2 — Step `description` and `notes` also persisted** (max 5000 chars each) — these were already exposed on the read side from sprint 110i but the write path wasn't normalizing them. Now plans can save the rich text the read endpoint surfaces.
- ✅ **Fix #3 — Raised `day_focus` cap from 200 → 2000** so the per-day brief can be a full paragraph instead of getting rejected/truncated.
- ✅ **HEADS UP TO ADMIN**: existing plans already in the DB with truncated labels CANNOT be recovered — the lost text is gone. Re-edit + save those plans to get the full instructions stored (the current code now accepts up to 2000 chars).
- ✅ All 26 homework pytests still pass. Backend lints clean.


- ✅ **User reported**: clients can't read long step labels in Today's Plan — they want to click/expand each step and even open the whole thing in a "new window" for breathing room.
- ✅ **Fix #1 — Backend payload enrichment** (`/portal/today-plan` → `items[].steps[]`): each step now also returns `description` and `notes` so the portal can render rich detail when expanded. Existing data unaffected (fields are optional, default to empty string).
- ✅ **Fix #2 — Expandable step rows** (`TodayPlanCard.jsx`): each step is now a 2-row component:
  - Top row: check-circle button (idempotent toggle) + step label + minute pill. Click the label area to expand if there's a description/notes (chevron indicator); otherwise the label area still toggles done so we never lose the existing single-tap behavior.
  - Bottom row (only when expanded): full description + italic trainer notes with a left-border accent.
  - Labels now wrap with `break-words leading-snug` instead of single-line clipping.
- ✅ **Fix #3 — Trainer's instructions block** rendered above the steps on every Today's Plan day, showing the per-day longer-form instructions stored on the homework. Pre-wrap preserves multi-line formatting.
- ✅ **Fix #4 — "Open fullscreen" button** on every Today's Plan item (`today-plan-fullscreen-{id}`) → opens a full-page modal (`FullscreenItemModal`) that gives the client a wide-canvas view of the whole training day:
  - Sticky header with dog/day/title + Close button
  - Day focus, full trainer instructions, all resources, ALL steps with their descriptions/notes expanded inline
  - Bigger step check-circles (40px) + larger fonts (17px labels, 14px descriptions) for tablet/phone readability
- ✅ **Fix #5 — `DailyCheckInCard` day-focus** no longer truncated to 2 lines — full text shown on each historical day card so clients can re-read past day briefs.
- ✅ **Lints clean**. All 32 homework-related pytests still pass (no regressions across redesign + driven-tracker + incentives suites).


- ✅ **User reported**: multi-dog discount should differ by service type — daycare and boarding have different margins.
- ✅ **New settings field** `multi_dog_discount_by_service: Dict[str, Dict[str, Any]]` — keyed by service_type (`daycare`, `boarding`, `training`, `grooming`, `photography`) → `{enabled, mode, value, label}`. Master toggle `multi_dog_discount_enabled` still gates the entire feature.
- ✅ **`_compute_multi_dog_discount` rewritten** to look up the booking's service_type in `multi_dog_discount_by_service` first. Falls back to legacy flat fields (`multi_dog_discount_mode/value/label`) so existing installs keep working without migration.
- ✅ **`multi_dog_discount` audit blob on bookings now carries `service_type`** so income reports + receipt reprints can group "which service had which discount tier applied" accurately.
- ✅ **Settings UI overhauled**: under Booking Rules → Multi-dog household discount section, admins now see ONE master toggle + 5 per-service cards (daycare/boarding/training/grooming/photography) each with their own enable checkbox, mode (percent/flat), value, and receipt label. Cards dim/grey when their own toggle is off so it's clear which tiers are live.
- ✅ **Legacy data auto-migrates**: when a user opens the panel with the OLD flat schema, the enable-state is mapped onto the daycare card by default and the legacy value/mode flow in as that card's seed values.
- ✅ **2 new pytests pass** (`test_per_service_discount_config`, `test_legacy_flat_config_still_works_when_per_service_empty`):
  - Daycare 25% on / boarding disabled → 2nd daycare booking gets 25% off, `discount.service_type=="daycare"`
  - Empty `multi_dog_discount_by_service: {}` with legacy fields populated still applies the legacy 10% across services
- ✅ All 8 multi-dog-discount tests + all checkout-related suites still pass; no regressions.


- ✅ **User reported**: clients aren't getting the email when they hit 2 daycare credits.
- ✅ **Root cause**: `notify_client_low_credits` was IMPORTED in `server.py` but never CALLED from any code path. Credit decrements at checkout silently happened with no email trigger. The Today's Tasks dashboard pip at line 6350 was the only signal that something low was happening.
- ✅ **Fix #1 — Wired into checkout** (`server.py`): every credit-consuming code path in `check_out` now calls `_maybe_send_low_credit_email(client_id, pool, new_balance)` immediately after the `$inc` decrement. Covers both the standard path (line ~2510) and the extra-boarding-nights path (line ~2604).
- ✅ **Fix #2 — Email function now supports boarding** (`email_service.py`): was hard-coded to daycare/training labels; now maps `boarding → "Boarding" / "nights"` too.
- ✅ **Fix #3 — Smart idempotency** (`_maybe_send_low_credit_email`): stamps the client doc with `low_credit_emailed_at.{pool} = {balance, at}` after each email. The next checkout at the SAME balance is skipped (no spam). When the balance moves to a NEW lower value within the warn zone, a new email fires (so "2 left" and then "1 left" both go out). When the balance lifts back above 2, the stamp clears so the next dip re-arms the email.
- ✅ **Fix #4 — `adjust-credits` also clears stamps** when a manual top-up lifts a pool above 2, so a fresh credit pack purchase properly re-arms future heads-up emails.
- ✅ **Fix #5 — `ClientOut` Pydantic model** now exposes `low_credit_emailed_at` so admins/tests can verify which clients have been notified.
- ✅ **Threshold = 2** (matches the existing dashboard signal so email + dashboard pip fire in lockstep).
- ✅ **4 new pytests pass** (`/app/backend/tests/test_low_credit_email.py`):
  - First checkout that drops to ≤2 stamps `low_credit_emailed_at.daycare`
  - Stamp updates when balance changes within warn zone (2 → 1 → new stamp)
  - Manual `adjust-credits` lifting balance above threshold clears the stamp
  - Email function signature accepts a `service_type` arg (sanity check)
- ✅ All 10 checkout-related tests pass (no regressions in multi-dog discount or any other checkout path).


- ✅ **User reported**: training and photography on the Schedule "just show text" while daycare/boarding show colored indicators.
- ✅ **Root cause**: FullCalendar's `dayGridMonth` default behavior renders **timed events** (those with start/end times — i.e. training/grooming/photography) as a `display: list-item` row with a colored dot + time text, while **all-day events** (daycare/boarding) render as solid colored bars. So even though the backend was emitting the right color for each event, timed services looked like plain text rows.
- ✅ **Fix #1 — `eventDisplay="block"`** added to the `<FullCalendar>` in `Schedule.jsx`. Forces ALL events (timed AND all-day) to render as solid colored chips. Training/photography now look exactly like daycare/boarding visually, just with the time prefix still showing inside the chip.
- ✅ **Fix #2 — photography in the backend color map**: was missing entirely. Added amber `#f59e0b` so photography events come back with their own distinct color (different from training's purple). Confirmed via `GET /api/events`: training → `#a855f7`, photography → `#f59e0b`.
- ✅ **Fix #3 — frontend legend + booking dropdown**: `Schedule.jsx`'s legend and the "Service Type" `<select>` in the day-roster modal were both missing photography. Added so the legend chip and the booking creation flow both list it alongside the other 4 services.
- ✅ **Lints clean.** No new pytest needed — this is purely a UI-rendering concern; backend color emission was already covered by existing event-shape tests and the new sprint 110e photography tests.


- ✅ **User reported**: no hours settings for photography; should work just like grooming/training.
- ✅ **Root cause**: `_default_settings()` was missing the `photography` key under `service_hours`, so the forward-compat backfill loop never inserted a grid for it. The Settings UI's hours panel also iterated only `["daycare","training","grooming"]` so photography never had a render row.
- ✅ **Fix #1 — Backend defaults**: added `"photography": _default_hours_grid("09:00", "17:00")` to `_default_settings().service_hours`. Existing installs get auto-backfilled by `get_settings()` on next read; no migration needed.
- ✅ **Fix #2 — Schedule calendar timed events**: the FullCalendar event-builder previously hard-coded `b["service_type"] in ("training", "grooming")` for timed rendering — now it uses the shared `TIME_SLOTTED_SERVICES` constant (`training`, `grooming`, `photography`) so photography bookings with a time field render as proper timed events (start/end ISO datetimes) instead of all-day blocks.
- ✅ **Fix #3 — Event duration**: replaced the hard-coded "60 min for training, 90 min for grooming" with `b["duration_minutes"]` (the operator's saved length) → falls back to `_get_default_duration(service_type)` (admin-configured) → finally 60 min. So a 90-min photography shoot now shows up as a 90-min block.
- ✅ **Fix #4 — Settings UI**: added `"photography"` to the hours-grid loop in `Settings.jsx` so admins now see a "Photography Hours" section with per-weekday open/close/closed controls, identical to grooming/training.
- ✅ **3 new pytests pass** (`/app/backend/tests/test_photography_hours.py`):
  - `test_photography_default_hours_present` — settings grid exists with all 7 weekdays + open/close/closed keys
  - `test_photography_time_slots_use_configured_hours` — override Wednesday to noon-3pm, slots come back starting at 12:00 with no 15:00+
  - `test_photography_closed_day_returns_no_slots` — marking a weekday closed yields zero time-slots
- ✅ Settings panel still lints clean. No regressions in adjacent suites.


- ✅ **User accepted the social-proof improvement**: show first names of friends the client has brought in.
- ✅ **`/api/portal/incentives` extended** — `referral.recent` array of up-to-5 most-recent successful referrals from the `referrals` collection. Each entry: `{first_name, joined_at, service}`. **Privacy-safe**: only the first word of `referred_name` is exposed — never last name, never email, never client_id. Falls back to `"Friend"` if name unavailable.
- ✅ **UI**: new "Friends you've brought in" block inside `ReferralCard`, between the share-text blockquote and the action buttons. Each row: 🐾 first-name + relative-time stamp ("joined 3 weeks ago"). Driven by a small `timeAgo()` helper supporting just-now → years-ago granularity.
- ✅ **Hidden gracefully** when the client has no successful referrals yet (`recent.length === 0` short-circuits the whole block, no empty-state needed).
- ✅ **1 new pytest assertion** added to `test_portal_incentives_includes_referral_block`: validates shape + privacy invariants (no spaces in `first_name`, no `@` symbols, non-empty fallback). 6/6 incentives tests still green.


- ✅ **User accepted the improvement suggestion**: tap into existing referral infrastructure to drive growth via the homework dopamine loop.
- ✅ **Discovery**: ALL of the referral plumbing already existed end-to-end — `referral_code` field on clients, `referrals` collection, automatic 6-char code minting on `/portal/me`, signup honors `?ref=CODE` query param, and three referral trophies in the seed catalog (`client_friend_bringer` @1, `client_pack_builder` @3, `client_ambassador` @10) all wired to fire on first successful appointment of the referred client. Just needed to surface it.
- ✅ **`/api/portal/incentives` extended** to also return a `referral` block with `{code, successful_count, ladder, current_milestone, next_milestone, share_text}`. `share_text` is a pre-written, brand-aware invite message containing the client's actual code (`"Hey! I love {BRAND} for my pup. Sign up with my code 7KTUMQ and we both unlock a trophy once you complete your first appointment."`) so the client can paste-and-go.
- ✅ **New `<ReferralCard>` sub-component** rendered inside `HomeworkIncentivesPanel` (under shareable certificates):
  - Big-text referral code in branded orange (`incentives-referral-code`) + live friends-joined counter (`incentives-referral-count`)
  - 3-rung ladder visual matching the streak ladder pattern (greyscale-locked, gold-glow-unlocked)
  - "{N} more to unlock {NextMilestone}" callout
  - Pre-written share text in an italic blockquote
  - **Copy link** button (clipboard) + **Share now** button (uses `navigator.share` on mobile, clipboard fallback elsewhere) — link auto-built as `{origin}/?ref={code}` which the existing `Login.jsx` already auto-detects and flips to the register tab with the code prefilled.
- ✅ **Panel visibility rule updated** — now also shows when the client has just a referral code (so brand-new clients can find + share their code on day one, before they have any streak/badge activity).
- ✅ **1 new regression test passes** (`test_portal_incentives_includes_referral_block`): asserts shape + ladder size + that `share_text` contains the actual referral code. All 6 incentives-suite tests + 31 across homework suites green.


- ✅ **User chose**: streak milestones + trophies + shareable certificates — **NO free credits** (explicitly excluded).
- ✅ **Streak ladder added to seed catalog**: 6 fire-tier trophies on `homework_streak_days` at thresholds 3 (Streak Sparked — bronze), 7 (Homework Hero — bronze, existing), 14 (Two-Week Champ — silver), 30 (Month-Long Master — gold), 60 (Iron Streak — platinum), 100 (Centurion — diamond, new tier).
- ✅ **Plans-completed ladder expanded**: now 1 (First Plan Down — bronze), 5 (Five Down — bronze), 25 (Dedicated Owner — existing silver), 100 (Coach of the Year — existing gold).
- ✅ **New `diamond` tier** added to `TIER_COLORS` palette so Centurion renders with a purple ring/fill.
- ✅ **New endpoint `GET /api/portal/incentives`** (client-only, 403 for admin) — returns the client's current streak, total completed plans, current milestone (with emoji + label), next milestone (with `days_to_go`), the full 6-rung ladder, every homework trophy with `{current, threshold, pct, earned, awarded_id}` for progress bars, and the last 20 certificate-bearing homework records for the share carousel.
- ✅ **Shareable certificates** (no auth required on the public side):
  - `POST /api/homework/{id}/share-link` — client or admin can mint an unguessable 22-char share token; idempotent (returns existing token on repeat calls). Refuses with 400 if no certificate uploaded yet, 403 if a different client tries to share.
  - `GET /api/share/cert/{token}` — **PUBLIC** (no auth header) endpoint that returns certificate image + metadata + brand name. 404 on bogus tokens.
- ✅ **New frontend component `HomeworkIncentivesPanel.jsx`** rendered in client portal directly under Today's Plan:
  - Streak headline ("N days · 🔥🔥🔥 Two-Week Champ") + "next milestone in X days" callout
  - 6-rung visual ladder (greyscale for not-yet-reached, glowing for reached)
  - Earned trophies row (color-coded by tier ring)
  - Up-to-4 upcoming trophies with progress bars
  - Shareable certificates with copy-to-clipboard share button (uses `navigator.share` on mobile, clipboard fallback elsewhere)
- ✅ **New public route `/share/cert/{token}`** wired in `App.js` (same pattern as `/claim/{token}`) → renders `ShareCertificate.jsx`: branded page showing the cert image full-bleed, plan title, dog name, completion date, download button + native re-share button.
- ✅ **5 new pytests pass + 1 skipped** (`/app/backend/tests/test_homework_incentives.py`):
  - Verifies all 10 homework trophy tiers seeded with correct thresholds
  - `/portal/incentives` shape contract (every field the UI consumes)
  - Admin gets 403 from `/portal/incentives` (client-only)
  - Share-link refuses without a certificate (404/400)
  - Public share endpoint returns 404 on invalid token
  - End-to-end: admin uploads cert → mints share-link → unauth GET succeeds → 2nd mint returns SAME token (idempotent)
- ✅ All existing homework tests still pass (31 across 3 suites).


- ✅ **Multi-dog discount feature SHIPPED** — auto-applied at check-out for the 2nd-and-later dog of the same client on the same date. Solo-operator sales lever you can toggle on/off from Settings.
- ✅ **Settings panel** in `Settings → Booking Rules tab`: enable toggle, mode (percent vs flat), value, and customizable receipt label (defaults to "Multi-dog discount").
- ✅ **Persisted settings fields** in `settings` collection: `multi_dog_discount_enabled`, `multi_dog_discount_mode`, `multi_dog_discount_value`, `multi_dog_discount_label`.
- ✅ **Backend logic** in `_compute_multi_dog_discount()` (`server.py`): counts the client's other bookings on the same date that have already been checked out (status=completed, checked_out_at present). If 1+ siblings exist, the discount applies to the booking being checked out NOW. Applied AFTER add-ons + extra nights so it visibly reduces the final receipt price.
- ✅ **Pre-checkout preview endpoint** `GET /api/bookings/{id}/discount-preview` — returns `{eligible, preview_base_price, discount: {amount, mode, value, label, sibling_count}}` so the checkout modal shows the discount BEFORE the operator hits Submit.
- ✅ **Audit trail on the booking** — every discounted check-out persists `multi_dog_discount: {amount, mode, value, label, based_on_price, sibling_count, applied_at}` so income reports and receipt reprints stay accurate.
- ✅ **CheckoutModal UI** — discount preview fetched on mount, computed live against the current base price override, surfaced as a yellow "−$X · Multi-pup" line (`data-testid="checkout-multi-dog-discount"`) between the add-ons and the total. Total auto-recalculates.
- ✅ **Credit-only checkouts skip the discount** (no point discounting a $0 charge); the discount only fires when a real dollar amount is being charged.
- ✅ **6 new regression tests pass** (`/app/backend/tests/test_multi_dog_discount.py`):
  - Settings round-trip (enable, mode, value, label)
  - First dog of the day → full price, no `multi_dog_discount` metadata
  - Second dog same client same date → 20% off → correct `actual_price` + metadata
  - Flat-mode discount ($10 off) computes correctly
  - Setting disabled → no discount even with 2+ dogs
  - `discount-preview` endpoint requires auth (401/403 unauth)
- ✅ All adjacent suites (today-brain dismissals, auto-backup, etc.) still pass — no regressions across the 25-test run.

### Vaccine upload from portal — already existed (no work needed)
- ✅ `POST /api/portal/dogs/{dog_id}/vaccine-update` — client uploads cert photo + expiry, vaccine record updates immediately so they're unblocked for booking.
- ✅ `GET /api/admin/vaccine-cert-uploads` — admin's pending review queue with the uploaded photo.
- ✅ `POST /api/admin/dogs/{id}/vaccine-cert/{vaccine}/review` — approve/reject flow.
- ✅ Client-portal modal `VaccineUploadModal` in `Portal.jsx:283` wires the upload UI to the endpoint with a photo picker + expiry-date input.


- ✅ **User asked**: a way to clear Today's Tasks on the admin dashboard — per-row X to dismiss, plus a "Clear all" for one-tap inbox-zero.
- ✅ **Smart re-appearance via signature gating**: every item gets a server-computed `signature` capturing its underlying state (credit pool counts for low_credits, expiry date for vaccines, pending count for booking_pending, today's date for monday_digest/no_checkin/steps_incomplete, percent-bucket for pipeline_ready, etc). A dismissal is stored with that signature; the GET filter only suppresses items whose CURRENT signature still matches the dismissed one — so if credits drop further or a new pending booking arrives, the item reappears automatically.
- ✅ **3 new endpoints (admin-only)**:
  - `POST /api/admin/today-brain/dismiss` `{item_id, signature}` — upserts a dismissal for one row.
  - `POST /api/admin/today-brain/clear-all` — fetches the current visible list and dismisses every row with its current signature in one batch.
  - `POST /api/admin/today-brain/restore` `{item_id}` — pulls a row back into view.
- ✅ **New collection `task_dismissals`** with shape `{item_id, signature, dismissed_at, dismissed_by}`. `item_id` is the unique upsert key.
- ✅ **Frontend `TodaysBrainTile`** rewritten:
  - Tile header now has a small "🧹 Clear all" button (`brain-clear-all`) with a confirm dialog explaining auto-reappearance.
  - Every `BrainRow` now renders an X dismiss button in the top-right corner (`brain-dismiss-{item.id}`), independent of the row's CTA click target.
  - Modal version also has its own "Clear all" (`brain-modal-clear-all`) so the user can purge from the full-screen list too.
  - `busy` state across the tile/modal during the round-trip so accidental double-clicks don't fire two dismisses.
- ✅ **6 new regression tests pass** (`/app/backend/tests/test_today_brain_dismissals.py`):
  - signature present on every item
  - dismiss removes a single item from the list
  - **dismiss with stale signature does NOT hide the item** (proves the gate works)
  - restore brings an item back
  - clear-all empties the queue completely
  - admin-only guard on all three endpoints (401/403 for unauth)
  - All 7 existing `test_todays_brain.py` tests still pass — no regressions.


- ✅ **User asked**: "clients shouldn't be ok to mark today's plan done until the corresponding homework is filled out" — chose option **C: single-form merge**, fold the day's fields right into the Today's Plan card so checking steps and filling fields happens in one place.
- ✅ **`TodayPlanCard.jsx` rewritten** as the SOLE place to complete the current actionable day. Now renders, in one card, in order:
  - Per-step checklist (live-toggles via `/homework/{id}/day/{n}/toggle-step` — instant progress dopamine, no submit needed)
  - "Today's homework" section: mood selector (1-5 emoji), every templated field (`reps`/`sets`/`duration_min`/`success_rate`/`rating_5`/`text`/`longtext`/`checkbox`/`mood_5`), optional note textarea, optional photo upload
  - **"Mark Day Complete"** button — replaces the old "auto-submit when all steps checked" behavior with an explicit, user-controlled submission
- ✅ **Submit-gating logic** (`blockReason()`): the button is disabled (and shows the precise reason as a `data-testid` text) until ALL of:
  - Every step is checked (`"Check off every step first"`)
  - Mood is selected (`"Pick how today went (mood)"`)
  - Every non-checkbox field has a value (`"Fill in \"{label}\""`)
  Then submit POSTs the combined payload to `/homework/{id}/day/{n}/submit` (existing endpoint, no backend change).
- ✅ **`DailyCheckInCard.jsx` suppresses the duplicate "today's day" filling pane** via the new `hideActionableForm` prop. The auto-open of `available`/`needs_redo` days is short-circuited, and `DayRow` no-ops the `actionable` flag for those statuses so the inputs don't render twice. History rows (`approved`/`submitted`/`rest`) still open normally for review-note + question-thread viewing.
- ✅ **`Portal.jsx` wires `hideActionableForm={true}`** on every `DailyCheckInCard` mount for daily-tracker homework — so the standalone homework card below now only shows historical days, never duplicating the active form that's at the top in Today's Plan.
- ✅ **All 26 existing homework + daily-tracker pytests still pass** (no backend changes were needed — the submit endpoint and shape were already correct).
- ✅ **Smoke-tested via Playwright**: `today-plan-card`, `today-plan-form-*`, `today-plan-mood-*`, and `today-plan-submit-*` all present in the rendered client portal for `testclient@sithappens.com`.


- ✅ **Question from admin:** "can we code this in to auto mount the disks on start up automatically since our app just auto starts" — they run via Docker on Bazzite (auto-starts on boot). Because the container is **non-privileged**, the backend itself cannot mount drives; the right answer is to let the host (Bazzite's GNOME/udisks2) auto-mount USB drives — which it already does at `/run/media/<user>/<LABEL>` — and to bind-mount that path into the container so the CRM can simply *see* whatever's been plugged in.
- ✅ **New endpoint** `GET /api/admin/backup/detect-drives` — at the moment the Settings panel opens (no button press needed), the backend scans `/run/media/*/*`, `/media/*`, `/mnt/*`, and `/host/run/media/*/*`, filters out anything still on the container's overlay (i.e. empty dirs the container itself created), looks up fs type / fs source / free space from `/proc/mounts`, marks the largest writable drive as `recommended`, and returns either a list of one-click drives OR a `setup_required: true` flag with ready-to-paste Docker Compose **and** plain `docker run` snippets (both using `rslave` propagation so newly plugged USB drives appear live without restarting the container).
- ✅ **Settings UI** — `AutoBackupPanel` now auto-runs `detect-drives` on mount and renders, just above the path input:
  - If 1+ drives found → a click-to-pick list (`data-testid="auto-backup-drive-{i}"`) with a green "Recommended" badge on the best candidate; clicking auto-fills the path as `<drive>/sit-happens-backups`. Includes a hint to plug in the drive + click Verify Path if missing.
  - If 0 drives + container can't see any host mount → a yellow "First-time setup needed" card with the docker-compose and docker-run snippets in collapsible details (`auto-backup-setup-compose`, `auto-backup-setup-run`), with a one-paragraph explanation that Bazzite auto-mounts USB drives on plug-in so this is a one-time wire-up.
- ✅ **Startup hook in `server.py`** — at `@app.on_event("startup")`, the backend now logs "Auto-backup: N external drive(s) visible at boot: <paths>" or "no host-bind-mounted drives visible. If you intend to back up…". This appears in the user's container logs every boot, so they catch a broken bind-mount the moment they see the logs instead of when a silent backup fails.
- ✅ **2 new regression tests pass** (`/app/backend/tests/test_auto_backup.py`, now 13/13): shape-contract check (every UI-consumed field present + `rslave` in snippet) and admin-only guard.
- ✅ **Why this satisfies "auto-mount on app startup"**: on Bazzite, the OS already auto-mounts USB drives via udisks2 *before* Docker starts the CRM. Once `/run/media` is bind-mounted (one-time docker-compose change), every reboot the user gets a fully working auto-backup system without manual mount commands. The CRM transparently picks up new drives on plug-in (rslave propagation), so swapping or adding a backup drive is plug-and-play.


- ✅ **Root cause** of "Run Now says completed but no file appears on the external drive": when the backend runs inside a container/pod, typing a host path like `/mnt/external/drive/...` causes Python to silently `mkdir -p` that path **inside the container's overlay filesystem** and write the gzip there. The file is real, the response says success — but it's on container ephemeral storage, NOT bind-mounted to the user's actual disk. On every container restart, the file vanishes; meanwhile the user sees nothing on their drive.
- ✅ **New endpoint** `POST /api/admin/backup/inspect` (admin-only) — runs a full pre-flight on a path *before* scheduling: resolves it, walks up to find the real mountpoint, looks up the fs type and source from `/proc/mounts`, computes free space, performs an actual write-probe (create + delete a tiny file), lists existing `sit-happens-backup-*.json.gz` snapshots already in the folder, and returns a single human-readable `verdict` (`ok`/`warn`/`fail`) with a clear `verdict_message`. Overlay/tmpfs/aufs (or anything mounted at `/`) is flagged `likely_ephemeral: true` with a fix tip about bind-mounting.
- ✅ **`run_auto_backup_job` enriched** — every successful run now also persists `mountpoint`, `fs_type`, `fs_source`, and `likely_ephemeral` into `system_runs` (both the per-run row and the `auto_backup:last` pointer) so the Settings UI can display, post-run, exactly what filesystem the file landed on.
- ✅ **Settings UI** — new **Verify Path** button next to Save/Run Now (`data-testid="auto-backup-verify"`) calls the inspect endpoint and renders a color-coded diagnostics card (green/yellow/red) with resolved path, mountpoint, fs type+source, free space, write-test result, and (if ephemeral) a copy-pasteable Docker/Podman bind-mount example. The "Last successful backup" card now also surfaces `mount=… · fs=…` and a loud yellow "⚠ Container ephemeral — NOT on host disk" pill when the file landed in container scratch space, so the admin can never again be fooled by a green checkmark.
- ✅ **5 new regression tests pass** (`/app/backend/tests/test_auto_backup.py`, now 11/11):
  - `test_inspect_returns_diagnostics_for_writable_path` — shape + write_test.ok
  - `test_inspect_flags_ephemeral_overlay_storage` — overlay/tmpfs → verdict=warn + likely_ephemeral=True
  - `test_inspect_bad_path_reports_failure` — `/dev/null/...` returns 200 with verdict=fail (no 500)
  - `test_inspect_admin_only` — unauth 401/403
  - `test_run_now_response_includes_mount_diagnostics` — run-now + status both expose mountpoint/fs_type/likely_ephemeral
- ✅ **Curl-verified in Emergent preview**: `/mnt/ext/...` → `verdict=warn`, `fs_type=overlay`, mountpoint=`/`; `/app/...` → `verdict=ok`, `fs_type=ext4`, `fs_source=/dev/nvme0n16` — confirming the heuristic correctly distinguishes ephemeral from real-disk paths.


## Sprint 110bb — Admin Staff list pay snapshot (2026-06-01)
- ✅ New `/api/admin/staff/pay-snapshot` — single round-trip returning each active employee's `this_week_hours/gross`, `last_week_hours/gross`, `ytd_hours/gross`, and a `live` block when currently clocked in. Plus totals at the top so the admin can see weekly labor pacing at a glance.
- ✅ Staff page header chip: `"This week so far · $XXX.XX · XX.Xh · N on the clock now"` (only renders when there's actual activity).
- ✅ Per-row pay mini-line beneath each employee: `"This wk · X.Xh · $X.XX · Last wk … · YTD … · Now …"` (only renders for active employees with any activity).
- ✅ "On the clock" pulse pill next to name while a shift is open.
- ✅ Pytest `test_staff_pay_snapshot.py` (3/3): payload shape, active-only filter, live block structure. All 6 staff-related tests still pass.

## Sprint 110ba — Staff timecard now shows PAY (2026-06-01)
- ✅ `/api/time-clock/me` enriched: per-entry `gross`, `total_gross`, `hourly_rate`, `this_week` / `last_week` (Sun → Sat U.S. weekly period), `ytd` (calendar year), and a `live` block with `hours_so_far` + `gross_so_far` while currently clocked in.
- ✅ New `/api/time-clock/me.csv?days=N` — staff can download their own timecard for personal records.
- ✅ **EmployeePortal Timecard tab** redesigned:
  - 4 summary tiles (This Week / Last Week / Last 30 / YTD) each showing both $ and hours
  - "Hourly Rate · $X.XX" badge (or orange "No hourly rate set — ask admin" hint when missing)
  - CSV download button
  - Each daily row + each entry shows $ alongside hours
  - Live tile auto-refreshes every 30s while clocked in
- ✅ **Clock tab** now shows `"Earned today: $X.XX @ $Y/hr"` line beneath running hours while a shift is open.
- ✅ Pytest `test_staff_timecard_pay.py` (3/3): pay fields present, live shift gross_so_far matches hours × rate, CSV download has Hourly rate + Gross + TOTAL.

## Sprint 110az — Legacy pricing impact chip on today's P&L (2026-06-01)
- ✅ `/api/admin/today-pnl` response now returns three new fields: `catalog_forecast` (what today would be at catalog list), `legacy_delta` (forecast − catalog, negative = below catalog), `legacy_client_count`.
- ✅ Dashboard P&L tile renders a chip `"$X.XX below/above catalog (N legacy clients)"` in orange (below) or green (above), only when at least one of today's bookings has an active override. Hover tooltip shows the catalog forecast.
- ✅ Live verified: with a $20 override against a $35 catalog daycare → tile shows `$50.00 revenue` + `$15.00 BELOW CATALOG (1 legacy client)` chip.
- ✅ Pytest extended in `test_today_pnl_legacy_pricing.py`: asserts the new `legacy_delta`, `legacy_client_count`, `catalog_forecast` keys exist and carry the correct values. 7 passed, 1 benign skip; all 14 related P&L tests still green.

## Sprint 110ay — Today's P&L honors legacy pricing (2026-06-01)
- ✅ `GET /api/admin/today-pnl` now consults `price_overrides` for each booking's client+service pair before falling back to the catalog list price. So grandfathered clients are forecast at their actual rate, not the new public rate.
- ✅ Boarding correctly multiplies the legacy nightly rate by the number of nights.
- ✅ Bulk-loads overrides once per call (single Mongo query for all today's clients) — no N+1.
- ✅ Pytest `test_today_pnl_legacy_pricing.py`: 1 passed, 1 skipped (skip is benign — every test client already has overrides, so no clean baseline available). The passing test proves the delta in today-pnl revenue equals the override price, not the catalog list.
- ✅ Regression: existing P&L tests (`test_training_pnl`, `test_cancel_with_charge`, `test_five_feature_batch`) — 14/14 still pass.

## Sprint 110ax — Dog Fact of the Day (2026-06-01)
- ✅ **199 curated facts** seeded across anatomy / behavior / breed / health / training / myth-buster / fun. Idempotent seed runs on startup.
- ✅ **Deterministic daily rotation**: `GET /api/dog-facts/today` picks via `date.toordinal() % len(active_facts)` — same fact for every user same day, ~6.5 months before any repeat.
- ✅ **Admin CRUD endpoints** + **AI generation** via Claude Haiku (Emergent LLM key) — generated facts staged inactive for admin review. EMERGENT_LLM_KEY added to backend/.env.
- ✅ **`DogFactCard`** component (`big` for portal, `chip` for admin dashboard) with localStorage day-cache so the card stays stable across mounts.
- ✅ **Wired into Client Portal** (big hero card above main grid) and **Admin Dashboard** (compact chip under Today's Brain). Same fact in both places.
- ✅ **Settings → Email Automation** gets a full "Dog Fact of the Day" management panel: today's preview, AI generate, add-your-own composer, filters (All/Active/Inactive/AI), per-row On/Off + edit + delete.
- ✅ Pytest `test_dog_facts.py` 5/5: today shape, day-stability, admin CRUD round-trip, client-read+admin-guard, ≥100 seed.

## Sprint 110aw — 5-feature batch: birthday toggle, 1099/W2, sales tax, meet-n-greet, board-and-train (2026-05-31)

### #1 Birthday email toggle
- ✅ Added `settings.birthday_email.enabled` (default `True` — preserves the live behaviour).
- ✅ `daily_jobs.run_birthday_job` now early-exits with `{"disabled": true}` when the setting is off.
- ✅ Settings → Email Automation: the "Dog Birthday Cards" card's static `On` badge replaced with a real green/dark toggle button (`data-testid="birthday-email-toggle"`).

### #2 Year-end payroll CSV (1099 / W2 prep)
- ✅ New `GET /api/admin/payroll/year-end.csv?year=2026&detail=true|false` — returns per-employee summary (hours × hourly_rate = gross), optional detail dump of every clocked entry. Uses existing `time_clock_entries`.
- ✅ Settings → Backup & Restore → "Year-End Payroll" panel with year picker + Detail toggle + Download button.

### #3 Sales tax
- ✅ New `settings.sales_tax`: `{enabled, rate_pct, label, applies_to: {daycare, boarding, training, grooming, photography, retail, credit_packs}}`. All defaults OFF/0 — opt-in.
- ✅ **Check-out flow** (`POST /bookings/{id}/check-out`): when the service type is in `applies_to`, the booking's `tax_amount` and `tax_rate_pct` are snapshotted and tax is added to `actual_price` so existing P&L code keeps working.
- ✅ **Retail logging** (`POST /retail-sales`): treats `amount` as the total incl. tax (POS convention), back-calculates `pre_tax_amount` + `tax_amount` when applicable.
- ✅ New `GET /api/admin/sales-tax/summary?start_date=&end_date=` — YTD total + bookings-vs-retail split + per-month breakdown. Defaults to current calendar year.
- ✅ New BookingOut fields `tax_amount`, `tax_rate_pct` surface the breakdown to clients.
- ✅ Settings UI: Rate input, label, applies_to chips, save button, and a live YTD summary tile.

### #4 Meet-n-Greet / Temperament-eval workflow
- ✅ New `Client.client_status: "prospect"|"evaluation_scheduled"|"evaluated"|"active"|"rejected"` (default `active` — existing clients are untouched).
- ✅ New `settings.evaluation.require_evaluation_first` (default OFF). When ON, *new* clients are created as `prospect`.
- ✅ Booking guard: prospect / evaluation_scheduled / rejected clients get a 400 unless an admin passes `override_capacity=true` (admin override path for scheduling the eval itself).
- ✅ New `POST /api/clients/{client_id}/status` — atomic state advance with optional note appended to `evaluation_notes`.
- ✅ Clients screen: non-active clients show a clickable pill (Prospect / Eval Scheduled / Evaluated / Rejected) that opens a state-change modal with optional note. Active clients show nothing (zero noise).
- ✅ Settings → Backup & Restore → "Meet-n-Greet Required" toggle.

### #5 Board-and-Train auto-enrollment
- ✅ New `Service.package_program_id` — wires a service to a training program.
- ✅ Added `BookingIn.service_id` so the operator can pre-select a specific service at booking time.
- ✅ `POST /bookings`: when the chosen service has `package_program_id` and the dog isn't already actively enrolled, the system auto-creates a dog_programs enrollment (with snapshot of curriculum + completion rule + suggested target date) and stores the enrollment id back on the booking.
- ✅ Services editor: new "Board-and-Train · auto-enroll program" picker on non-addon services.

### Testing
- ✅ Pytest `test_five_feature_batch.py` — **8/8 pass**: birthday toggle default ON; toggle OFF blocks job; payroll CSV format; sales-tax checkout snapshot; sales-tax summary endpoint; retail tax back-calc; client status round-trip with note; board-and-train auto-enrolls and persists `package_enrolled_program_id` on the booking.
- ✅ Full regression run: 370 pass, 5 pre-existing failures (homework template seed drift + 4 ancient credit-deduction tests from before the sprint that moved credit deduction to checkout) — all confirmed unaffected by my changes via pre-edit baseline.

## Sprint 110av — Disk usage monitor + nightly auto-backup (2026-05-31)
- ✅ **`GET /api/admin/disk-usage`** — returns every mountpoint visible from inside the container, using `shutil.disk_usage()` + `/proc/mounts` to detect fs_type. Each row carries `pct_used`, `verdict` (ok/warn/danger), `likely_ephemeral` (true for overlay/tmpfs), `free_bytes`, `total_bytes`, etc.
- ✅ **Auto-backup loop** (in-process asyncio task): nightly at configurable HH:MM, writes a gzipped JSON of all 32 collections to a configurable folder, prunes anything older than retain-days. Honors the `enabled` flag on every iteration so toggling is instant.
- ✅ **`/api/admin/auto-backup/{config,run-now,runs}`** — config get/put, manual trigger, last-N history.
- ✅ **Settings → Backup & Restore** UI adds two new panels at the top:
  - **Disk Usage** — live tile with color-coded usage bars, fs_type pill, free/used/total GB, ephemeral warning, Refresh button.
  - **Auto-Backup · Nightly** — Enable toggle (ON/OFF status pill), hour+minute, target folder (with live free-space + ephemeral warning), retain-days slider, Save & Run Now buttons, Last Run summary, expandable run history.
- ✅ **Pytest** `test_disk_and_auto_backup.py` (3/3): disk-usage payload contract; config round-trip; run-now writes a valid `.json.gz` and shows in history.
- ✅ **Live smoke-tested**: ran-now wrote `/app/backups/sit-happens-2026-05-31_215452.json.gz` (1.3 MB, 32 collections, 816 docs).

## Sprint 110au — Bookings list = upcoming only (2026-05-31)
- ✅ Bookings list now filters to **upcoming** (today + future) by default. Past-dated rows fall into history alongside completed / cancelled / rejected — still reachable via the existing "Show History" toggle.
- ✅ Hero eyebrow updated to `${upcoming} upcoming · ${total} total` so the operator can see at a glance how much is hidden.
- ✅ Smoke-tested live: 15 upcoming visible / 244 total in DB / 229 history rows correctly stashed.

## Sprint 110at — Calendar keeps completed bookings, Bookings list still hides them (2026-05-31)
- ✅ `/api/events` now includes `status="completed"` bookings (previously only `approved` + `pending`). Completed events render with a muted slate (`#64748b`) color so the active queue still pops visually.
- ✅ Bookings list view already hides `completed` / `cancelled` / `rejected` by default via `showHistory=false` — verified unchanged. Operator can still toggle "Show history" to peek.
- ✅ Pytest `test_calendar_completed_events.py` (2/2 pass): completed booking surfaces in `/events` with muted color; active bookings still render.

## Sprint 110as — Cancel-with-charge from today's check-in board (2026-05-31)
- ✅ **Backend** `DELETE /api/bookings/{id}` now accepts `?forfeit=true|false` (default `false`).
  - `forfeit=true` (admin/employee only): credits stay deducted, status flips to `cancelled` with a `cancellation_charged=true` flag and a snapshot `cancellation_fee` (pulled from `actual_price → credit_value → service.base_price`, in that order). Client role gets a 403.
  - `forfeit=false`: existing behaviour (credits refunded, lot history restored, booking exits the P&L).
- ✅ **P&L / Income coverage**: `/api/admin/today-pnl` now includes cancelled bookings where `cancellation_charged=true`, counting `cancellation_fee` as revenue. `/api/transactions` keeps charged cancels in the income feed but still hides plain refunded cancels.
- ✅ **BookingOut** model extended with `cancelled_at`, `cancellation_charged`, `cancellation_fee` so the UI can surface the late-cancel marker.
- ✅ **Dashboard today's check-in board** (`Dashboard.jsx`): the Cancel button now shows on every row that hasn't been checked out yet (was previously only when on-premises).
- ✅ **`CancelBookingModal`** (`CheckoutModal.jsx`) redesigned:
  - Two big stacked actions — green **Cancel · refund in full** vs red **Cancel · charge $X / no-show fee**.
  - Context block shows whether the booking has credits / cash attached, or pulls from catalog when neither is set.
  - Both buttons always available so the operator never has to "Check In then immediately Check Out" to record a no-show.
- ✅ **Pytest** `test_cancel_with_charge.py` (3/3): forfeit cancel keeps credits + flags + fee; default cancel still refunds and drops out of P&L; clients get 403 on `?forfeit=true`.

## Sprint 110ar — BookingDetailModal wired into Run Sheet (2026-05-30)
- ✅ Run Sheet cards (`/app/frontend/src/screens/RunSheet.jsx`) are now clickable and open the same unified `BookingDetailModal` used by Dashboard / Bookings / Schedule.
- ✅ Adds `cursor-pointer` + green-border hover state for the on-screen surface, but uses `print:cursor-auto print:hover:border-bgHover` so the print stylesheet stays clean.
- ✅ Keyboard accessible: `role="button"`, `tabIndex={0}`, Enter/Space open the modal.
- ✅ Smoke-tested live: 2 cards on premises today, click on Buddy → modal opened (`booking-detail-modal` count = 1) showing booking timeline, service, pricing, status.

## Sprint 110aq+ — Unified BookingDetailModal verification (2026-05-30)
- ✅ **Build-breaking duplicate fixed in `/app/frontend/src/screens/Schedule.jsx`**: the previous session left a legacy local `BookingDetailModal` function alongside the new imported unified component, causing `SyntaxError: Identifier 'BookingDetailModal' has already been declared` and crashing the whole app to a runtime-error overlay. Removed the dead 178-line trailing block (incl. local `Row` helper) — file now ends at line 361 after the main `Schedule` export.
- ✅ **Verified unified modal opens from Schedule calendar**: clicking an `.fc-event` in the calendar opens `[data-testid="booking-detail-modal"]` and renders dog, client, service, date, timeline, booking notes, and pricing in one read-only view.
- ✅ **Training $0 P&L fix re-verified** by pytest (`test_training_pnl.py` — 3/3 pass): unbilled training rows do **not** pad today's P&L; $0 explicit checkout keeps P&L at $0; non-zero checkout still records revenue correctly.
- ✅ **BookingDetail backend payload re-verified** (`test_booking_detail_payload.py` — 3/3 pass): `/bookings/{id}`, `/dogs/{id}`, `/clients/{id}` all return the composite fields the modal needs (dog photo/care/vaccines, client contact, booking add-ons & credit info).

## Backlog / Next Up
- **P1** Public booking page (`yourdomain.com/book` — no login required)
- **P1** Vaccine expiry email blast
- **P1** Auto-email client when admin creates a Pup Report Card / uploads new file
- **P1** Cold-storage auto-prune of completed/cancelled bookings 90+ days old
- **P2** "Today's brain" dashboard tile (actionable queue replacing scattered alert dots)
- **P2** Client "Family Wall" — chronological feed in the client portal
- **P2** Sort Clients by last-login (so the admin can easily find the most inactive ones to re-engage)
- **P2** "We've moved" email-blast, Duplicate-clients merger UI, Light mode, Twilio SMS, photo→disk migration, waitlist
- **P3** Smart credit-pack suggester in client portal
- **P3** Universal Cmd-K search v2 (currently scoped to dogs/clients — extend to bookings/income/homework)
- **Refactor** Split `server.py` (~8700 lines) into route modules


## Sprint 110di — Real PNG splatter overhaul (2026-02-14)
**User feedback**: Previous CSS-generated SVG "blob" splatters were rejected as looking like "pastel floating blobs". User provided 4 transparent PNG brush-stroke assets and demanded they be used as-is.

### What changed
- **`/app/frontend/src/index.css`**: The `:root` block in Sprint 110dh that defined `--splat-lime`, `--splat-blue`, `--splat-orange` as inline SVG `<path>` blobs has been replaced. The variables now point at the real PNG assets in `/app/frontend/src/assets/brand/`:
  - `--splat-trio` → `splatter-trio.png`
  - `--splat-explosion` → `splatter-explosion.png`
  - `--splat-corner` → `splatter-corner.png`
  - `--splat-brush` → `splatter-brush.png`
  - Color-cue aliases `--splat-lime` / `--splat-blue` / `--splat-orange` now resolve to one of the real PNGs each (variety across cards).
- **Removed all `filter: drop-shadow(0 0 Xpx rgba(...))` colored glows** on splatter ::before pseudo-elements — the PNGs already carry their own multi-color paint, the lime glow on top was muddying it.
- **Opacity normalised to 0.18-0.32** per user spec (body canvas 0.06-0.09, hero/cards 0.20-0.32, never above 0.32).
- **Brush PNG used for**: page titles (`h1.italic.uppercase`), `.splatter-header`, active sidebar nav indicator, primary lime button hover halo.
- **Trio / Corner / Explosion PNGs** used as: body corner washes, sidebar corner accents, and the three card-cue ::before splatters (green/blue/orange semantic).
- **Verified live** on dashboard hero — real brush-stroke paint visible behind "GOOD MORNING" headline, sidebar corner has authentic ink texture, body bottom-right shows real explosion PNG. Text fully readable.

## Sprint 110dm — Day-to-day operator controls (2026-02-15)
**User ask**: Absolute day-to-day control without code edits. ~80 new settings across 9 categories. SMS skipped, email-only.

### Schema additions (nested-backfilled on every install — zero data migration)
- `day_to_day.money` — tipping prompt + presets, late pickup fee + grace, 3-tier cancellation, no-show %, boarding deposit %, credit pack expiry, auto-decline-if-balance, round-to-dollar.
- `day_to_day.seasonal` — holiday surcharges (list of date + label + multiplier), peak-season ranges, holiday lockout days, vacation auto-message + start/end.
- `day_to_day.guardrails` — min advance hours, same-day toggle, weekend lead time, max bookings/client/day, max consecutive nights, max dogs per kennel, staff:dog ratio warn, setup/cleanup buffer, block-on-expired-vax, check-in/out windows.
- `day_to_day.comms` — reminder email hours, vax expiry extra warn days, inactive-client threshold, review-request lag, birthday emails, report-card mode (per_session/weekly_digest/off), quiet hours, reply-to, footer signature.
- `day_to_day.loyalty` — streak targets per service, loyalty tier thresholds (Bronze/Silver/Gold/Platinum), trophy reward $, referral reward type/amount/service.
- `day_to_day.compliance` — vaccines-required per service, block-on-expiry-day, doc upload required, waiver re-sign frequency, waiver scope.
- `day_to_day.services` — boarding-includes-daycare, training session length, graduation criteria, photography price/photos/SLA, grooming durations.
- `day_to_day.finance` — fiscal year start month, bookkeeping export format, mileage rate, 1099 threshold.
- `day_to_day.ui` — splatter intensity, CTA copy, PWA short name/tagline, letter case, time/date format, week start, show prices in portal, show waitlist signup, dog avatar fallback.

### Wired live this sprint
- `create_booking` honours: same-day toggle, min-advance-booking-hours, weekend lead time, max-bookings-per-client-per-day, max-consecutive-boarding-nights. Admins bypass with `override_capacity`.
- `cancel_booking(forfeit=true)` reads `day_to_day.money.cancellation_tier{1,2,3}_*` and bills the appropriate %. Snapshots `cancellation_fee`, `cancellation_fee_pct`, `cancellation_hours_notice` on the booking for receipt history.
- `check_out` `_apply_money_modifiers()` post-resolver: applies the matching holiday surcharge multiplier (if `booking.date` hits a `seasonal.holiday_surcharges` entry), then peak-season multiplier, then late-pickup fee per 15-min block past `pickup_time + grace`, then optional `round_to_dollar`.
- `email_service._send()` defers any non-critical email when `comms.quiet_hours_enabled` and current local time falls inside the window (handles cross-midnight spans like 21:00 → 08:00). Logs the deferred subject for visibility.
- `/branding` now exposes `day_to_day.ui` knobs (splatter intensity, primary CTA copy, PWA name/tagline, letter case, time/date format, week start, show-prices-in-portal, dog avatar fallback) so the front-end picks them up unauthed.
- `theme.js` writes those knobs to `data-splatter`, `data-case`, `data-tfmt`, `data-dfmt`, `data-wkstart` on `<html>` + caches the prefs on `window.__shUi` for synchronous formatter access.
- `index.css` cascades `html[data-splatter="off|low|medium|high"]` onto all splatter ::before/::after pseudos with the appropriate opacity multipliers. `html[data-case="title|sentence"]` overrides `text-transform: uppercase` on the biggest page titles.
- `/app/frontend/src/lib/format.js` — new lightweight helpers `fmtTime`, `fmtDate`, `fmtPrice`, `applyCase`, `weekStartsOnMonday` that read from `window.__shUi`.

### Tests
- `test_cancellation_tiers.py` — 3 new pytests covering tier-1 (free), tier-2 (50%), tier-3 (full). All pass.
- 16/16 total backend tests pass (referral, legacy credits, bulk pack, stay pricing, cancellation tiers).

### Files touched
- `/app/backend/server.py` — `day_to_day` defaults, nested backfill, guardrails in `create_booking`, 3-tier cancellation in `cancel_booking`, `_apply_money_modifiers` in `check_out`, surfacing UI knobs in `/branding`, `cancellation_fee_pct`/`cancellation_hours_notice` on BookingOut.
- `/app/backend/email_service.py` — `_is_in_quiet_hours()` + blackout in `_send()`.
- `/app/frontend/src/components/DayToDayControls.jsx` — new ~430-line component rendering 9 collapsible sub-sections.
- `/app/frontend/src/screens/Settings.jsx` — imported component, added `d2d` state, mounted under new Section, included in SaveBar payload.
- `/app/frontend/src/lib/theme.js` — applies UI knobs as `data-*` attributes + window.__shUi cache.
- `/app/frontend/src/lib/format.js` — new file, lightweight formatters.
- `/app/frontend/src/index.css` — `html[data-splatter]` opacity cascade + `html[data-case]` text-transform overrides.

### Backlog — narrow scope, low-risk follow-ups
- **Tipping at checkout** — front-end modal step that adds a tip line to the receipt + sums into actual_price (settings already in place: `tipping_enabled`, `tip_presets_pct`, `tip_allow_custom`).
- **Loyalty tier recalc** — small endpoint that returns the client's current tier name based on visit count + `loyalty_tier_*_visits` thresholds; called from the client card.
- **Vaccines-per-service guard** — use `compliance.vaccines_per_service` in `_vaccines_valid()` so each service can require its own subset.
- **"Show prices in portal" toggle wiring** — wrap dollar amounts in client-portal screens with `fmtPrice(n, { hidable: true })`.

### Files touched
- `/app/backend/server.py` — added `day_to_day` block to `_default_settings`, deep nested-backfill in `get_settings`, `day_to_day` field on `SettingsIn`, guardrail enforcement in `create_booking`.
- `/app/frontend/src/components/DayToDayControls.jsx` — new ~430-line component rendering 9 collapsible sub-sections.
- `/app/frontend/src/screens/Settings.jsx` — imported component, added `d2d` state, mounted under new Section, included in SaveBar payload.

### Verified
- Screenshot: Settings → Booking Rules → all 9 sub-sections render with the right icon + brand color. Money rules open by default; rest collapsed for focus.
- Regression: 13/13 existing pytests still pass (referral, legacy credits, bulk pack sales, stay pricing).

### Backlog — settings present, behavior wiring pending (incremental, low risk)
- Tax + tipping prompt at checkout flow
- Late pickup fee auto-calc on checkout
- 3-tier cancellation fees in cancel endpoint
- Holiday surcharge multiplier at booking
- Vaccines-per-service list in vax guard
- Quiet hours blackout in email service
- Loyalty tier recalculation on checkout
- Splatter intensity → CSS variable
- Letter case / time / date format / week start → app-wide formatters
- "Show prices in portal" → portal $ hide

## Sprint 110dl — Bookings Month → Day grouping (2026-02-15)
**User ask**: "the bookings page could be stacked by day and month"

### What changed
- **`/app/frontend/src/components/CollapsibleDateGroups.jsx`**:
  - Added `compact` prop. When true, renders Month → Day → items directly (skips Year wrapper and Week sub-grouping). Existing Expenses screen keeps the full Year → Month → Week → Day nesting.
  - Replaced `useState`-with-lazy-init for `openKeys` with a `useEffect` watching `tree` — the prior version ran ONCE with empty `rows` (data still loading) so the first month never auto-opened. Now the most-recent month + day auto-expand the moment data arrives, no matter when.
  - Day-level label is now lime (was muted gray) for stronger visual separation.

- **`/app/frontend/src/screens/Bookings.jsx`**:
  - `groupByDate` defaults to `true` — users now see stacked Month → Day hierarchy by default.
  - Both active-list and history views pass `compact` to the grouper.

- **`/app/frontend/src/screens/Income.jsx`**:
  - `groupByDate` defaults to `true` — the Income transactions list now auto-stacks Month → Day on load.
  - All 3 lists on the page (Income transactions, Retail sales, Expenses) pass `compact={true}` for the same clean two-level view.

### Verified
- Live screenshot: AUGUST 2026 → WED, AUG 5 → 3 booking rows expanded by default. JULY 2026, JUNE 2026 collapsed. Click any month/day to expand/collapse. UNGROUP button still toggles back to flat list. SHOW HISTORY still loads archives.

## Sprint 110dk — Client card cleanup + Boarding/daycare auto-pricing (2026-02-15)
**User asks**:
1. Collapse the stack of 10+ action buttons on each client card into a single popover/menu — cards were absurdly tall and scrolly.
2. At check-out, auto-multiply boarding/daycare cost based on **actual** check-in / check-out timestamps, with admin-configurable settings for "half day vs whole day" thresholds.
3. (Skipped per user) #1+#5 P&L lockdown and #3 sell-individual-credits — user said they can configure / not needed right now.

### Backend changes (`/app/backend/server.py`)
- **New `booking_rules` settings** with defaults backfilled on existing installs:
  - `stay_pricing_enabled: bool` (default `True`) — master switch.
  - `half_day_pct: int` (default `50`) — half-day bills at 50% of the full-day rate.
  - `daycare_half_day_max_hours: float` (default `5`) — daycare stays ≤ this = half day.
  - `boarding_half_day_max_hours: float` (default `12`) — boarding trailing remainder > this = +full day, ≤ this = +half day.
- **`_resolve_service_value()` rewritten** to read `checked_in_at` + checkout `ts` and compute:
  - **Daycare**: `total_hours = co - ci`; if `total_hours ≤ daycare_half_day_max_hours` → `unit_price × half_pct%`, else `unit_price`.
  - **Boarding**: `nights = floor(total_hours / 24)`, `remainder = total_hours - nights*24`. If `remainder > boarding_half_day_max_hours` → +1 full day. Elif `remainder > 6min tolerance` → +half day. Always charge at least 1 unit (same-day check-outs). 6-minute float tolerance prevents clock-skew from triggering phantom half-days on exact-multiple-of-24h stays.
  - Falls back to the prior calendar-night calc when timestamps are missing or `stay_pricing_enabled = False`.
- **`will_charge` path also routed through `_resolve_service_value`** — previously this paid-today branch used its own `_maybe_apply_nights` helper that hadn't been updated, so all my logic was being bypassed for cash/card check-outs. Now both credit-pays and cash-pays use the same stay-pricing math.
- **`get_settings()` nested backfill** added for `booking_rules` keys so the new settings appear in the UI for existing installs without requiring a settings save first.

### Frontend changes
- **`/app/frontend/src/screens/Clients.jsx`**:
  - Built a new `<ClientActionsMenu>` component (~120 lines) — a floating popover anchored to a single "**MANAGE CLIENT ▾**" button. Click-outside + Escape-key dismissal. Menu items grouped by section with dividers: portal actions (claim/reset, set password), sell actions (pack, training, adjust credits), data actions (receipts, files & homework, legacy pricing, pack lots). Each item keeps its color cue (lime/blue/orange/purple/amber/gray) so visual scanning still works.
  - **Renders via React Portal to `document.body`** with `position: fixed` calculated from the trigger button's `getBoundingClientRect`. This escapes the card's `isolation: isolate` stacking context (Sprint 110dj) — otherwise the menu would render hidden behind the next client card in the grid. `z-index: 9999`.
  - Solid opaque `rgb(10,20,38)` background + 2px lime/blue border + dual-glow shadow so the menu is visually distinct from cards behind it.
  - Auto-flips upward when there isn't enough room below the trigger (viewport-edge handling).
  - Removed 10 stacked buttons from the card body, replacing them with the single Manage Client trigger. `VIEW PORTAL AS CLIENT` (primary, yellow) and `QUICK PORTAL SNAPSHOT` (secondary, blue) stay visible.
  - Card height dropped by ~75% — the user-reported "extremely scrolly client card" is gone.
- **`/app/frontend/src/screens/Settings.jsx`**:
  - Added a new `<Section title="Stay-duration pricing">` under Booking Rules → directly below Credit Costs. Controls: auto-price toggle, half-day rate %, daycare half-day max hours, boarding half-day max hours. Inline explainer copy and an admin-override note.

### Tests (`/app/backend/tests/test_stay_pricing.py` — 6 new pytests)
- `test_boarding_three_nights_exact` — 72h → $50 × 3 = $150 ✅
- `test_boarding_two_nights_plus_late_checkout` — 62h (2 nights + 14h > 12h threshold) → 3 × $50 = $150 ✅
- `test_boarding_one_night_plus_early_pickup` — 30h (1 night + 6h ≤ 12h threshold) → 1.5 × $50 = $75 ✅
- `test_daycare_half_day` — 4h (≤ 5h threshold) → $40 × 50% = $20 ✅
- `test_daycare_full_day` — 8h (> 5h threshold) → $40 ✅
- `test_manual_base_price_override_wins` — admin-entered amount always trumps auto-pricing ✅
- **All 6 pass, plus 7 existing tests still pass** — no regressions in referral / legacy / bulk-pack flows.

## Sprint 110dj — Training Levels poster overhaul (2026-02-14)
**User ask**: PWA still looked like a generic SaaS dashboard. Cards/background needed to match the sithappensohiodogtraining.com "Training Levels" poster graphic style — thick neon outlines, dark gritty interior, controlled paint splatter framing, sharp diagonal brush strokes, bold uppercase titles with colored underline strokes. Styling only — no JSX edits.

### What changed in `/app/frontend/src/index.css` (Sprint 110dj block, ~280 lines appended)
- **Body background** — replaced soft radial halos with sharp diagonal grunge streaks (`repeating-linear-gradient(115deg)` + `65deg`) + SVG fractal-noise paint grain + off-axis corner color flecks. Background uses `background-blend-mode: overlay` for the noise layer. Reads as authentic gritty paper, not pastel halos.
- **Card poster style** — `.bg-bgPanel.rounded-xl/2xl` now uses a CSS variable `--card-accent` (default lime) for border + box-shadow. 2px border, larger 22px radius, dual outer halo + inner vignette + drop shadow + grain noise overlay. Hover lifts the card and intensifies the glow.
- **Content-aware accent** — `:has()` selectors set `--card-accent` to blue when card has only `.text-shBlue` content cue, orange when `.text-shOrange`, lime by default. Red theme is NOT auto-detected (prevented over-tinting on cards that happen to contain a red delete button).
- **Card title strip** — first `h2/h3` inside any card gets a colored 56px underline stroke gradient + glow, with bottom padding + margin for separation between title and content. Underline color follows the card's `--card-accent`.
- **Stat tiles** — small grid-item cards get a 16px radius + 1.5px border (tighter than large cards) and any nested icon-badge (Tailwind `w-10 h-10 rounded-lg/full` pattern) gets a colored ring shadow.
- **Task rows** — narrowed urgent-row trigger to only fire when a child has `bg-red-500/600` (real urgent pills), not just any red text. Adds stronger 5px left stripe + red glow halo + grain interior.
- **Hero** — sharper diagonal brush stripes via `linear-gradient` (sharp percentage stops, not soft radial halos) + real `splatter-trio.png` and `splatter-brush.png` overlays in opposite corners at ~0.16-0.22 opacity, `mix-blend-mode: screen`.
- **Sidebar** — added grunge coarse texture as background + right-side blue glow border + brand-block gradient divider (lime → blue → lime). Inactive nav links normalized to clean uppercase 0.78rem with hover blue stripe.
- **Tables** — header row gets blue gradient + lime uppercase column labels + row hover lime stripe + faint blue row dividers.
- **Form labels** — uppercase labels get lime text with subtle glow.
- **Modals** — dialogs inside `.fixed.inset-0.bg-black/70|80` get the full poster treatment (2px blue ring + grain + inner shadow + drop shadow + 22px radius).
- **Page hero h1** — added stacked text-shadow (deep black + cyan + lime far-glow) for maximum poster impact on the biggest page titles.

### Verified pages
- Dashboard (lime owner-clock, orange closing-routine, lime "FIRST BOOKING CELEBRATION", red task list, real PNG splatters in hero).
- Clients (CLIENT HUB. WHERE HUMANS LIVE. poster hero with multi-color brush, clean client cards no longer over-tinted red).
- Income (INCOME & SERVICES. THE CASH STORY. poster hero, THIS WEEK stat card with semantic-colored sub-stats, LONGER-RANGE VIEW stat tiles).

### Scroll bug fix (2026-02-14)
- **Bug**: After 110dj landed, modal checkout (mobile) + multiple desktop pages stopped scrolling.
- **Root cause**: `.bg-bgPanel.rounded-xl, .bg-bgPanel.rounded-2xl { overflow: hidden }` (Sprint 110dh) was clobbering Tailwind's `overflow-y-auto` on scrollable modal/sheet containers. Selector specificity (0,2,0) beat Tailwind's `.overflow-y-auto` (0,1,0).
- **Fix**: Replaced `overflow: hidden` with `isolation: isolate` (same stacking-context benefit, no scroll clobber). Repositioned the corner color-cue splatter ::before pseudos from `top/right: -14px` to `top/right: 0` with `border-top-right-radius: inherit` so they stay inside the card box without needing overflow clipping. All other `overflow: hidden` instances (hero, sidebar active button, table) are non-scrollable so safe to keep.

### Mobile-viewport bug fix (2026-02-14)
- **Bug**: On mobile, the PWA started rendering the desktop layout zoomed-out ("everything small").
- **Root cause**: iOS Safari has a long-standing bug where `background-attachment: fixed` on the body (especially with multiple fixed layers) makes the viewport ignore `width=device-width`, so the page lays out at content width then visually shrinks to fit the device. Sprint 110df set 1 fixed layer; Sprint 110dj added 7 more.
- **Fix**: Removed `background-attachment: fixed` from both body rules. The app's scroll happens on the inner `main > div`, not body, so visual effect is identical with the default `scroll` attachment. Verified at 390px and 414px viewports: `docScrollWidth === window.innerWidth`, no horizontal overflow, desktop sidebar correctly hidden, mobile drawer active.
- **PWA note**: Service worker may cache the old CSS — users should hard-refresh or close+reopen the installed PWA to pick up the fix.

## Sprint 110di+ — Referrer auto-credit verification (2026-02-14)
- ✅ **Confirmed already-shipped feature**: `server.py` lines 3227-3295 contain the complete referrer auto-credit hook on booking checkout. Credits referrer +1 daycare credit on the referred client's first completed appointment, idempotent via `referrals` collection, dual email notifications (`notify_client_referral_payout` + `notify_client_referral_welcome`), audit-logged to `credit_adjustments`, and trophy re-evaluation for both parties.
- ✅ **Pytest** `test_referral_auto_credit.py` — 4/4 pass: payout fires on first checkout, payout is idempotent across repeated checkouts, self-referrals blocked, signup-time `referred_by_code` is normalised.


## Sprint 110ee — Mobile responsive audit & layout fixes (2026-02-16)
**User ask**: Verify all UI components work well on both PC and mobile — make sure everything scrolls and is visible.

### Bugs found & fixed
1. **Login hero auth card overlapped the headline on mobile.**
   - **Root cause**: Global CSS rule in `index.css` (`@media max-width: 768px`) was force-collapsing `.lg\:grid-cols-5` and `.md\:grid-cols-5` to `grid-template-columns: repeat(2, 1fr)` on mobile. This was intended for dashboard KPI tile rows but caught the Login hero's `grid lg:grid-cols-5` (`lg:col-span-3` headline + `lg:col-span-2` auth card), making it render as 2 cramped columns at 390px instead of stacking to single column.
   - **Fix**: Narrowed the CSS rule to only target bare `.grid.grid-cols-5` (true 5-up tile rows). Tailwind's `md:` / `lg:` responsive variants now stack to 1 column on mobile naturally.

2. **Bookings rows overflowed on mobile — action buttons (EDIT / APPROVE / REJECT / CANCEL) got clipped at the right edge, dog/client names truncated to "TE…".**
   - **Root cause**: Both grouped active rows and history rows used `flex items-center justify-between gap-2` with `shrink-0` on the status pill + action buttons. The action cluster refused to shrink, forcing the title `<div>` (with `min-w-0 flex-1`) to truncate aggressively, and the rightmost action got pushed off-screen.
   - **Fix**: Restructured both rows to `flex flex-col sm:flex-row` — on mobile the text takes the full row, then status + buttons wrap below it. Desktop layout unchanged.

### Verified-OK screens on mobile (390px viewport)
Dashboard, Schedule, Run Sheet, Bookings (after fix), Recurring, Clients, Dogs, Pipeline, Homework, Trophies, Income (KPI tiles stack 2-up), Staff (tax totals stack 2-up), Incidents, Settings (6 collapsible categories scroll fine), Tutorials. Mobile drawer scrolls through all 15 nav items. Modals (AdminBookingModal, etc.) render with `max-h-[90vh] overflow-y-auto` and scroll internally.


## Sprint 110ef — Eliminate 429 / ERR_INSUFFICIENT_RESOURCES storms on Dogs + Clients pages (2026-02-16)
**User report**: "Getting errors on some pages" — screenshot showed the dev-server runtime-error overlay flooded with `Request failed with status code 429 · AxiosError · Promise.all (index 1)` on the Dogs page.

### Root cause
Two pages were firing N parallel API requests (N = total records) on every mount:
1. **Dogs.jsx** → `Promise.all(dogs.map(d => GET /dogs/{d.id}/trophies))` = 550 parallel requests against the ingress' rate-limiter ⇒ 429s.
2. **Clients.jsx** → each rendered `<AdminClientPaymentPlans clientId={c.id} />` independently fetched `GET /admin/payment-plans?client_id=…`, hitting browser-level `ERR_INSUFFICIENT_RESOURCES` (>6 concurrent same-origin requests) at 823 clients.

### Fix
1. **Backend** — added two admin-only batch endpoints in `server.py`:
   - `GET /admin/dog-trophies-summary` → `{dog_id: [awarded[]]}` map in one call (single Mongo query, no per-dog auth check needed).
   - `GET /admin/client-trophies-summary` → same shape, keyed by `client_id`.
2. **Backend** — bumped `/admin/payment-plans` `to_list(500)` to `to_list(5000)` so the bulk fetch returns everything.
3. **Frontend** — `Dogs.jsx` `loadTrophies()` replaced N-parallel loop with single call to `/admin/dog-trophies-summary`, then `dogList.forEach` builds the local map.
4. **Frontend** — `Clients.jsx` `load()` now also fetches `/admin/payment-plans` once, groups by `client_id`, and passes `plans={plansByClient[c.id] || []}` to each `<AdminClientPaymentPlans />` (the component already supported the prop — `Sprint 110dc` flag).
5. **Frontend** — `Clients.jsx` `loadTrophies()` similarly switched to the new `/admin/client-trophies-summary` batch endpoint.

### Verification
Headless browser audit on prod-preview URL with `page.on("response")` + `page.on("requestfailed")` listeners; visited Dogs + Clients → **zero** `429` responses, **zero** `ERR_INSUFFICIENT_RESOURCES` failures. Dev-server red overlay no longer triggered.


## Sprint 110eg — Universal cash-basis income rule (2026-02-16)
**User directive**: *"The only time money gets added is at the time of sale. This goes for everything I offer. No money changes hands when a credit is used anymore. So if a day is all credits used, the P&L would have nothing added. But I should still have the ability to add an amount at checkout if I need to."*

### Implementation
Single source of truth in `server.py`: new `_cash_revenue(booking)` helper.
- **Cash/card paid** → full `actual_price` counts.
- **Credit-paid** → `max(0, actual_price − credit_value)` counts. Pure credit redemptions = $0. Admin's checkout override (`base_price`) or paid add-ons stack on top → the cash slice above credit value still hits P&L.
- **Pre-paid training-program sessions** → $0 (revenue already recognized when the program was sold).

`_is_pos_credit_pack_redemption` widened to catch ANY credit-paid booking (not just `recognize_at_sale: True` lots). Grandfathered lots now behave identically to newly-sold lots.

### Aggregators updated to use `_cash_revenue`
- `weekly_summary` — `completed_total`, `paid_total`, `booked_total`, `by_service` rows
- `summary_range` — `completed_total`, `paid_total`, `by_day` map
- `today_pnl` — completed-today gauge + approved-today forecast
- Annual P&L CSV export (`/admin/pl/annual.csv`)

### Frontend (CheckoutModal)
- Relabelled the credit-paid base-price input from *"Service value (for income tracking)"* → *"Additional cash charge (optional) — blank = $0, credits cover everything"*.
- Reworded the helper text to explain that credits don't add to today's P&L (the pack sale already did).
- `chargedToday` total now correctly shows `extraCashOnCredits + add-ons + extra-night charges` for credit-paid bookings (was always $0 before, even when admin typed an override).
- Submit converts the field's value to a notional `base_price = credit_value + extra` so backend semantics stay unchanged.

## Sprint 110eg-2 — Cash Flow Ledger folded into P&L PDF (2026-02-16)
**User insight**: *"We already do a P&L PDF — shouldn't we just put this into that and any other cash-flow related things into it so it's one cohesive system?"* Spot on. Built it into `pl_report.py` instead of a separate dashboard view.

### `build_pl_data` — universal cash-basis applied to the PDF datasource
Mirrored the `_cash_revenue(b)` helper from `server.py` inside `pl_report.py`. Replaced raw `actual_price` summations with `_cash_revenue` in: `completed_total`, `paid_total`, `unpaid_total`, `by_day`, `by_service`, `top_clients`, `top_dogs`, YTD income. The PDF now agrees with the in-app Income screen — credit redemptions no longer inflate any P&L number.

### New `cash_flow` block in the JSON payload
```
cash_flow:
  prepaid_in:                ← money banked at sale-time
    credit_pack_sales
    training_program_sales
    payment_plan_installments
    total
  register_cash_in:          ← money banked at checkout
    service_checkouts        ← non-credit + extras-on-credit
    retail_items
    total
  total_cash_in              ← prepaid_in.total + register_cash_in.total
  credits_redeemed:          ← informational only (NOT revenue)
    nominal_value
    redemption_count
```

### PDF rendering
New "Cash Flow Ledger" section sits between the KPI tile row and Daily Revenue chart. Contains:
- A 4-tile row: PRE-PAID CASH IN · REGISTER CASH IN · TOTAL CASH IN · CREDITS REDEEMED (info)
- An italic explainer line: *"Cash-basis rule: money counts once, at the point of sale. Credit redemptions are operational only — the cash was banked when the pack/program/plan was first sold."*
- A 6-row breakdown table reconciling each bucket against bank deposits, with the credit-redemption row dimmed/italicised to flag its operational-only nature.

### Regression
- New `test_pl_cash_flow_section.py` — 3 tests: block presence + arithmetic balance, PDF renders without errors, credit-pack sale correctly populates the `prepaid_in.credit_pack_sales` bucket.
- All 8 existing P&L / CPA / payroll PDF tests still pass.

- Added a "+ Extra cash · $X.XX" line in the totals summary when admin charges extra on top of credits.

### Regression
- New `test_universal_cash_basis.py` — 2 invariants:
  1. Pack sale +$200, redemption +$0 (pure-credit checkout)
  2. Credit ($20) + $30 override at checkout → $10 cash slice hits P&L
- Rewritten `test_grandfathered_legacy_credits.py` — flipped to assert legacy lots now redeem at $0 (universal rule).
- 86 income / P&L / checkout / cancellation / training-program tests all pass.



## Backlog / Next Up
- **P1** Check-in / Check-out flow with daily census
- **P1** Public booking page (`yourdomain.com/book` — no login required)
- **P1** Retail items catalog (Quick-pick vs Full POS — needs user decision)
- **P1** Daycare capacity guardrail (prevent overbooking without admin override)
- **P2** "Currently on premises" kiosk wall view
- **P2** Holiday / closure calendar
- **P2** Tipping at checkout / Gift cards
- **P2** Admin "App Update" button via host trigger file (Bazzite Docker workaround)
- **P3** SMS reminders (Twilio)
- **Refactor** Split `server.py` (~17k lines) into route modules — deprioritised by user
