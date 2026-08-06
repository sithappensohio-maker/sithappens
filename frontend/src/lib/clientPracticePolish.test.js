import { assignmentCardModel, sortAssignments, groupByDog, weeklyPracticeStats } from "./clientPracticePolish";

const dailyTrackerHw = (overrides = {}) => ({
  id: "hw-daily", dog_id: "dog-1", dog_name: "Lexi", title: "Down-Stay Practice",
  daily_tracker: true, status: "assigned", due_date: "2099-01-01", streak: 2,
  daily_progress: [
    { day_number: 1, status: "submitted", log: { date: "2026-01-01", difficulty: "good", questions: [] } },
    { day_number: 2, status: "available", log: null },
    { day_number: 3, status: "locked", log: null },
  ],
  ...overrides,
});

const sectionLogHw = (overrides = {}) => ({
  id: "hw-section", dog_id: "dog-2", dog_name: "Biscuit", title: "Sit Practice",
  daily_tracker: false, status: "assigned", due_date: "2099-01-01",
  template_snapshot: { sections: [{ id: "sit_reps", title: "Sit", instructions: "1. Cue.\n2. Reward.", fields: [{ id: "reps", label: "Reps", kind: "reps", target: 10 }] }] },
  section_logs: [],
  ...overrides,
});

// 1. Existing assignment data renders as a practice card model (status +
// primary action are always defined for real-shaped homework docs).
test("assignmentCardModel produces a card model for daily-tracker homework", () => {
  const m = assignmentCardModel(dailyTrackerHw());
  expect(m.status).toBe("in_progress"); // day 1 submitted, day 2 available
  expect(m.primaryAction).toBe("Continue");
  expect(m.sessionsRequired).toBe("Day 2 of 3");
});

test("assignmentCardModel produces a card model for section-log homework", () => {
  const m = assignmentCardModel(sectionLogHw());
  expect(m.status).toBe("not_started");
  expect(m.primaryAction).toBe("Start Practice");
});

test("assignmentCardModel marks a completed daily-tracker as completed/Review", () => {
  const m = assignmentCardModel(dailyTrackerHw({ status: "completed" }));
  expect(m.status).toBe("completed");
  expect(m.primaryAction).toBe("Review");
});

test("assignmentCardModel surfaces a needs_redo day distinctly", () => {
  const hw = dailyTrackerHw({ daily_progress: [{ day_number: 1, status: "needs_redo", log: { date: "2026-01-01" } }] });
  const m = assignmentCardModel(hw);
  expect(m.status).toBe("needs_redo");
  expect(m.primaryAction).toBe("Try Again");
});

// overdue is reserved for a genuine warning, never applied to completed work
test("assignmentCardModel marks a past-due, incomplete assignment overdue but never a completed one", () => {
  const overdue = assignmentCardModel(sectionLogHw({ due_date: "2020-01-01" }));
  expect(overdue.status).toBe("overdue");
  const doneButPastDue = assignmentCardModel(sectionLogHw({ due_date: "2020-01-01", status: "completed" }));
  expect(doneButPastDue.status).toBe("completed");
});

// 4 / 5. Missing optional fields (no video, no due date, empty sections) never
// throw and never produce a truthy value where there's nothing to show.
test("assignmentCardModel tolerates missing optional fields without crashing", () => {
  const bare = { id: "hw-bare", dog_id: "dog-1", dog_name: "Lexi", title: "Bare", daily_tracker: false, status: "assigned" };
  expect(() => assignmentCardModel(bare)).not.toThrow();
  const m = assignmentCardModel(bare);
  expect(m.sessionsRequired).toBeFalsy();
  expect(m.attentionLabel).toBeFalsy();
});

// 2. One assignment appears only once — sortAssignments/groupByDog never
// duplicate or drop an item; every input id appears in the output exactly once.
test("sortAssignments preserves every assignment exactly once", () => {
  const list = [dailyTrackerHw(), sectionLogHw(), dailyTrackerHw({ id: "hw-daily-2", status: "completed" })];
  const sorted = sortAssignments(list);
  expect(sorted.map(h => h.id).sort()).toEqual(list.map(h => h.id).sort());
  expect(sorted.length).toBe(list.length);
});

// 3. Multiple dogs are visually distinguishable — grouping never blends two
// dogs' assignments into one group, and never drops or duplicates items.
test("groupByDog groups assignments under the correct dog and never blends or duplicates", () => {
  const list = [dailyTrackerHw(), sectionLogHw()];
  const dogs = [{ id: "dog-1", name: "Lexi" }, { id: "dog-2", name: "Biscuit" }];
  const groups = groupByDog(list, dogs);
  expect(groups.length).toBe(2);
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);
  expect(totalItems).toBe(list.length);
  const lexiGroup = groups.find(g => g.dog.id === "dog-1");
  expect(lexiGroup.items.map(i => i.id)).toEqual(["hw-daily"]);
});

test("groupByDog omits dogs with no assignments (no empty card group)", () => {
  const dogs = [{ id: "dog-1", name: "Lexi" }, { id: "dog-3", name: "No Homework Dog" }];
  const groups = groupByDog([dailyTrackerHw()], dogs);
  expect(groups.length).toBe(1);
  expect(groups[0].dog.id).toBe("dog-1");
});

// 6. Weekly stats reuse the backend's own `streak` field — never recomputed.
test("weeklyPracticeStats takes the max of the server-provided streak, not a recomputed one", () => {
  const stats = weeklyPracticeStats([dailyTrackerHw({ streak: 5 }), dailyTrackerHw({ id: "hw-2", streak: 2 })]);
  expect(stats.streak).toBe(5);
});

test("weeklyPracticeStats counts today/week activity from existing logs only", () => {
  const stats = weeklyPracticeStats([sectionLogHw(), dailyTrackerHw()]);
  expect(typeof stats.todayTotal).toBe("number");
  expect(typeof stats.weekCompleted).toBe("number");
  expect(stats.todayTotal).toBeGreaterThanOrEqual(0);
});
