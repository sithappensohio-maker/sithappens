# Claude Handoff — Unified Sit Happens School / Practice Consolidation

## Scope

This branch consolidates the app's separate Homework/trainer-led/Online School concepts into one user-facing **School** system while deliberately preserving the mature Homework engine underneath as **Practice**.

**Do not redesign this architecture during testing.** The central invariant is:

- `dog_programs` = canonical curriculum/progress ledger.
- `school_enrollments` = School identity/ownership/access companion row.
- `homework` = internal Practice engine reused by School.
- training-session drafts/logs = in-person delivery engine reused by School.
- checkpoint submissions = one checkpoint history for video and live trainer assessments.

The intent is **one curriculum, one progress record, multiple delivery modes**:

- `online` -> `delivery_channel=online_school`, School `delivery_mode=self_guided`
- `in_person` -> `delivery_channel=in_person_school`, School `delivery_mode=trainer_led`
- `hybrid` -> `delivery_channel=hybrid_school`, School `delivery_mode=hybrid`

Do not create a second in-person School progress collection. Do not rename/delete the existing `homework` collection or `/homework/*` APIs just because the UI now calls it Practice.

## Commits / stages

Baseline before this work: `779fbaf`

1. `46929ff` — Stage 1: unified School enrollment model
2. `6ab4af0` — Stage 2: one Assign Program workflow
3. `e229870` — Stage 3: all delivery modes in School HQ
4. `3f648e7` — Stage 4: one client School experience
5. `0315f99` — Stage 5: Practice folded into School
6. `3813a03` — Stage 6: lifecycle/retake + legacy adoption
7. `7dac012` — Stage 7: live checkpoints + operations context
8. `3043174` — Stage 8: privacy/permission hardening

The final handoff commit may be newer only because this document was added.

---

## Stage 1 — enrollment/data model

### What changed

`POST /school/enroll` is now the canonical staff assignment endpoint for all School Programs.

Input accepts:

- `dog_id`
- `program_id`
- `delivery_mode`: `in_person | online | hybrid`
- assigned trainer
- start date
- target completion date
- trainer notes

Backward compatibility: omitting `delivery_mode` still means `online`, preserving old Online School callers.

### Important invariants

- Program configured `trainer_led` can be assigned in person.
- Program configured `self_guided` can be assigned online.
- Program configured `both` can be assigned online, in person, or hybrid.
- The existing `dog_programs` row remains the progress ledger.
- In-person/hybrid now also receive a companion `school_enrollments` row.
- No second active copy of the same program may be created for one dog.
- Program prerequisites are still enforced at the canonical enrollment boundary.

### Permissions

- Online assignment requires `manage_school`.
- In-person/hybrid assignment allows `manage_school` **or** `manage_training_sessions`.
- Trainer lookup allows the same two permissions, but only returns active staff who themselves have School or training-session permission.

Test these permission boundaries explicitly.

---

## Stage 2 — one Assign Program UI

`DogTrainingTab.jsx` now exposes one **Assign Program** flow instead of separate normal vs Online School enrollment actions.

The modal chooses:

1. Program
2. Delivery type: In Person / Online / Hybrid (only modes supported by that Program)
3. Assigned trainer
4. Start date
5. Target completion date

In-person/hybrid retain the existing `TrainingSessionWorkspace`; online remains self-guided.

Test that old trainer workflow is not lost when the program was assigned through the new School endpoint.

---

## Stage 3 — School HQ includes everyone

School HQ student roster now treats all three delivery modes as real School students.

Verify:

- In Person badge
- Online badge
- Hybrid badge
- correct program/progress/status/trainer
- dog permanent School history contains prior/current programs from every delivery mode

School HQ remains a `manage_school` administrative surface. Broader training-session permission on assignment/trainer lookup does **not** implicitly grant School HQ administration.

---

## Stage 4 — one client School

The client-facing destination is now **Sit Happens School** rather than Online School as a separate product.

Delivery behavior:

- Online: current Learn -> Practice -> checkpoint/advance behavior remains.
- Hybrid: online content/progression remains available alongside trainer sessions.
- In person: curriculum can be reviewed and assigned Practice can be completed, but the client may **not** self-advance the course pointer.

Backend enforcement exists: in-person self-advance must fail even if a client bypasses the UI.

### Privacy hardening

