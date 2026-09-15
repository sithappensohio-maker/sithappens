// Training Hub (Pipeline) — source-level regression guards, matching this
// repo's established no-RTL convention (see trainingEntryPoints.test.js).
// Stage 11 replaced the Phase 5 dashboard row/summary/attention components
// with the Trainer Daily Queue; Stage 11.5 removed those retired files, so
// only the Pipeline-level wiring guards remain here.
import fs from "fs";
import path from "path";

const pipelineSrc = fs.readFileSync(path.join(__dirname, "Pipeline.jsx"), "utf8");

test("Stage 11 — Pipeline renders the Trainer Daily Queue from ONE aggregate request", () => {
  expect(pipelineSrc).toMatch(/import TrainerDayQueue from ["']\.\.\/components\/training\/TrainerDayQueue["']/);
  expect(pipelineSrc).toMatch(/api\.get\("\/admin\/training\/day"\)/);
  expect(pipelineSrc).not.toMatch(/api\.get\("\/admin\/training\/today"\)/);
  expect(pipelineSrc).not.toMatch(/api\.get\("\/admin\/school\/checkpoints\/pending"\)/);
  expect(pipelineSrc).toMatch(/<TrainerDayQueue[\s\S]*?day=\{day\} loading=\{dayLoading\}[\s\S]*?onAction=\{runDayAction\}/);
});

// 6. A failed /admin/training/day call leaves an explicit empty queue, never stale rows.
test("A failed /admin/training/day call clears the queue instead of leaving stale/partial data", () => {
  expect(pipelineSrc).toMatch(/catch \{ setDay\(\{ items: \[\], counts: \{\}, omitted: \["unavailable"\] \}\); \}/);
});

// 7. Existing workspace entry points are unchanged — the same
// TrainingSessionWorkspace covers the queue's booking-based flow and the
// lower pipeline list's dogId/enrollmentId flow.
test("Pipeline still opens the same TrainingSessionWorkspace for both booking-based and dogId/enrollmentId entry points", () => {
  expect(pipelineSrc).toMatch(/import TrainingSessionWorkspace from ["']\.\.\/components\/TrainingSessionWorkspace["']/);
  expect(pipelineSrc).toMatch(/if \(t\.booking_id\) setWorkspaceFor\(\{ bookingId: t\.booking_id \}\);/);
  expect(pipelineSrc).toMatch(/onOpenWorkspace=\{\(\) => setWorkspaceFor\(\{ dogId: r\.dog_id, enrollmentId: r\.id \}\)\}/);
  expect(pipelineSrc).toMatch(/<TrainingSessionWorkspace[\s\S]*?bookingId=\{workspaceFor\.bookingId\}[\s\S]*?dogId=\{workspaceFor\.dogId\}[\s\S]*?enrollmentId=\{workspaceFor\.enrollmentId\}/);
});

// 8. Review tools deep-link to the exact item and every close reloads the queue.
test("Pipeline deep-links each review tool to the item and reloads the day on close", () => {
  expect(pipelineSrc).toMatch(/<CheckpointReviewQueue initialSubmissionId=\{checkpointFor\.submissionId \|\| null\}/);
  expect(pipelineSrc).toMatch(/<SchoolReviewsPanel initialTarget=\{\{ section_log_id: practiceFor\.section_log_id \}\}/);
  expect(pipelineSrc).toMatch(/<DailyReviewQueue initialItem=\{dailyFor\}/);
  expect(pipelineSrc).toMatch(/<TrainerAssistQueue initialSubmissionId=\{assistFor\.submissionId \|\| null\}/);
  for (const close of ["setCheckpointFor(null); loadDay();", "setPracticeFor(null); loadDay();", "setDailyFor(null); loadDay();", "setAssistFor(null); loadDay();"]) expect(pipelineSrc).toContain(close);
  expect(pipelineSrc).toMatch(/onSaved=\{\(\) => \{ setWorkspaceFor\(null\); loadDay\(\); load\(\); \}\}/);
});

// 9. The old today-roster list is gone — one list of cards per section, from the queue component.
// 10. The primary action is reachable on mobile — never hidden behind a
// desktop-only breakpoint class — and the row degrades gracefully when
// optional fields (legacy/incomplete rows) are missing.
// Bonus — summary metrics reuse StatusChip rather than a duplicate chip
// implementation, and are a pure reduction with no fetch of its own.