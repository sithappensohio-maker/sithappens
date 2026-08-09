# Sit Happens Online School — Full Build Report

## Status

Development scope is complete against the agreed Online School product plan. This build is ready for a dedicated testing/bug-fix pass. It has **not** been declared production-ready yet because the full repo pytest/Jest/browser suite must still be run in the normal project environment.

The product boundary is now explicit:

> **Online School is the product. Generic Homework is an internal engine School may reuse.**

Core product promise:

> **Do it yourself doesn't mean do it alone.**

## What is now built

### 1. School operations / School HQ
- Dedicated School HQ with Overview, Activity, Needs Attention, Checkpoints, Trainer Assist, Students, Interventions, Analytics, Resources, and Settings.
- Durable School event spine (`school_events`) separate from per-recipient notifications (`school_notifications`).
- In-app admin/trainer attention counts and email delivery for human-attention events.
- Read/resolved lifecycle and exact workflow context/deep links.
- Dedicated `manage_school` permission boundary, server-side enforced.
- Student Workspace with trainer assignment, School notes, enrollment controls, support allowances, prescribed plans, trainer requests, permanent dog School history, checkpoint history, and School timeline.
- Owner/admin-only portal impersonation remains intentionally stricter than ordinary `manage_school` access.

### 2. Native client Student School
Native routes now cover:
- `/school` — Student Home
- `/school/course/:enrollmentId` — My Course
- `/school/course/:enrollmentId/lesson/:lessonId` — Lesson
- `/school/today` — Today's Training
- `/school/progress` — Progress
- `/school/feedback` — Trainer Feedback
- `/school/resources` — Library
- `/school/search` — School search

Normal Student School runtime no longer mounts the legacy `OnlineSchoolDashboard.jsx`.

### 3. Guided progression
Backend remains the source of truth for the student's next action.

Progression invariant:

**Learn → optional Practice → Checkpoint/Advance**

Priority states also cover:
- onboarding/baseline
- prescribed remediation
- Trainer Assist
- awaiting trainer review
- malformed legacy setup protection
- paused/revoked/expired access
- course completion

Learn completion is explicit and per enrollment/dog; opening a page does not mark learning complete.

### 4. Practice Coach integration
- Reuses the existing Homework/Practice engine without exposing generic Homework branding to School students.
- School ownership fields prevent trainer-led homework from accidentally counting as School practice merely because it shares a lesson id.
- Asking a question no longer falsely closes Practice Coach or shows a practice-complete result.
- Completion returns to School and refreshes the backend-derived next action.

### 5. Checkpoints + trainer grading
- Existing checkpoint grading retained.
- Handler Skills and Dog Performance remain separate, canonical `/5` client scores.
- Checkpoint submission, awaiting-review, advance, remediation, and Trainer Assist outcomes are represented natively to the student.
- Timestamped trainer video annotations added to checkpoint review.
- Completed Trainer Assist and satisfied remediation transition back to real checkpoint resubmission instead of leaving stale support CTAs.

### 6. Trainer Feedback + Progress
- Native feedback history using real checkpoint/reply data.
- Handler Skills and Dog Performance are explained separately.
- Backend `course_pct` represents curriculum completion; `mastered_pct` remains a separate trainer-scored skill-mastery measure.
- Lesson/module/checkpoint history and score trends are surfaced without inventing scores.
- Permanent dog School record spans School programs for that dog.

### 7. Contextual Ask Trainer + client School notifications
- Ask Trainer reuses the existing client Messages system; no second messaging platform.
- School context is attached server-side: dog, enrollment, course, module, lesson, practice/checkpoint where relevant.
- Phase-1 School event + staff attention notification + email policy remain in the path.
- Trainer replies surface natively in School.
- Client School notification bell supports unread state and deep links.
- Multi-dog notification navigation switches to the notification's enrollment before opening the target.

### 8. Remediation + multi-day prescribed plans
- Trainer-prescribed remediation launches the exact backend-tracked assignment counted by the resubmission gate.
- Trainer Workspace can create/edit active multi-day plans.
- Completed plan tasks cannot be removed or reset by an edit.
- Students see and complete plan tasks in School.
- Practice requirements remain backend-owned; React does not decide remediation completion.

### 9. Trainer Assist integration
- Existing Trainer Assist lifecycle reused: needs attention/contacted/scheduled/completed.
- Scheduling links to a real existing booking/appointment instead of inventing a second calendar.
- Canceled linked bookings surface a reschedule-needed state.
- Completion does not silently advance the course; the backend returns the real next action.

### 10. Course Builder 2.0
Ordered client lesson blocks now support:
- text
- video
- image
- steps
- trainer tip
- safety/warning
- checklist
- knowledge check
- timer
- rep counter
- download/resource
- practice prompt
- checkpoint prompt

Knowledge checks support an optional real correct answer and explanation/coaching note while remaining non-gating.

Validation rejects invalid block sources/configuration and inactive/broken linked School resources.

The Program Studio live preview uses the native lesson block renderer. Uploaded linked video/image resources render inline; media/resource source selection is mutually exclusive to avoid duplicate lesson sources.

