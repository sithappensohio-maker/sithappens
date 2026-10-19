# Claude Testing Handoff — Sit Happens Online School Full Build

## Your role

**TESTER / BUG FIXER ONLY.**

The Online School product architecture and feature scope are already implemented. Do not redesign it, replace systems, simplify product features, rename business concepts, or invent a new architecture because you prefer another approach.

Your job is to:
1. install/use the repo's normal dependencies;
2. run automated tests/build;
3. drive the real app through browser workflows;
4. find reproducible defects;
5. fix only proven defects while preserving architecture;
6. report exact evidence.

If you believe an architectural change is required, STOP and report the exact failing behavior and why it cannot be repaired within the existing architecture before making that change.

## Product invariants you must preserve

- School is the product; generic Homework is an internal engine.
- Progression stays backend-owned: **Learn → optional Practice → Checkpoint/Advance**.
- Handler Skills and Dog Performance stay separate and client-facing on the canonical `/5` scale.
- `course_pct` is curriculum completion. `mastered_pct` is separate trainer-scored skill mastery.
- Existing Practice Coach is reused, not rewritten.
- Existing checkpoint grading is reused, not rewritten.
- Existing Messages is reused for Ask Trainer; do not create another messaging system.
- School event/notification spine remains canonical; email is a delivery channel.
- Trainer Assist uses the existing booking system; do not create another scheduler.
- `manage_school` remains the School permission boundary; impersonation remains owner/admin-only unless explicitly changed by the owner.
- Multiple dogs/enrollments must never leak context into one another.
- Do not touch POS, payments, daycare, boarding, or unrelated systems to make School tests pass.

## Baseline static evidence

Before this handoff, syntax/static checks passed:
- Python School/core files compile.
- 344 frontend source files parse.
- 701 backend routes audited with 0 duplicate method/path registrations.
- Native School runtime has no dependency on `OnlineSchoolDashboard.jsx`.

Do not reinterpret those as behavioral test results.

---

# 1. Environment + complete automated suite

Use the repo's normal runtime versions/configuration. MongoDB must be available to tests that expect it.

Backend:
```bash
cd backend
python -m pip install -r requirements.txt
pytest -q
```