All School-owned delivery channels are hidden from the legacy raw client `/dogs/{dog_id}/programs` response. This is intentional: that legacy response can contain trainer/internal fields. School clients must use the allowlisted `/portal/school*` APIs.

Test this specifically for `in_person_school` and `hybrid_school`, not only `online_school`.

---

## Stage 5 — Homework becomes School Practice

The mature Homework system is retained internally and presented to users as **Practice**.

### Staff

Student Workspace has a Practice tab where staff can:

- choose an existing Practice/Homework template
- associate it with a School lesson or whole program
- set due date
- set frequency
- set minutes/session
- set repetition target
- set environment
- personalize trainer note
- request video
- mark required
- inspect the existing full Practice report inline

New route:

`POST /admin/school/students/{school_enrollment_id}/practice`

School Practice records are normal `homework` documents with explicit ownership markers:

- `school_enrollment_id`
- `school_enrollment_record_id`

### Client

- School-owned Practice appears in the School experience.
- School-owned Practice is filtered out of the legacy generic client Homework list so it is not duplicated in two products.
- Legacy/general one-off Practice remains on the old compatibility route.

### Session integration

Practice created by an in-person training-session completion is stamped with the School enrollment ids when a companion School enrollment exists.

A completed training session also emits a School timeline event.

Do not remove the old Homework engine, Practice Coach, media, review, analytics, daily tracker, or compatibility APIs.

---

## Stage 6 — lifecycle, repeats, and legacy adoption

### Explicit Repeat Program

New route:

`POST /admin/school/students/{school_enrollment_id}/retake`

Eligibility: original canonical `dog_programs.status` must be `completed` or `withdrawn`.

The repeat creates a **new** `dog_programs` row and **new** School companion. It does not reset or overwrite the old attempt.

Lineage fields:

- `retake_of_enrollment_id`
- `retake_of_school_enrollment_id`

Online retakes are allowed **only through this explicit staff workflow**. Repeat purchases and ordinary Online enrollment still converge/block rather than silently create another attempt.

Student Workspace exposes **Repeat Program** for eligible completed/withdrawn records.

Test old history remains queryable after the repeat.

### Legacy in-person adoption script

File:

`backend/scripts/adopt_legacy_training_into_school.py`

This is **dry-run by default** and must never be run blindly against production.

It adopts pre-consolidation trainer-led `dog_programs` rows that have no `delivery_channel` by:

1. creating a companion `school_enrollments` row, and
2. setting only `delivery_channel=in_person_school` plus an adoption timestamp on the existing progress row.

It intentionally does **not**:

- rewrite progress
- rebuild snapshots
- fabricate School events
- create Practice
- attach old generic Homework to a program by guesswork
- alter bookings
- alter payments
- alter credits

Commands:

```bash
# BACKUP FIRST
mongodump --uri="$MONGO_URL" --db=$DB_NAME --collection=dog_programs --out=./backup-$(date +%Y%m%d)
mongodump --uri="$MONGO_URL" --db=$DB_NAME --collection=school_enrollments --out=./backup-$(date +%Y%m%d)

# test database / restored copy first
python scripts/adopt_legacy_training_into_school.py
python scripts/adopt_legacy_training_into_school.py --verify
python scripts/adopt_legacy_training_into_school.py --apply
python scripts/adopt_legacy_training_into_school.py --verify
```

Also test `--enrollment-id <id>`.

The script is intended to be idempotent.

---

## Stage 7 — live trainer checkpoints + operational context

### Live checkpoints

New route:

`POST /admin/school/students/{school_enrollment_id}/lessons/{lesson_id}/live-checkpoint`

For in-person/hybrid students, Student Workspace shows **Live trainer checkpoint** on the current lesson when that lesson has checkpoint configuration.

The trainer scores the exact same frozen rubric (1-5) and chooses:

- Pass / Advance
- Needs More Practice
- Trainer Assist

The endpoint creates the same canonical `checkpoint_submissions` document, marks `submission_source=trainer_live`, requires no uploaded video, and then directly reuses the existing durable checkpoint grading state machine.

There is intentionally no separate live-assessment collection or alternate progression engine.

For in-person advancement, the School helper does **not** silently auto-assign the next lesson's Practice; trainer/session workflow owns the next in-person Practice assignment. Hybrid/online retain self-guided auto-Practice behavior.

Test checkpoint history displays `live trainer assessment` and that scores/outcomes/progression match normal graded checkpoints.

