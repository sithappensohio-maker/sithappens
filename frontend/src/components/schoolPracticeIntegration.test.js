/**
 * School Practice reaches the engagement surfaces: per-session activity,
 * no nagging a plan practiced today, per-channel progress numbers, and a
 * timeline kind for practice sessions.
 */
import fs from "fs";
import path from "path";
import { buildPortalActivity, buildPortalPriority, isPracticeSessionLog, practicedOn } from "./PortalEngagementHub";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const today = new Date().toISOString().slice(0, 10);
const schoolRow = {
  id: "hw1", dog_id: "d1", dog_name: "Rex", title: "Sit practice", status: "assigned", created_at: "2026-01-01T00:00:00Z",
  section_logs: [
    { id: "a", date: today, logged_at: `${today}T18:00:00Z`, note: "nailed it" },
    { id: "b", date: "2026-01-02", logged_at: "2026-01-02T18:00:00Z" },
    { id: "rest", date: "2026-01-03", is_rest_day: true },
    { id: "draft", date: "2026-01-04", submission_status: "draft" },
  ],
};

test("real practice sessions are recognised like the backend rule", () => {
  expect(isPracticeSessionLog(schoolRow, schoolRow.section_logs[0])).toBe(true);
  expect(isPracticeSessionLog(schoolRow, schoolRow.section_logs[2])).toBe(false);
  expect(isPracticeSessionLog(schoolRow, schoolRow.section_logs[3])).toBe(false);
  expect(isPracticeSessionLog({ daily_tracker: true }, { submission_status: "submitted" })).toBe(true);
  expect(isPracticeSessionLog({ daily_tracker: true }, { section_id: "day-1" })).toBe(false);
  expect(practicedOn(schoolRow, today)).toBe(true);
  expect(practicedOn(schoolRow, "2026-01-03")).toBe(false);
});

test("activity feed emits one item per practice session", () => {
  const items = buildPortalActivity({ bookings: [], homework: [schoolRow] });
  const practice = items.filter((i) => i.id.startsWith("practice-hw1-"));
  expect(practice).toHaveLength(2);
  expect(practice[0].title).toMatch(/Rex practiced Sit practice/);
});

test("priority card does not pin a plan practiced today", () => {
  const dogs = [{ id: "d1", name: "Rex", vaccines: { rabies: "2099-01-01", bordetella: "2099-01-01", dhpp: "2099-01-01" } }];
  const p = buildPortalPriority({ dogs, bookings: [], homework: [schoolRow], showHomework: true });
  expect(p?.kind).not.toBe("homework");
  const notToday = { ...schoolRow, section_logs: [schoolRow.section_logs[1]] };
  const p2 = buildPortalPriority({ dogs, bookings: [], homework: [notToday], showHomework: true });
  expect(p2?.kind).toBe("homework");
});

test("progress surfaces use the per-channel progress number", () => {
  const tab = read("DogTrainingTab.jsx");
  expect(tab).toMatch(/e\.progress_pct \?\? e\.mastered_pct/);
  expect(tab).toMatch(/lessons completed/);
  const history = read("school", "student", "LessonHistoryScreen.jsx");
  expect(history).toMatch(/progress\.progress_pct \?\? progress\.mastered_pct/);
  const preview = read("ClientPortalPreview.jsx");
  expect(preview).toMatch(/e\.progress_pct \?\? e\.mastered_pct/);
  const timeline = read("DogTimeline.jsx");
  expect(timeline).toMatch(/practice_session:/);
});
