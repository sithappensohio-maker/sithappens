// School HQ Activity — organized for real client volume — source-level
// regression guards (repo convention).
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const centerSrc = read("school", "SchoolActivityCenter.jsx");
const hqSrc = read("..", "screens", "SchoolHQ.jsx");
const tabsSrc = read("admin", "AdminTabs.jsx");

test("the Activity tab uses the volume-ready center, not the flat event stream", () => {
  expect(hqSrc).toMatch(/tab === "activity" && \(\s*<SchoolActivityCenter/);
});

test("filter bar covers search, activity type, date range, and Needs Attention Only — all server-side params", () => {
  expect(centerSrc).toMatch(/-search/);
  expect(centerSrc).toMatch(/type_category: typeCat/);
  expect(centerSrc).toMatch(/attention_only: true/);
  expect(centerSrc).toMatch(/rangeToDates\(range\)/);
  expect(centerSrc).toMatch(/q: query/);
  // Filters change the REQUEST, never merely filter loaded rows.
  expect(centerSrc).toMatch(/api\.get\("\/admin\/school\/hq\/activity", \{ params \}\)/);
});

test("activity type filter includes the required categories", () => {
  for (const cat of ["lesson_completed", "practice_completed", "practice_problem",
                     "checkpoint_submitted", "trainer_review", "trainer_assist", "course_completed"]) {
    expect(centerSrc).toContain(`"${cat}"`);
  }
});

test("events arrive pre-bundled (grouped: true) with expandable raw events per card", () => {
  expect(centerSrc).toMatch(/grouped: true/);
  expect(centerSrc).toMatch(/group\.event_count > 1/);
  expect(centerSrc).toMatch(/-events/);
  expect(centerSrc).toMatch(/View Activity/);
  expect(centerSrc).toMatch(/View Student/);
});

test("the feed is sectioned by time: TODAY / YESTERDAY / EARLIER THIS WEEK / OLDER", () => {
  expect(centerSrc).toMatch(/"TODAY"/);
  expect(centerSrc).toMatch(/"YESTERDAY"/);
  expect(centerSrc).toMatch(/"EARLIER THIS WEEK"/);
  expect(centerSrc).toMatch(/"OLDER"/);
});

test("summary tiles sit above the feed and clicking one filters it", () => {
  expect(centerSrc).toMatch(/active_students_today/);
  expect(centerSrc).toMatch(/practices_today/);
  expect(centerSrc).toMatch(/lessons_completed_today/);
  expect(centerSrc).toMatch(/checkpoints_submitted_today/);
  expect(centerSrc).toMatch(/needs_attention/);
  expect(centerSrc).toMatch(/setTypeCat\("practice_completed"\); setRange\("today"\)/);
});

test("Group by Student mode exists with per-dog rollups and expandable timelines", () => {
  expect(centerSrc).toMatch(/-group-by-student/);
  expect(centerSrc).toMatch(/\/admin\/school\/hq\/activity\/students/);
  expect(centerSrc).toMatch(/activities_today/);
  expect(centerSrc).toMatch(/today_learn/);
  expect(centerSrc).toMatch(/client_id: s\.client_id, dog_id: s\.dog_id/);
});

test("exceptions stand out: attention groups use the accent style, normal success stays quiet", () => {
  expect(centerSrc).toMatch(/requires_attention/);
  expect(centerSrc).toMatch(/border-shAccent\/50 bg-shAccent\/\[0\.05\]/);
  expect(centerSrc).toMatch(/Needs attention/);
});

test("pagination is cursor-based Load More — never the whole history in the browser", () => {
  expect(centerSrc).toMatch(/-load-more/);
  expect(centerSrc).toMatch(/before: cursor/);
  expect(centerSrc).toMatch(/limit: 50/);
});

test("tab badges hide entirely at zero — no noisy 0 chips", () => {
  expect(tabsSrc).toMatch(/item\.count != null && item\.count > 0 &&/);
});
