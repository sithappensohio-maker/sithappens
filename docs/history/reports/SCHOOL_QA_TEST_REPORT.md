# Online School Full Build — QA / Bug-Fix Report

**Date:** 2026-08-09 · **Branch:** `school-full-build` (baseline `b859c6e` + full-build overlay `0a49db4` + fix commits `5ef7315`, `5d76cc2`)
**Role:** tester / bug-fixer only. No architecture was redesigned; every fix is inside the existing systems.

---

## 1. Automated results

### Backend

| Run | Command | Result |
|---|---|---|
| Full suite (first pass, for classification) | `backend$ .venv_local_test\Scripts\python.exe -m pytest -q` | 677 passed, 214 failed, 1041 errors, 10 skipped (20m39s) — see classification below |
| In-process suite (all 38 `backend/test_*.py` files: every School/native suite + POS ad-hoc) | `pytest test_*.py -q` (disposable DB `sit_happens_test_disposable`) | **570 passed, 0 failed** (final run, after fixes) |
| Release-critical gate (repo's documented trust gate) | `tests/run_release_critical.py` against dedicated server on :8011, fresh DB `sit_happens_test_release_critical` | **All 16 files passed clean** (incl. permissions, shop checkout ×74, POS register ×31, inventory, config backup, data export) |

**Classification of the full-suite failures:** the 1041 errors + ~200 of the failures are the *legacy `tests/` suite* run against conditions it was never designed for. `RELEASE_CHECKLIST.md` itself documents this: those ~150 files hardcode `admin@sithappens.com / admin123` and assume a long-lived pre-seeded dev database; run against the real local dev DB they fail at login (401 → rate-limit 429 cascade). This is **pre-existing, documented technical debt**, not something the Full School build introduced — the checklist's answer is the curated release-critical gate, which passes 100%.

**Genuine defects / stale assertions found in the automated phase (all fixed, all suites re-run green):**

1. **Genuine defect — `upload_day_video` BSON overflow window** ([server.py](backend/server.py)): the build raised `CHECKPOINT_VIDEO_MAX_BYTES` 10 MB → 100 MB for filesystem-backed School media, but generic (non-School) daily-tracker videos share that constant *and still embed base64 in a single Mongo document* (16 MB BSON cap). A 12–100 MB generic upload would pass validation then crash with an unhandled 500. Fixed with `GENERIC_DAY_VIDEO_MAX_BYTES = 10 MB` applied only to the legacy Mongo path; School homework keeps the 100 MB filesystem ceiling.
2. **Genuine defect (in the build's own new test) — `test_school_phase2c` remediation test** logged sections `remediation-1/2` that don't exist in any template (the endpoint validates section ids); the gate counts post-grade logs of the real `practice` section. Test corrected to encode the intended behavior; endpoint behavior itself was correct and separately verified live.
3. **Stale fixtures — `test_school_events_phase1`** (5 tests): fixtures marked homework as School via `source_lesson_id` alone, which the build *deliberately* no longer accepts (product invariant: trainer-led homework must not count as School practice). Fixtures now carry the explicit `assigned_by: "Online School"` ownership marker.
4. **Stale assertion — `test_online_school_checkpoints` oversized-video test** hardcoded 11 MB as "oversized"; now derives from the configured ceiling. (Also removed the now-absurd "~10-15 seconds" copy from the 100 MB error message.)
5. **Stale assertion — `tests/test_config_backup.py`**: the build intentionally adds `school_settings` to config backups; the expected-collections set was updated.

### Frontend

| Run | Command | Result |
|---|---|---|
| Jest (first pass) | `frontend$ CI=true npx craco test --watchAll=false` | 430 passed, **16 failed** (6 suites) |
| Jest (final, after fixes) | same | **446 passed / 446, 27 suites, 0 failures** |
| Production build | `npx craco build` | **Success** (exit 0; pre-existing bundle-size warning only) |

Of the 16 failures, **14 already failed on the pre-build baseline** (verified by running the same suites in a `b859c6e` worktree): source-regex guards still pointed at the dormant legacy `OnlineSchoolDashboard.jsx` after Phase 2B+ moved the runtime to the native School screens, plus cosmetic markup drift ("Practice Timer *(optional)*" gained a `<span>`, "Retry" became a JSX fragment, ProgramStudio label renamed to "Online School" per the branding invariant). All were retargeted to the canonical native sources (mainly `school/student/CheckpointPanel.jsx`) — every behavioral marker they guard exists verbatim there. The 2 new-with-this-build failures were also stale assertions: `onChanged?.()` still fires after practice save (the new `onPracticeLogged?.()` merely sits between the two lines the regex required adjacent), and checkpoint playback intentionally moved to the authenticated School media blob path (now asserted as such).

---

## 2. Runtime defects found in browser/API QA (all fixed and re-verified)

1. **School Analytics 500** — `GET /admin/school/analytics` crashed with `TypeError: can't compare offset-naive and offset-aware datetimes` on real data (legacy rows store naive timestamps). Fixed in [school_suite.py](backend/school_suite.py): `_parse_iso` normalizes naive values to UTC. Analytics now returns and every number reconciles with seeded reality (4 graded checkpoints = 2 advance / 1 remediation / 1 assist → 50% first-pass; 1 completion at 0.6 days; correct per-trainer workload).
2. **Wrong client silently preselected in Trainer Assist scheduling** — `AdminBookingModal` loads `/clients` + `/dogs`, which cap at 1000 rows; a preset client/dog outside that window made the controlled select silently drift to the *first client in the list* ("Ann …") while the dog stayed correct — a booking could land on the wrong account. Fixed: presets/existing ids not present in the capped lists are fetched by id and injected. Re-verified: modal now preselects "QA_SCHOOL Family".
3. **Expired/paused course shown as "active" in the course switcher** — `GET /portal/school` used the raw stored `access_state` while Home/detail use `_effective_school_access_state` (the helper's own docstring forbids exactly this drift). Fixed; list now reports `expired`/`paused` consistently. (Write-gating itself was already correct: expired access → Home shows the dedicated `access_expired` state, `start-practice` 403s.)
4. **Notification bell stale on open** — `SchoolNotificationBell` fetched on mount + 45 s poll only, so opening it minutes after an event could show "No School notifications yet." Fixed: refetch on open.
5. **`/portal/school/null/*` 404 noise on deep-link loads** — Progress/Feedback/Resources/Search screens fired fetches before the enrollment id resolved. Fixed with enrollment-id guards; deep-link loads are now clean.

---

## 3. Browser QA

Screenshots could not be captured in this session (the Browser pane was not displayed, so pages never composited frames); every check below was performed against the live dev servers via DOM structure, rendered text, element geometry (`scrollWidth` vs `clientWidth`), network traces, and console logs.

### Breakpoints (Student School: Home, My Course, Today, Progress, Feedback, Library)

| Breakpoint | Body horizontal overflow | Notes |
|---|---|---|
| 1440×900 | none on any screen | |
| 375×812 (mobile emulation) | none | Touch targets: `VIEW SCORING DETAILS` / `ASK ABOUT THIS REVIEW` text-links on Feedback are 16 px tall (cosmetic, below the 44 px guideline) |
| 320×568 | none | |

Route deep-links (`/school/progress`), refresh, and back/forward all restore the correct screen. Console: no runtime errors from School code (the only entries were my own injected probe, an expected 409 capacity conflict, and the null-id 404s that are now fixed).

### End-to-end Student School workflows — all verified live

- **A Fresh enrollment**: correct dog/course; fresh `current_action` is Learn ("Learn QA Lesson 1.1 before you practice"), never Practice; zero generic Homework branding anywhere in School.
- **B Multiple dogs** (one client, four dogs): course/lesson/scores/plans never crossed between Aspen (completed), Birch (fresh), Cedar (no-practice program), Dill (BlockLab). **Critical notification test passed**: with Aspen selected, clicking Birch's `training_plan_assigned` notification switched the UI to Birch's enrollment *before* opening Today with the plan.
- **C Learn → Practice**: opening the lesson does **not** complete Learn (backend `learn_completed: false` verified); START PRACTICE explicitly flips it; Practice Coach opens in School context (guided flow, reps, troubleshooting); **asking a trainer question mid-practice did not close the coach or show "Practice complete"** (toast "Question sent to your trainer", panel stayed); completion returned to School with the backend-derived next action (`advance` → 25% course_pct after lesson 1).
- **D No-practice lesson**: native "Complete lesson" action; **zero homework rows created for the dog**; only an explicit `lesson_learn_completed` event; advance appeared only from the backend.
- **E Checkpoint**: upload via the real file input (500 KB mp4) succeeded; duplicate pending submission blocked ("A checkpoint for this lesson is already awaiting review."); student saw *Awaiting trainer review*; School HQ badge incremented (2 = question + checkpoint) and the pending queue carried the exact note/video.
- **F Grading consistency**: graded 3/4 handler, 2/3 dog in the HQ rubric UI → Home, Feedback, and Progress all showed **identical 3.5/5 Handler Skills and 2.5/5 Dog Performance**; outcome framing came from the backend (`prescribe_practice` → "More practice prescribed", never "failed"); deterministic handler-vs-dog explanation only where data supports it.
- **G Timestamped video review**: review video loaded through the authenticated `/portal/school/media/{id}/file` blob path (blob: URL in the `<video>`, no base64 JSON); a 0:00 annotation was added, persisted server-side, and surfaced to the student under "Trainer video notes".
- **H Remediation**: Home/Today prioritized remediation with live remaining-count; "Complete remediation" opened **exactly** `prescription.tracked_homework_id` (network-verified); after the 2 required sessions the action became *Resubmit your checkpoint* and a further remediation launch 409'd ("ready to resubmit") — no stale CTA.
- **I Trainer Assist**: assist grade → HQ Trainer Assist queue (exact case with rubric, video, client note); Mark Contacted → Schedule opened the **real AdminBookingModal** (existing booking system, add-ons/estimate/credit checks intact — including a genuine capacity 409 from the live calendar); booking linked (`scheduled`, real date); cancelling the booking produced `reschedule_needed` on **both** admin and client sides without clearing the hold; completion stored the client-facing summary, cleared the hold exactly once, and returned the student to real checkpoint resubmission — no auto-advance, no assist loop. Client-side copy is support-framed throughout.
- **J Completion**: exactly **100% course_pct**, no bogus current lesson; completion card with real counts (4 lessons / 2 modules / 2 checkpoints / 7 practice sessions), final assessment scores, skills covered, recommended-next affordances, and a working Print Certificate; all completed lessons remain reviewable.

### School HQ + Student Workspace

- Overview/Activity/Needs-Attention/Checkpoints/Trainer-Assist/Students/Interventions/Analytics/Resources/Settings all render with truthful counters.
- **Exact deep links**: "Review checkpoint" opened the exact submission (not the queue); the Trainer Assist case opened the exact record; trainer-request completion arrived in HQ attention with its record; the student question item carries Reply.
- Workspace: trainer assignment + reassignment persists (dropdown correctly restricted to `manage_school` staff), private notes, access +30/+90 days, pause/unpause, support allowances (null renders as ∞/as-needed, never `0`), baseline panel, permanent dog School history, per-enrollment checkpoints/events.
- **View as student**: owner/admin impersonation works end-to-end (read-only banner + Return to Admin); an employee **with** `manage_school` gets 403 from the impersonation endpoint with the friendly "owner/admin accounts only" toast path — no permission widening (admin 200 / manage_school-employee 403 verified directly).

### Multi-day plans (Section 5)

Create (2 tasks) → student completes task 1 → trainer edit: removing the completed task **422s** with a human message; editing keeps `completed_at`; uncompleted tasks are adjustable/removable; adding an optional task works; when all *required* tasks completed the plan auto-flipped to `completed` while the optional task stayed open.

### Trainer requests / media (Section 6)

Video request created in Workspace → student uploaded response video (filesystem-backed `school_request_media`) + note → status `submitted` → HQ attention event (`trainer_request_completed`) → admin resolve → client got `trainer_request_reviewed` notification.

### Course Builder 2.0 (Section 7)

- A course containing **all 16 block instances** (text, URL video, uploaded School-resource video, URL image, uploaded image, steps, trainer tip, warning, checklist, knowledge check with correct answer + explanation, reflection-only check, timer, rep counter, download, practice prompt, checkpoint prompt) was created and **every block rendered in the real enrolled Lesson**, in order, with uploaded video/image inline (blob URLs, not link buttons).
- Knowledge check: wrong → "Not quite — review this point and try again" + explanation; right → "That's it."; explicit copy that checks **never gate progression**, and Start-Practice remained available throughout.
- Validation verified at the API the Studio uses: media block with no source → `content_block_missing_source`; timer ≤0 → `timer_missing_duration`; rep target ≤0 → `rep_counter_missing_target`; quiz correct-answer-not-in-options → `knowledge_check_invalid_answer`; missing **or archived** linked School resource → `broken_school_resource_ref`, hard-blocked at **save** time (422), not just at validate.
- Studio's Client preview provably reuses the native `LessonContentBlocks` renderer (`ProgramPreviewPanel` imports it with `previewMode`; guarded by the passing Jest suite).

---

## 4. Security / data isolation (Sections 8–9) — explicit results

| Check | Result |
|---|---|
| Global resource visible to enrolled client; **not** fetchable by a client with no School enrollment (guessed UUID) | ✔ list yes / stranger **403** |
| Program-targeted + current-lesson + current-lesson-block-linked resources visible | ✔ |
| Future-locked-lesson resource: hidden from Library, absent from Search, media **403** for a single-enrollment client who hasn't reached it | ✔ (note: a client whose *other* dog legitimately completed that lesson may access it — the media scope is deliberately the union of the client's readable enrollments) |
| Search: locked future lesson text leaks | **0 hits** for future lesson content; reached lessons found; future-lesson resources absent |
| Search feedback scoped per enrollment/dog (Aspen's feedback via Birch's search) | **0 leaks**; dog switch re-fetches per enrollment |
| Archived resource disappears from Library + its media 403s + publish blocks if still linked | ✔ |
| Expired/revoked access: media / search / resources / training writes | all **403**; Home shows dedicated expired/paused states |
| Generic (non-School) Homework media UUID via School endpoint | **404**, even for admin — no back door |
| Employee without `manage_school` fetching School media | **403** |
| DB `storage_path` outside the School media root (`C:\Windows\win.ini` planted) | **404**, even for admin (root-containment + `is_file()` verified in code and live) |
| Two-dog isolation | verified across Home/Course/Today/Progress/Feedback/Library + notifications (Section B above) |

**Backup / disaster recovery (live round-trip):** `run-now` backup produced a verified School-media sidecar (262 files); Settings recovery listing shows it verified; download works; **restore succeeded** with a pre-restore snapshot taken first and media servable afterwards; traversal filename in the download URL 404s; crafted **traversal / absolute-path / symlink archives were all rejected 400** ("unsafe path or file type") with live media untouched. Rollback path additionally covered by `test_school_media_backup_safety.py` (in-process, green).

---

## 5. Prerequisites / pathways / commerce (Section 10)

- Authoring: missing prereq slug → 422 `broken_program_prerequisite`; self-reference → 422; cycle (Foundations→Intermediate→Advanced→Foundations) → 422 `circular_program_prerequisite`.
- Shop item detail returns **server-derived per-dog eligibility rows** (each dog listed with `eligible` + named missing prerequisites).
- **Client Shop checkout** of an `online_school` program for an unqualified dog → 422 `school_prerequisites_incomplete` **before any order/payment mutation**.
- **Staff/POS sale** (`sell-program`) for an unqualified dog → 422 `school_prerequisites_incomplete` before any credit-lot/revenue write (verified invoice count unchanged). Note: the gate applies to programs configured `purchase_fulfillment="online_school"` — a `credits_only` program sale intentionally doesn't create a School enrollment and is not gated.
- Trainer-led completed prerequisite satisfies the pathway (completed trainer-led Foundations flipped shop-detail eligibility).
- Enrollment snapshot freezing of prereq/support/onboarding data: covered by `test_school_prerequisites_and_snapshot.py` (in-process, green).

## 6. Analytics / interventions (Section 11)

Analytics numbers reconcile exactly against seeded data (see §2.1). Progress semantics verified: 0% fresh, 25% partial, exactly 100% complete; `mastered_pct` stays a separately-labelled Skill Mastery; single checkpoint score renders without a fabricated trend. Interventions: with `inactivity_days=5` a 10-day-inactive student was flagged ("No School activity for 10 days"); raising the threshold to 30 cleared it — flags follow settings, and nothing auto-punishes or auto-progresses.

## 7. Notifications + event reliability (Section 12)

- Staff policy: question / checkpoint / could-not-complete / review-required video / Trainer Assist create attention notifications with `email_status: queued` in the Mongo outbox; routine practice/lesson completions stay activity-feed-only (no staff notification rows). 
- **Dedupe/idempotency verified live**: emitting the same dedupe key 3× produced exactly 1 event. Retry/reconciliation (event-exists-but-notification-missing) is covered by the green `test_school_events_phase1` scenarios.
- Client notifications observed end-to-end: `trainer_reply` (Messages thread, correct dog + deep link), `checkpoint_reviewed` (per grade), `trainer_assist_scheduled`/`_completed`, `training_plan_assigned`, `trainer_request_video`/`_reviewed`; read state persists; multi-dog deep links switch enrollment first. (Practice-coach question answers surface in Feedback rather than the bell — thread replies are the bell path; this is the existing architecture, not a gap.)

## 8. Regression outside School (Section 14)

- Release-critical gate green (permissions matrix, shop checkout/management/catalog, POS register + inventory + till, credit lots, config backup, data export, backup snapshot).
- POS ad-hoc integrity files green (checkout atomicity, front-desk check-in, shop manager).
- Browser smoke: admin Today dashboard, Pipeline, Shop Manager, generic Homework screen (85 assignments listed, generic engine intact), client portal (Home/My Dogs/Book/Shop nav) — all load clean, no console errors, no "something went wrong" states.
- App startup: server boots clean with all critical indexes verified (uvicorn log), including the School unique indexes.

## 9. Code changes made during testing

Product code (5 defect fixes):
- [backend/server.py](backend/server.py) — `GENERIC_DAY_VIDEO_MAX_BYTES` for the legacy Mongo day-video path; removed stale "~10-15 s" copy; `portal_school_list` uses `_effective_school_access_state`.
- [backend/school_suite.py](backend/school_suite.py) — `_parse_iso` normalizes naive timestamps to UTC (analytics 500).
- [frontend/src/components/AdminBookingModal.jsx](frontend/src/components/AdminBookingModal.jsx) — fetch preset/existing client & dog by id when outside the capped list responses.
- [frontend/src/components/school/student/SchoolNotificationBell.jsx](frontend/src/components/school/student/SchoolNotificationBell.jsx) — refetch on open.
- [frontend/src/components/school/student/ProgressScreen.jsx](frontend/src/components/school/student/ProgressScreen.jsx), [FeedbackScreen.jsx](frontend/src/components/school/student/FeedbackScreen.jsx), [ResourcesScreen.jsx](frontend/src/components/school/student/ResourcesScreen.jsx), [SearchScreen.jsx](frontend/src/components/school/student/SearchScreen.jsx) — guard fetches until `enrollmentId` resolves.

Test-only changes (stale assertions/fixtures updated to the intended architecture — nothing deleted, nothing weakened):
- Jest: `onlineSchoolPhase3.test.js`, `onlineSchoolPhase4.test.js`, `checkpointEntryPoints.test.js`, `onlineSchoolEntryPoints.test.js`, `coachModeEntryPoints.test.js`, `portalPracticeEntryPoints.test.js`.
- Pytest: `test_school_events_phase1.py`, `test_school_phase2c.py`, `test_online_school_checkpoints.py`, `tests/test_config_backup.py`.
- `.gitignore` — exclude `backend/school_media/`, QA logs, `frontend/package-lock.json`, `_test_release_critical_backups/`.

## 10. Remaining issues

**Release blockers:** none found after fixes.

**Medium priority:**
1. Capped list endpoints (`/clients`, `/dogs` at 1000; `/programs` at 500) — *pre-existing*. Consequence observed on this dev DB: a Shop Manager row can exist whose editor can't load its program ("Could not load program"); Program Studio can't open programs outside the window. The booking-modal instance of this class was fixed; the list endpoints themselves were left alone (outside School scope).
2. Legacy `tests/` suite debt — *pre-existing and documented*: ~150 files unrunnable outside the curated gate. Worth an eventual sweep, but explicitly out of scope per RELEASE_CHECKLIST.md.

**Cosmetic / non-blocking:**
1. Feedback screen text-links (`VIEW SCORING DETAILS`, `ASK ABOUT THIS REVIEW`) are 16 px tall on mobile — below touch-target guidance.
2. HQ Overview "Active students" counts distinct client households, while the Students tab lists per-dog enrollments — the differing definitions can read as a mismatch (1 vs 3 for one family with three dogs).
3. `trainer_request_completed` staff notification is in-app-only (`email_status: none`) while other attention types queue email — confirm this is the intended policy.
4. `analytics.practice_sessions_30d` counts only *currently-active* students, so sessions logged by a student who since completed disappear from the 30-day count — arguably correct, but worth knowing.

**Verification-coverage notes (honesty items):** visual screenshots were not capturable in this session (structural/DOM verification used instead); Program Studio's *editor UI* for the block-test course could not be opened due to the pre-existing 500-program list cap (block editing/validation was exercised through the same API the Studio calls, and preview-renderer reuse is source- and test-verified); admin School HQ mobile breakpoints were not swept (client School screens were, at all three widths).

---

# Addendum — Final polish/hardening pass (2026-08-09, commit `2f570c8`)

## Files changed
- `backend/server.py` — new `GET /programs/{program_id}` (admin + `manage_training_content`), registered after all literal `/programs/*` GET routes so it cannot shadow `meta` / `active-summary` / `pipeline`.
- `backend/school_events.py` — `TRAINER_REQUEST_COMPLETED` added to `EVENT_POLICY` (attention + HIGH + email).
- `backend/school_suite.py` — request-respond emit now carries client/dog/program names.
- `frontend/src/components/Programs.jsx` — `fetchProgramById` helper; `openEditProgram` loads the current full doc by id.
- `frontend/src/screens/ShopManager.jsx` — program edit loader uses `fetchProgramById` instead of a bounded-list lookup.
- `frontend/src/components/ProgramStudio.jsx` — `schoolTrainers` passed into `SetupTab` (crash fix).
- `frontend/src/components/school/student/FeedbackScreen.jsx` — 44px hit areas on the two review links.
- `frontend/src/screens/SchoolHQ.jsx` — 44px hit area on "See all".

## 1. Program Studio / list cap
**Root cause:** both program-edit entry points resolved the program by searching a bounded list response (`GET /programs` caps at 500; this dev DB has 806), so a program outside the window produced "Could not load program" — and no fetch-by-id endpoint existed. A second, independent bug surfaced during verification: ProgramStudio crashed with `ReferenceError: schoolTrainers is not defined` for ANY self-guided program, because the state was declared in ProgramStudio but referenced inside the separate `SetupTab` component (never passed as a prop) — this is why the Studio had never successfully opened a School-delivery program.
**Fix:** direct fetch-by-id (`GET /programs/{program_id}`) through one shared `fetchProgramById` helper used by both editors; list/search behavior untouched; a load failure shows an error and never silently selects a fallback program. `schoolTrainers` passed as a prop.
**Verified live with `QA_SCHOOL BlockLab` (outside the 500-row window):** Shop Manager EDIT opens it (network trace shows `GET /programs/18514009-… → 200`), edit → save ("Program updated") → reopen shows the edit; Program Studio opens it (Setup + Curriculum), Client live preview renders the production block components, Phone preview renders in a real 320px frame, Save Live Now persists, reopen shows the saved edit. No wrong program ever displayed.

## 2. School HQ mobile QA (all 10 tabs)
| Breakpoint | Result |
|---|---|
| 1440×900 | all 10 tabs: no horizontal overflow |
| 375×812 | all 10 tabs: no page overflow; every element extending past the viewport sits inside its own `overflow-x` scroll container (HQ tab bar, Analytics tables) — nothing clipped; Student Workspace modal usable (46px close, Save reachable, no overflow); Checkpoint review-queue modal usable (detail pane opens, grade buttons 46px, on-screen) |
| 320×568 | all 10 tabs: no overflow, zero clipped elements; review-queue modal fine; Settings inputs 44px and on-screen; Save button 44px |

**Issue found & fixed:** "See all" section links were 16px tall → now 44px hit areas. Card action buttons (REPLY / MARK READ / RESOLVE / OPEN STUDENT / REVIEW CHECKPOINT / OPEN TRAINER ASSIST) measure 34px tall × 89–155px wide — kept as-is (usable, consistent with the app's admin controls); noted for a future design pass if 44px is wanted everywhere.

## 3. Feedback touch targets
**Root cause:** plain text-link buttons with no minimum height (16px line box).
**Fix:** `min-h-[44px] inline-flex items-center` with negative margins so the visual design is unchanged.
**Measurements:** 375px → both buttons 190–200 × **44px**; 320px → same 44px, right edges ≤238px (no wrap-overflow), no page horizontal scroll.

## 4. `trainer_request_completed` staff alert policy
**Root cause:** the event type was missing from `school_events.EVENT_POLICY`, so the emit site's explicit `requires_attention=True` produced the in-app notification but the policy-driven email stayed `none`.
**Fix:** policy entry `{attention: True, priority: HIGH, email: True}` — the single documented policy table; no second notification/email system. Emit enriched with client/dog/program names.
**Proof:** respond → notification `email_status: "queued"` titled "QA_SCHOOL Family · Birch completed a trainer request" (client/dog/program fields populated) + exactly one outbox row (subject carries the same identity). Re-emit with the same dedupe key: still 1 event / 1 notification / 1 outbox row. Notification deleted + re-emit: notification restored, outbox still 1 (reconciliation works, email never duplicated).

## Verification battery (after all fixes)
- Targeted backend: 84 passed (school_events_phase1, phase2a/2b/2c, online_school_phase4).
- Full in-process backend suite (38 files): **570 passed / 570**.
- Release-critical gate: **all 16 files passed clean**.
- Jest: **446 passed / 446** (27 suites).
- Production build: **success** (exit 0; pre-existing sourcemap warning only).
- Browser: all four fixes verified live (above); Student School regression sweep — Home, My Course, Today, Progress, Feedback, Library all load clean with no error states.

**Remaining release blockers: none.**
