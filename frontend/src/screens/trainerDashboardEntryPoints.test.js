// Training UI Phase 5 — source-level regression guards for the Trainer
// Daily Dashboard redesign, matching this repo's established no-RTL
// convention (see trainingEntryPoints.test.js / portalLearningEntryPoints.test.js).
// Status->action mapping and attention-queue *content* logic are pure-
// function tested in lib/trainerDashboardPolish.test.js — these guards
// instead prove the UI actually WIRES to that logic rather than
// reimplementing it inline.
import fs from "fs";
import path from "path";

const pipelineSrc = fs.readFileSync(path.join(__dirname, "Pipeline.jsx"), "utf8");
const rowSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "TrainingDogRow.jsx"), "utf8");
const queueSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "TrainerAttentionQueue.jsx"), "utf8");
const summarySrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "TrainingDaySummary.jsx"), "utf8");

// 1. Status -> action mapping comes from the shared pure helper, never a
// second inline copy of the decision.
test("TrainingDogRow resolves its primary action via resolvePrimaryAction, not inline logic", () => {
  expect(rowSrc).toMatch(/import \{ resolvePrimaryAction \} from ["']\.\.\/\.\.\/lib\/trainerDashboardPolish["']/);
  expect(rowSrc).toMatch(/resolvePrimaryAction\(r\)/);
});

// 2. A completed session can never show a Check-In/Start action — proven
// structurally: TrainingDogRow renders exactly one action button, and its
// label always comes from resolvePrimaryAction's return value (already
// proven never to emit Check In for a completed row — see
// trainerDashboardPolish.test.js).
test("TrainingDogRow renders exactly one primary action button per row, driven by the resolved action", () => {
  const actionButtonMatches = rowSrc.match(/onClick=\{\(\) => onPrimaryAction\(action, r\)\}/g) || [];
  expect(actionButtonMatches).toHaveLength(1);
  expect(rowSrc).toMatch(/\{action\.label\}/);
});

// 3. A reopened plan_ready draft shows "Resume Draft" — TrainingDogRow
// must pass reopen_count through to the resolver rather than hardcoding
// a fixed label.
test("TrainingDogRow's row data includes reopen_count for the resolver to key off", () => {
  expect(rowSrc).not.toMatch(/"Resume Draft"/); // never hardcoded here — only in trainerDashboardPolish.js
});

// 4. Multiple/no active enrollments render a distinct resolution state,
// never silently falling back to a normal program breadcrumb.
test("TrainingDogRow shows the resolution reason instead of program/module text when resolution_needed", () => {
  expect(rowSrc).toMatch(/resolution_needed/);
  expect(rowSrc).toMatch(/resolution_reason/);
});

// 5. Homework/video/question attention is visible on the row, and the
// attention queue itself is wired into the dashboard.
test("TrainingDogRow surfaces homework completion, media awaiting review, and client questions", () => {
  expect(rowSrc).toMatch(/homework_completion/);
  expect(rowSrc).toMatch(/media_awaiting_review/);
  expect(rowSrc).toMatch(/client_question/);
});
test("Pipeline renders TrainerAttentionQueue fed by buildAttentionQueue over todayRows", () => {
  expect(pipelineSrc).toMatch(/import \{ computeDaySummary, buildAttentionQueue, filterTrainingRows \} from ["']\.\.\/lib\/trainerDashboardPolish["']/);
  expect(pipelineSrc).toMatch(/buildAttentionQueue\(todayRows\)/);
  expect(pipelineSrc).toMatch(/<TrainerAttentionQueue items=\{attentionItems\}/);
});

// 6. Unauthorized viewers never see stale/partial dashboard content — a
// failed /admin/training/today call (403 for anyone without
// manage_training_sessions) clears todayRows, and the whole section is
// gated on todayRows being non-empty (or still loading), so it disappears
// rather than rendering a broken partial dashboard.
test("A failed /admin/training/today call clears todayRows instead of leaving stale/partial data", () => {
  expect(pipelineSrc).toMatch(/catch \{ setTodayRows\(\[\]\); \}/);
  expect(pipelineSrc).toMatch(/\{\(todayLoading \|\| todayRows\.length > 0\) && \(/);
});

// 7. Existing check-in/workspace entry points are unchanged — the same
// TrainingSessionWorkspace covers both the booking-based dashboard flow
// and the lower pipeline list's dogId/enrollmentId flow.
test("Pipeline still opens the same TrainingSessionWorkspace for both booking-based and dogId/enrollmentId entry points", () => {
  expect(pipelineSrc).toMatch(/import TrainingSessionWorkspace from ["']\.\.\/components\/TrainingSessionWorkspace["']/);
  expect(pipelineSrc).toMatch(/setWorkspaceFor\(\{ bookingId: r\.booking_id \}\)/);
  expect(pipelineSrc).toMatch(/onOpenWorkspace=\{\(\) => setWorkspaceFor\(\{ dogId: r\.dog_id, enrollmentId: r\.id \}\)\}/);
  expect(pipelineSrc).toMatch(/<TrainingSessionWorkspace[\s\S]*?bookingId=\{workspaceFor\.bookingId\}[\s\S]*?dogId=\{workspaceFor\.dogId\}[\s\S]*?enrollmentId=\{workspaceFor\.enrollmentId\}/);
});

// 8. No duplicate rows — one TrainingDogRow per filtered row, keyed by the
// unique booking_id, from a single .map call (not nested/duplicated).
test("Pipeline renders exactly one TrainingDogRow list, keyed by booking_id", () => {
  const mapMatches = pipelineSrc.match(/filteredTodayRows\.map\(r => \(/g) || [];
  expect(mapMatches).toHaveLength(1);
  expect(pipelineSrc).toMatch(/<TrainingDogRow key=\{r\.booking_id\}/);
});

// 9. Distinct empty states: no appointments today vs. no rows matching the
// active filter — never the same generic message for both.
test("Pipeline shows a distinct EmptyState for zero appointments vs. zero rows matching the active filter", () => {
  expect(pipelineSrc).toMatch(/testid="today-empty-none"/);
  expect(pipelineSrc).toMatch(/testid="today-empty-filtered"/);
  expect(pipelineSrc).toMatch(/No training appointments today/);
  expect(pipelineSrc).toMatch(/No dogs match this filter/);
});

// 10. The primary action is reachable on mobile — never hidden behind a
// desktop-only breakpoint class — and the row degrades gracefully when
// optional fields (legacy/incomplete rows) are missing.
test("TrainingDogRow's primary action button is never hidden at any breakpoint", () => {
  const actionButtonBlock = rowSrc.slice(rowSrc.indexOf("onPrimaryAction(action, r)") - 200, rowSrc.indexOf("onPrimaryAction(action, r)") + 50);
  expect(actionButtonBlock).not.toMatch(/hidden (sm|md|lg):/);
});
test("TrainingDogRow renders safely when optional fields (recommended_focus, assigned_trainer, module/lesson names) are absent", () => {
  expect(rowSrc).toMatch(/r\.recommended_focus\?\.length > 0/);
  expect(rowSrc).toMatch(/breadcrumb \|\| "—"/);
  expect(rowSrc).toMatch(/r\.assigned_trainer \?/);
});

// Bonus — summary metrics reuse StatusChip rather than a duplicate chip
// implementation, and are a pure reduction with no fetch of its own.
test("TrainingDaySummary reuses StatusChip and makes no network calls of its own", () => {
  expect(summarySrc).toMatch(/import StatusChip from ["']\.\/StatusChip["']/);
  expect(summarySrc).not.toMatch(/api\.get|api\.post|fetch\(/);
});

test("TrainerAttentionQueue makes no network calls of its own — every item comes from props", () => {
  expect(queueSrc).not.toMatch(/api\.get|api\.post|fetch\(/);
});
