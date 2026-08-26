import { computeDaySummary, resolvePrimaryAction, buildAttentionQueue, filterTrainingRows, relativeAge } from "./trainerDashboardPolish";

const row = (overrides = {}) => ({
  booking_id: "b1", time: "9:00 AM", dog_id: "d1", dog_name: "Rex", client_name: "Jane",
  checked_in: false, session_status: "not_checked_in", resolution_reason: null,
  client_question: null, media_awaiting_review: 0, homework_difficulty_flags: 0,
  needs_reassessment_count: 0, reopen_count: 0, draft_created_at: null,
  assigned_trainer_id: "trainer-1", assigned_trainer: "Alex Trainer",
  ...overrides,
});

test("computeDaySummary reduces rows into the header metrics", () => {
  const rows = [
    row({ booking_id: "b1", checked_in: true, session_status: "plan_ready" }),
    row({ booking_id: "b2", checked_in: true, session_status: "in_progress" }),
    row({ booking_id: "b3", session_status: "completed", checked_in: true }),
    row({ booking_id: "b4", client_question: "Is this normal?" }),
  ];
  const summary = computeDaySummary(rows);
  expect(summary.trainingToday).toBe(4);
  expect(summary.checkedIn).toBe(3);
  expect(summary.plansReady).toBe(1);
  expect(summary.inProgress).toBe(1);
  expect(summary.completed).toBe(1);
  expect(summary.needsReview).toBe(1);
});

test("resolvePrimaryAction: not checked in and no draft shows Check In", () => {
  expect(resolvePrimaryAction(row())).toEqual({ label: "Check In", kind: "check_in" });
});

test("resolvePrimaryAction: an unassigned dog must be assigned before training starts", () => {
  expect(resolvePrimaryAction(row({ assigned_trainer_id: null, assigned_trainer: null }))).toEqual({ label: "Assign Trainer", kind: "assign_trainer" });
});

test("resolvePrimaryAction: checked in but still not_checked_in status (no draft yet) shows Open Plan", () => {
  expect(resolvePrimaryAction(row({ checked_in: true }))).toEqual({ label: "Open Plan", kind: "open_workspace" });
});

test("resolvePrimaryAction: plan_ready shows Continue Session, or Resume Draft if reopened", () => {
  expect(resolvePrimaryAction(row({ session_status: "plan_ready" }))).toEqual({ label: "Continue Session", kind: "open_workspace" });
  expect(resolvePrimaryAction(row({ session_status: "plan_ready", reopen_count: 1 }))).toEqual({ label: "Resume Draft", kind: "open_workspace" });
});

test("resolvePrimaryAction: in_progress, completed, and resolution_needed map to their own single action", () => {
  expect(resolvePrimaryAction(row({ session_status: "in_progress" })).label).toBe("Continue Session");
  expect(resolvePrimaryAction(row({ session_status: "completed" })).label).toBe("View Completed Session");
  expect(resolvePrimaryAction(row({ session_status: "resolution_needed" })).label).toBe("Resolve");
});

test("a completed session never shows a Start/Check-In action", () => {
  const action = resolvePrimaryAction(row({ session_status: "completed" }));
  expect(action.label).not.toMatch(/Check In|Start/i);
});

test("buildAttentionQueue surfaces an unanswered client question", () => {
  const items = buildAttentionQueue([row({ client_question: "Is this normal?" })]);
  expect(items.find(i => i.key === "question-b1")).toMatchObject({ dogName: "Rex", actionLabel: "Review Homework" });
});

test("buildAttentionQueue surfaces resolution_needed distinctly and skips other checks for that row", () => {
  const items = buildAttentionQueue([row({ session_status: "resolution_needed", resolution_reason: "no_active_enrollment", client_question: "hi" })]);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ reason: "No active training program", actionLabel: "Resolve" });
});

test("buildAttentionQueue surfaces reopened sessions and needs-reassessment flags", () => {
  const items = buildAttentionQueue([
    row({ booking_id: "b5", session_status: "in_progress", reopen_count: 2 }),
    row({ booking_id: "b6", needs_reassessment_count: 3 }),
  ]);
  expect(items.find(i => i.key === "reopened-b5")).toBeTruthy();
  expect(items.find(i => i.key === "reassess-b6").reason).toMatch(/3 skills/);
});

test("buildAttentionQueue flags a stale plan_ready draft by age, not a fresh one", () => {
  const stale = row({ booking_id: "b7", session_status: "plan_ready", draft_created_at: new Date(Date.now() - 90 * 60000).toISOString() });
  const fresh = row({ booking_id: "b8", session_status: "plan_ready", draft_created_at: new Date().toISOString() });
  const items = buildAttentionQueue([stale, fresh]);
  expect(items.find(i => i.key === "stale-b7")).toBeTruthy();
  expect(items.find(i => i.key === "stale-b8")).toBeFalsy();
});

test("filterTrainingRows: my_dogs matches the viewer's real assigned trainer id", () => {
  const rows = [row({ booking_id: "b1", assigned_trainer_id: "trainer-1" }), row({ booking_id: "b2", assigned_trainer_id: "trainer-2", assigned_trainer: "Someone Else" })];
  const result = filterTrainingRows(rows, "my_dogs", { id: "trainer-1", name: "Alex Trainer" });
  expect(result.map(r => r.booking_id)).toEqual(["b1"]);
});

test("filterTrainingRows: status filters match the exact session_status", () => {
  const rows = [row({ booking_id: "b1", session_status: "plan_ready" }), row({ booking_id: "b2", session_status: "completed" })];
  expect(filterTrainingRows(rows, "ready").map(r => r.booking_id)).toEqual(["b1"]);
  expect(filterTrainingRows(rows, "completed").map(r => r.booking_id)).toEqual(["b2"]);
});

test("filterTrainingRows: needs_review includes resolution_needed rows too", () => {
  const rows = [row({ booking_id: "b1", session_status: "resolution_needed" }), row({ booking_id: "b2", media_awaiting_review: 1 })];
  expect(filterTrainingRows(rows, "needs_review").map(r => r.booking_id).sort()).toEqual(["b1", "b2"]);
});

test("relativeAge formats minutes and hours", () => {
  expect(relativeAge(new Date(Date.now() - 30000).toISOString())).toBe("Just now");
  expect(relativeAge(new Date(Date.now() - 10 * 60000).toISOString())).toBe("10m ago");
  expect(relativeAge(new Date(Date.now() - 3 * 3600000).toISOString())).toBe("3h ago");
});