### 11. School media / video system
- School checkpoint videos, School practice videos, trainer-request videos, and uploaded School resources use filesystem persistence instead of embedding growing base64 payloads in Mongo.
- Mongo stores metadata/path only for new School filesystem media.
- Filesystem-backed School media now uses an authenticated binary file endpoint rather than re-expanding large files into JSON/base64.
- Frontend loads authenticated file blobs and uses browser object URLs.
- Generic non-School Homework media keeps its legacy path for compatibility.
- School media endpoint is explicitly prevented from becoming a back door into unrelated generic Homework media.
- Client media/resource authorization is enrollment-scoped and blocks revoked/expired access.
- Lesson-linked resources from locked future lessons are not exposed by Library/Search/media authorization until the student reaches them.
- Global School resources still require at least one readable School enrollment; they are not public files.

### 12. Media disaster recovery
- School media root is persisted in Docker Compose.
- Backup safety includes School media sidecar/archive awareness.
- Admin Settings includes media archive list/download/restore UI.
- Restore is owner-only.
- Archive validation rejects traversal, absolute paths, links, devices, and files outside `school_media/`.
- Restore takes a pre-restore media snapshot, stages extraction, swaps directories, and has rollback protection.
- File serving independently verifies that a stored path is a real file inside the configured School media root.

### 13. Resource library + search
- Admin School resource library supports links, files, images, video, tags, global/course/lesson targeting, edit/archive.
- Course Builder may explicitly link a School resource in a lesson block.
- Explicit lesson-block linkage grants access once that lesson is reached even when the resource is not separately course-targeted.
- Student Library/search are enrollment/dog scoped.
- Search covers reached lesson content, authorized resources, and trainer feedback; locked future lesson content is excluded.

### 14. Student onboarding / baseline
- Course snapshot can freeze onboarding requirements.
- Student baseline supports goals, current challenges, experience, equipment, preferred practice schedule, and notes.
- Required baseline/equipment gates new training actions without hiding existing history.
- Baseline becomes part of the trainer Workspace / dog training record.

### 15. Trainer ownership + service tracking
- School enrollments can be assigned to a real trainer.
- Student Home uses a real recent grader/replier/assigned trainer where available and generic Sit Happens support otherwise; no fabricated trainer identity.
- School Analytics includes response/review timing and trainer workload.
- Intervention rules surface inactivity, repeated difficulty/could-not-complete, overdue checkpoint review, and overdue unanswered questions from configurable School thresholds.

### 16. Course pathways / prerequisites
- Required prerequisite slugs validate at authoring/publish time.
- Missing, self-referential, duplicate, and circular paths are protected.
- Prerequisites are per dog.
- Completion through trainer-led delivery can satisfy the same pathway.
- Shop and staff sale eligibility check prerequisites before the money mutation.
- Existing enrollment snapshots freeze prerequisite/pathway/support/onboarding metadata.
- Recommended next programs surface after completion.

### 17. Enrollment/access controls
- Access extension/expiration, pause, revoke/withdraw states are represented.
- Protected School content respects canonical access state.
- Historical/completed training remains distinguishable from current access.
- Multiple dogs/enrollments remain isolated throughout School views and notifications.

### 18. Completion / graduation
- Native course-complete state.
- Completion date, curriculum counts, checkpoint/practice information, final scores, achievements, and recommended next programs where available.
- Printable client-side certificate uses existing School data rather than inventing a separate certificate backend.

### 19. School commerce presentation
- Online School sales detail explains real trainer oversight and Trainer Assist support.
- Null/unspecified support allowances no longer render as misleading `0` values.
- Student support summary likewise uses human copy when support is available as needed rather than showing a meaningless dash/zero.
- Dog-specific prerequisite eligibility can disable purchase before checkout.

## Important architecture safeguards

- No second progression engine in React.
- No second School messaging system.
- No second event/notification spine.
- No rewrite of the existing Practice Coach engine.
- No rewrite of checkpoint grading.
- No new appointment/calendar system for Trainer Assist.
- School-specific functionality remains additive around existing app systems.
- POS/daycare/boarding/payment architecture was not intentionally redesigned by this build.

## Static validation completed in this environment

The following checks **passed** after the final code changes:

- Python syntax compilation for `server.py`, `school_suite.py`, `school_events.py`, and new/modified School tests.
- TypeScript parser used as a syntax parser across **344 frontend JS/JSX/TS/TSX files**.
- Backend AST route audit across `server.py` + `school_suite.py`: **701 routes, 0 duplicate method/path registrations**.
- Runtime source search: no `OnlineSchoolDashboard`, `schoolOpen`, or `setSchoolOpen` references outside the dormant legacy file/tests.
- No TODO/FIXME markers found in the new School implementation surface.
- Native student-visible School files contain no generic `Homework` product labeling; internal variable/API names remain for the reused engine.

## Dynamic tests deliberately still required

This development environment does not contain the project's full installed Python/frontend dependency tree, so this report does **not** claim that the complete pytest/Jest/build/browser suite is green.

That testing is the next dedicated phase. See `SCHOOL_BUILD_HANDOFF_FOR_CLAUDE.md`.

## Files added/changed

The packaging step creates a changed-files-only ZIP relative to the supplied baseline. The full repo ZIP is also provided so the testing phase can use one coherent source tree.