### School operational context

Student Workspace detail now returns/uses:

- training credit balance
- upcoming training bookings
- completed training-session count
- recent session records/recaps

This is read-only context. It must not mutate bookings or credits.

---

## Stage 8 — hardening found during final review

1. Trainer list endpoint now allows staff with either `manage_school` or `manage_training_sessions`; without this, a training-only staff member could open Assign Program but not populate the trainer selector.
2. Legacy raw client training-program endpoint now excludes **all School channels**, preventing new in-person/hybrid School rows from exposing raw/internal training fields to clients.

---

# Required regression test matrix

## A. Existing Online School — must not regress

1. Existing online student loads School.
2. Current lesson/module pointer unchanged.
3. Learn content loads.
4. Practice Coach works.
5. Existing checkpoint video submission works.
6. Pending checkpoint queue works.
7. Grade Advance works.
8. Grade Needs More Practice works.
9. Trainer Assist works.
10. Module quiz gate works.
11. Course completion works.
12. Client feedback/history works.
13. Shop/POS Online School purchase fulfillment still creates exactly one enrollment.
14. Purchase replay/idempotency does not create a retake.
15. Completed/withdrawn online course cannot be silently repurchased/re-enrolled.

## B. New in-person School assignment

1. Assign a `trainer_led` Program via unified Assign Program -> In Person.
2. One `dog_programs` row exists with `delivery_channel=in_person_school`.
3. Exactly one companion `school_enrollments` row points to it.
4. It appears in School HQ with In Person badge.
5. It still appears in the trainer's session/run-sheet workflow.
6. Start and complete an in-person training session.
7. Session progress writes to the same `dog_programs` row.
8. Session-created Practice contains both School ownership markers.
9. Practice appears in Student Workspace and client School.
10. Same Practice does not duplicate in legacy generic Homework list.
11. Training-session-completed event appears on School timeline.
12. Client attempting `/portal/school/{id}/advance` gets the intended in-person rejection.
13. Client raw `/dogs/{dog_id}/programs` does not expose this School row.

## C. Hybrid

1. Assign a Program configured `both` -> Hybrid.
2. Exactly one progress row + one School companion.
3. Trainer session workspace works.
4. Online lesson/Practice behavior works.
5. Self-guided first-lesson Practice behavior remains.
6. Client advancement is permitted under the existing hybrid rules.
7. No duplicate progress rows are created by switching between trainer/client activity.
8. Client raw legacy program endpoint does not expose the hybrid School row.

## D. Permission tests

At minimum exercise Owner/Admin, a staff member with only `manage_school`, a staff member with only `manage_training_sessions`, and a staff member with neither.

Expected:

- `manage_school`: online/in-person/hybrid assignment allowed where Program supports it.
- `manage_training_sessions` only: in-person/hybrid assignment allowed; online assignment denied.
- neither: unified assignment denied.
- trainer lookup: School or training-session permission allowed; neither denied.
- School HQ administrative detail remains `manage_school` gated.

No role should gain finance/client data access merely because these routes changed.

## E. Practice ownership

Test one dog with:

- one legacy/general Practice assignment
- one in-person School Practice
- one online School Practice (if practical with separate program)

Verify each School workspace only returns its own School Practice, and generic legacy client Practice does not duplicate School-owned records.

## F. Repeat Program

For each practical delivery mode:

1. Complete or withdraw old enrollment.
2. Click Repeat Program / call retake endpoint.
3. Old ids remain unchanged and queryable.
4. New ids are different.
5. New row starts fresh curriculum progress.
6. New rows contain retake lineage to old ids.
7. Old Practice/checkpoints/session history stays on old attempt.
8. Only the new attempt is active.
9. Attempting Repeat while another active attempt exists returns 409.

## G. Live trainer checkpoint

Use an in-person or hybrid current lesson with a configured checkpoint.

1. Score every handler criterion 1-5.
2. Score every dog criterion 1-5.
3. Pass/Advance -> checkpoint is graded, source is `trainer_live`, pointer advances exactly once.
4. Retry/duplicate active checkpoint cannot create two pending submissions.
5. Needs More Practice -> canonical checkpoint outcome/prescription is stored.
6. Trainer Assist -> existing Trainer Assist lifecycle is created, not a new system.
7. No video is required and history/client-safe readers tolerate `video_media_id=None`.
8. In-person advance does not auto-create the next lesson Practice.
9. Hybrid behavior retains expected next-lesson Practice rules.