Frontend (use the project's normal package manager/install strategy; there is no lockfile in this supplied tree):
```bash
cd frontend
npm install
CI=true npm test -- --watchAll=false
npm run build
```

If the repo's established local/test scripts differ, use them and document the exact commands.

Do NOT delete/falsify failing tests just to get green.

Classify failures as:
- pre-existing unrelated baseline failure
- stale source-level regression assertion
- genuine defect introduced by Full School build
- test/environment/config issue

Fix genuine defects and stale assertions only when the intended behavior is clear from the actual product architecture.

---

# 2. Browser QA breakpoints

Verify at minimum:
- 1440×900
- 390×844 or stricter 375×812
- 320×568

For every major Student School/Admin School page check:
- body horizontal overflow
- off-screen controls
- unreadable/clipped text
- touch targets
- loading/error/empty states
- console errors
- route refresh/back/forward
- modal/drawer behavior

Do actual visual inspection, not only DOM geometry.

---

# 3. End-to-end Student School workflows

## A. Fresh enrollment
- Purchase/grant School enrollment.
- Correct dog/course selected.
- Onboarding/baseline appears when configured.
- Required equipment/baseline gates training writes.
- Fresh `current_action` is Learn/Start Lesson, not Practice.
- No generic Homework branding.

## B. Multiple dogs
Create one client with at least two School-enrolled dogs.
- Switch dog on Home, My Course, Today, Progress, Feedback, Library/Search.
- Verify course, lesson, scores, questions, remediation, Trainer Assist, plans, notifications never cross dogs.

Critical notification test:
- select Dog A;
- generate a School client notification for Dog B;
- click the Dog B notification;
- UI must switch to Dog B's enrollment before navigating to the target.

## C. Learn → Practice
- Open native Lesson.
- Merely opening does not complete Learn.
- START PRACTICE explicitly marks Learn complete for that enrollment/lesson.
- Practice Coach opens in School context.
- Asking a trainer question while Practice Coach is open must NOT close Practice Coach or show “Practice complete.”
- Complete Practice.
- Return to School/Today and refresh backend current action.

## D. No-practice lesson
- Native COMPLETE LESSON action.
- No fake Practice row created.
- Explicit Learn completion only.
- Advance only when backend allows.

## E. Checkpoint
- Learn + Practice → Submit Checkpoint.
- Normal-size training video upload succeeds up to configured limit.
- Duplicate pending submission blocked.
- Student sees Awaiting Trainer Review.
- School HQ badge/Needs Attention increments.
- Exact checkpoint deep link opens the correct submission.

## F. Checkpoint grading consistency
Grade with real rubric values.
Verify identical Handler/Dog values and `/5` scale on:
- Student Home latest feedback
- Feedback
- Progress/history
- checkpoint detail

Pass/advance must come from backend outcome, not React numeric inference.

## G. Timestamped video review
- Checkpoint review video loads through authenticated School media file/blob path.
- Add annotations at timestamps.
- Seek from annotations.
- No giant base64 JSON response for new filesystem-backed School media.

## H. Remediation
- Grade `prescribe_practice` with required sessions.
- Home/Today prioritize remediation.
- Start prescribed practice opens the exact tracked homework assignment used by backend resubmission gate.
- Complete required sessions.
- Backend current action becomes checkpoint resubmission.
- Student is not left on stale remediation CTA.

## I. Trainer Assist
- Grade Trainer Assist recommended.
- School HQ exact case opens.
- Client sees support-oriented state, not “failure.”
- Request/contact lifecycle where applicable.
- Schedule using a real existing booking.
- Cancel linked booking → reschedule-needed state.
- Complete Trainer Assist / clear hold.
- Student transitions to the real next checkpoint/resubmission action; no stale Assist loop.

## J. Course completion
- Complete final curriculum.
- Exactly 100% `course_pct`.
- No bogus current lesson.
- Completed lessons remain reviewable.
- Completion card, final feedback/scores where real, achievements, recommended next course.
- Print certificate renders correctly.

---

# 4. School HQ + Student Workspace

## Exact deep links
Generate separately:
- student question
- could-not-complete
- review-required video
- checkpoint submission
- Trainer Assist case

Click each School HQ attention/activity action. It must open the **exact** thread/video/practice/checkpoint/Assist record, not merely the generic queue/screen.

## Student Workspace
Verify:
- trainer assignment/reassignment
- notes
- access expiration/extension/pause/revoke/withdraw
- support allowances
- permanent dog School record
- current-enrollment detailed events/checkpoints
- trainer requests
- prescribed plans

## View as student
- owner/admin: works with existing impersonation system
- employee trainer with `manage_school`: clean “owner/admin only” UX, not ugly unhandled 403
- no permission widening

---

# 5. Multi-day prescribed training plans

- Create active plan with multiple days/tasks.
- Student sees correct tasks.
- Student completes one task.
- Trainer edits active plan.
- Completed task remains completed.
- Backend must reject an edit that attempts to remove an already-completed task.
- Uncompleted tasks can be adjusted/removed as intended.
- Entire plan completes when all required tasks are complete.

---

# 6. Trainer requests / media

- Trainer requests video, check-in, questionnaire.
- Student uploads response video + note.
- School HQ/Workspace receives it.
- Admin opens submitted School video.
- Mark reviewed.
- New School media remains filesystem-backed.

---

# 7. Course Builder 2.0

Create a test course using every block type:
- text
- direct URL video
- uploaded School-resource video
- direct URL image
- uploaded School-resource image
- steps
- trainer tip
- warning
- checklist
- knowledge check with correct answer + explanation
- reflection-only knowledge check
- timer
- rep counter
- download/resource
- practice prompt
- checkpoint prompt

Verify:
- ordering/move/delete/visibility
- validation
- live Client preview
- 320px preview
- actual enrolled Lesson rendering
- uploaded linked video/image renders inline rather than only a generic link button
- selecting Direct URL vs School Resource does not accidentally leave two competing sources
- quiz correct/incorrect feedback behaves correctly and does NOT gate progression

Validation must reject:
- media block with no source
- invalid timer
- invalid rep target
- quiz correct answer not in options
- inactive/archived/missing linked School resource

---

# 8. School resource authorization + search

## Resource Library
Create:
- global School resource
- program-targeted resource
- current-lesson-targeted resource
- future-locked-lesson-targeted resource
- resource linked only by a current lesson content block
- resource linked only by a future lesson content block

Verify for the client:
- global requires a readable School enrollment (not public to arbitrary client accounts)
- program resource appears for enrolled program
- current lesson resource appears
- explicitly block-linked current resource appears even if not separately program-targeted
- future lesson-specific/block-linked resource is NOT visible/servable until lesson reached
- archived resource disappears and causes publish validation error if still linked
- revoked/expired School access cannot fetch protected School resource/media by guessed UUID

## Search
- searches only current/reached lesson curriculum
- does not leak locked future lesson text
- resources obey the same authorization boundaries
- feedback results belong to selected School enrollment/dog only
- changing dogs does not retain stale results

---

# 9. School media security + disaster recovery

## File serving
- new School media metadata does not re-expand filesystem video into base64 JSON
- authenticated `/portal/school/media/{id}/file` works for authorized user
- generic non-School Homework media UUID cannot be fetched through School media endpoint
- employee must have `manage_school`
- client may only access its readable School context
- DB `storage_path` outside configured School media root must never be served

## Backup/restore
- create normal backup with School media present
- media archive appears in Settings recovery panel
- download archive
- verify archive
- restore a valid archive
- pre-restore media snapshot is made
- existing media restored correctly
- reject traversal archive
- reject absolute-path archive
- reject symlink/device archive
- simulate/force restore failure if practical and verify rollback keeps previous live media
- restored DB + restored media references work together

---

# 10. Prerequisites / pathways / commerce

Create Foundations → Intermediate → Advanced path.
Verify:
- missing prereq invalid at validation/publish
- self/cycle invalid
- all required prerequisites must be completed
- eligibility is per dog
- trainer-led completed prerequisite satisfies pathway
- Shop shows selected dog's missing prerequisites
- blocked Shop purchase cannot reach order/payment mutation
- staff/POS training-program sale also blocks before money mutation
- qualifying dog can purchase/enroll normally
- enrollment snapshot freezes prerequisites/support/onboarding/recommended-next data
- later Program edit does not silently change an existing student's frozen terms

---

# 11. Progress / analytics / interventions

## Student Progress
- `course_pct`: 0% fresh, partial >0<100, exactly 100 completed
- `mastered_pct` remains separately labeled Skill Mastery
- zero mastery data never masquerades as zero Course Progress
- multiple checkpoint score history
- single score avoids fake trend
- deterministic Handler-vs-Dog explanation only where data supports it

## School Analytics
Verify counts/timings against seeded known data:
- active/completed/withdrawn
- completion rate/time
- practice sessions
- checkpoint outcomes/first-pass
- review time
- first response time
- trainer workload
- drop-off/friction

## Interventions
Change School thresholds and prove flags follow settings:
- inactivity
- repeated could-not-complete
- repeated high difficulty
- overdue checkpoint review
- overdue unanswered question

No automatic punishment/progression changes.

---

# 12. Notifications + event reliability

Verify staff in-app + email policy for:
- question
- checkpoint
- could not complete
- review-required video
- Trainer Assist

Routine practice/lesson activity should remain feed activity without alert spam.

Test event retry/idempotency:
- same dedupe key does not double event/notification/email
- if event exists but notification creation previously failed, retry/reconciliation must ensure the missing notification can be restored rather than permanently skipped

Client notifications:
- trainer reply
- checkpoint reviewed
- remediation
- Trainer Assist lifecycle
- deep link to correct dog/enrollment/context
- read state persists

---

# 13. Access lifecycle / edge states

Test:
- no enrollment
- purchased/not started
- paused
- expired
- revoked
- withdrawn
- setup_required legacy malformed course
- trainer not assigned
- no feedback
- no checkpoint history
- completed

No raw backend errors/undefined labels.

Paused/withdrawn historical-read behavior should match existing canonical rules. Revoked/expired protected content must be blocked.

---

# 14. Regression outside School

Smoke test at minimum:
- generic Homework outside School
- admin Dashboard
- client portal normal navigation
- Program Studio ordinary trainer-led courses
- POS/Register
- daycare
- boarding
- payments/Stripe paths that do not require live external payment
- employee permission matrix
- app startup/index creation

Do not “fix” unrelated systems unless a change in this build demonstrably broke them.

---

# 15. Required final report

Do not say only “all tests pass.” Report:

## Automated
- exact backend command + pass/fail count
- exact frontend command + pass/fail count
- exact production build result
- list of fixed failing tests/defects

## Browser
For each breakpoint:
- routes/states inspected
- screenshots where possible
- overflow/runtime/console findings

## Security/data isolation
Explicitly report:
- two-dog isolation
- locked-future resource/search isolation
- School media authorization
- generic Homework media boundary
- permission tests

## Regressions
List unrelated smoke flows run and outcomes.

## Code changes made during testing
List every file changed and why. No silent redesigns.

## Remaining issues
Separate:
- release blockers
- medium-priority defects
- cosmetic/non-blocking items

STOP after the testing/fix report. Do not begin a new product phase.