## H. Legacy adoption script — restored/test DB only

Construct or identify:

- legacy active trainer-led row without delivery_channel
- legacy completed row
- legacy withdrawn row
- row already adopted
- row missing dog
- dog missing owner

Verify dry run has zero writes, apply is idempotent, progress/status/snapshot/session counts are byte-for-byte unchanged except allowed School ownership fields, and a second apply makes no new companion rows.

## I. Frontend regression

Check desktop 1440x900 and mobile 390x844 / 320x568:

- Dog Training tab / Assign Program modal
- School HQ roster
- Student Workspace Overview
- Practice tab
- live checkpoint form
- History tab
- client School home/today/progress/feedback
- no horizontal overflow
- no uncaught console errors
- long Program/lesson/client names do not break layout

---

# Automated test commands

Run in the project's normal environment with dependencies present.

## Backend syntax

```bash
python -m py_compile backend/server.py backend/school_suite.py backend/school_events.py backend/scripts/adopt_legacy_training_into_school.py
```

## Focused School/training regression

From repository root:

```bash
python -m pytest \
  backend/test_online_school_phase1.py \
  backend/test_online_school_phase3.py \
  backend/test_online_school_phase4.py \
  backend/test_online_school_phase5.py \
  backend/test_online_school_phase6.py \
  backend/test_online_school_checkpoints.py \
  backend/test_online_school_hardening.py \
  backend/test_school_phase2a.py \
  backend/test_school_phase2b.py \
  backend/test_school_phase2c.py \
  backend/test_school_prerequisites_and_snapshot.py \
  backend/test_school_events_phase1.py \
  backend/test_training_permissions_phase8.py \
  backend/test_training_session_workspace.py \
  backend/test_training_session_completion.py \
  backend/test_practice_coach.py \
  backend/test_practice_reviews.py \
  -q
```

Then run the entire backend suite expected by this repo.

## Frontend

Use the repo's normal Yarn/container environment:

```bash
cd frontend
yarn build
CI=true yarn test --watchAll=false
```

## Release-critical gate

Follow `RELEASE_CHECKLIST.md` exactly. The runner is:

```bash
cd backend
python tests/run_release_critical.py
```

It expects the dedicated release-critical server/test database described in the checklist. Do not point it at production.

---

# Local verification already performed in this handoff environment

Succeeded:

```text
python -m py_compile backend/server.py backend/school_suite.py backend/school_events.py backend/scripts/adopt_legacy_training_into_school.py
git diff --check
```

Could **not** execute the backend pytest suite in this extracted sandbox because the Python environment does not contain the project's database dependencies (`pymongo` / `motor`). Focused pytest collection fails before application tests execute for that reason. This is an environment limitation, not a passing test result.

Frontend `node_modules` are also absent in this extracted sandbox, so `yarn build` / Jest were not represented as passed here.

Do not report these as green until you actually run them in the normal project/container environment.

---

# Things Claude must NOT do while testing

- Do not deploy this branch.
- Do not run the legacy adoption script against production.
- Do not “simplify” by deleting Homework backend routes/collection.
- Do not create a second progress model for in-person School.
- Do not migrate/repair production records automatically.
- Do not alter payments, credits, pricing, POS, bookings, or finance as part of School cleanup.
- Do not silently attach legacy generic Homework to School programs by inference.
- Do not turn a repeat purchase into an automatic course retake.
- Do not weaken School/client field allowlists.
- Do not declare the work tested merely because syntax/build succeeds.

If a test exposes a genuine defect, fix the smallest defect consistent with the invariants above, add/adjust a regression test, and report the exact failing case and fix.

# Acceptance target

The feature is accepted when all of the following are true:

1. Existing Online School still behaves exactly as before except for generalized School wording.
2. The same Program can be assigned to an in-person client without creating a second curriculum system.
3. In-person sessions, Practice, checkpoints, progress, and history appear in one School student record.
4. Hybrid can use both trainer and online delivery against one progress ledger.
5. School-owned Practice is not duplicated in the old Homework UI.
6. Completed/withdrawn programs can be explicitly repeated without destroying history.
7. Existing in-person records have a safe, dry-run-first adoption path.
8. Permissions and client privacy remain enforced server-side.
9. Full backend/frontend/release-critical regression suites are green in the normal environment.
