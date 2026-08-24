// Client School — Today command center.
//
// Today is intentionally not a dashboard: the server-derived current_action
// becomes one plain-English instruction and one primary button. Secondary
// practice/feedback/progress surfaces remain below it.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const cardsSrc = read("today", "TodayCards.jsx");
const homeSrc = read("StudentHome.jsx");
const appSrc = read("..", "..", "..", "screens", "SchoolApp.jsx");

// ---------------------------------------------------------------------------
// One primary action, derived from the server
// ---------------------------------------------------------------------------

test("Today turns the server-derived current_action into the one main CTA", () => {
  expect(homeSrc).toMatch(/const action = home\?\.current_action \|\| \{\}/);
  expect(homeSrc).toMatch(/actionCoachCopy\(action, home\?\.dog\?\.name\)/);
  expect(homeSrc).toMatch(/data-testid="today-command-center"/);
  expect(homeSrc).toMatch(/data-testid="today-primary-action"/);
  expect(homeSrc).toMatch(/\{action\.label \|\| "Continue Training"\}/);
});

test("states with no legitimate client action do not render the primary button", () => {
  expect(homeSrc).toMatch(/const noButton = \["awaiting_review", "access_expired", "course_paused", "setup_required"\]\.includes\(action\.type\)/);
  expect(homeSrc).toMatch(/\{!noButton && \(/);
});

// ---------------------------------------------------------------------------
// Honest metrics
// ---------------------------------------------------------------------------

test("the progress row shows only metrics the School model actually tracks", () => {
  for (const id of ["stat-program", "stat-lessons", "stat-checkpoints", "stat-badges"]) {
    expect(cardsSrc).toMatch(new RegExp(`testid="${id}"`));
  }
  expect(cardsSrc).toMatch(/p\.course_pct/);
  expect(cardsSrc).toMatch(/p\.lessons_completed/);
  expect(cardsSrc).toMatch(/p\.checkpoints_passed/);
});

test("the reference design's day-streak is deliberately NOT rendered", () => {
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  expect(stripComments(cardsSrc)).not.toMatch(/streak/i);
  expect(stripComments(homeSrc)).not.toMatch(/streak/i);
  expect((cardsSrc.match(/<StatTile/g) || [])).toHaveLength(4);
});

test("the badge tile counts real awarded trophies for THIS dog", () => {
  expect(homeSrc).toMatch(/api\.get\("\/portal\/trophies"\)/);
  expect(homeSrc).toMatch(/t\.dog_id === dogId \|\| t\.recipient_id === dogId/);
  expect(homeSrc).toMatch(/\.catch\(\(\) => \{ if \(live\) setTrophyCount\(0\); \}\)/);
});

// ---------------------------------------------------------------------------
// Practice states
// ---------------------------------------------------------------------------

test("practice renders due, overdue and all-caught-up states", () => {
  expect(cardsSrc).toMatch(/data-testid="today-practice-none"/);
  expect(cardsSrc).toMatch(/data-testid="today-practice-due"/);
  expect(cardsSrc).toMatch(/All caught up/);
  expect(cardsSrc).toMatch(/Due today to stay on track/);
});

test("overdue is derived from the assignment's own due date and is orange, not alarming", () => {
  expect(cardsSrc).toMatch(/const overdue = due && due < today/);
  expect(cardsSrc).toMatch(/data-overdue=\{overdue \? "true" : "false"\}/);
  expect(cardsSrc).toMatch(/border-shAccent\/45 bg-shAccent\/\[0\.06\]/);
  expect(cardsSrc).toMatch(/\.filter\(p => p && p\.status !== "completed"\)/);
});

// ---------------------------------------------------------------------------
// Privacy + data ownership
// ---------------------------------------------------------------------------

test("Today never renders staff-only content", () => {
  for (const forbidden of ["session_note", "trainer_note", "private", "internal", "grading_plan", "observed_live_by"]) {
    expect(cardsSrc.toLowerCase()).not.toContain(forbidden);
    expect(homeSrc.toLowerCase()).not.toContain(forbidden);
  }
  expect(homeSrc).toMatch(/<LatestFeedbackCard feedback=\{home\.latest_feedback\}/);
});

test("Today does not introduce a second data source", () => {
  const fetches = homeSrc.match(/api\.(get|post|put|delete)\(/g) || [];
  expect(fetches).toHaveLength(1);
  expect(homeSrc).toMatch(/api\.get\("\/portal\/trophies"\)/);
});

// ---------------------------------------------------------------------------
// Composition + wiring
// ---------------------------------------------------------------------------

test("Today is one command center followed by secondary support surfaces", () => {
  const order = ["TodayCommandCard", "PracticeCard", "NextMilestoneCard", "ProgressRow"];
  let last = -1;
  for (const name of order) {
    const i = homeSrc.indexOf(`<${name}`);
    expect(i).toBeGreaterThan(last);
    last = i;
  }
  expect(homeSrc).not.toMatch(/<ProgramHeroCard/);
  expect(homeSrc).not.toMatch(/<CurrentActionGuide/);
  expect(homeSrc).not.toMatch(/<CurrentLessonCard/);
});

test("the command center explains what to do now and keeps All Lessons secondary", () => {
  expect(homeSrc).toMatch(/Today's Next Step/);
  expect(homeSrc).toMatch(/What you do now/);
  expect(homeSrc).toMatch(/All lessons/);
  expect(homeSrc).toMatch(/School will tell you exactly what/);
});

test("a completed course replaces the daily action rather than stacking on it", () => {
  expect(homeSrc).toMatch(/const completed = home\.status === "completed"/);
  expect(homeSrc).toMatch(/\{completed \? \(/);
  expect(homeSrc).toMatch(/<CourseCompletionCard/);
  expect(homeSrc).toMatch(/\{!completed && <PracticeCard/);
});

test("navigation callbacks are wired from SchoolApp", () => {
  expect(appSrc).toMatch(/onViewCourse=\{\(\) => goView\("course"\)\}/);
  expect(appSrc).toMatch(/onOpenPractice=\{\(hw\) => openHomework\(hw\?\.id \|\| hw\)\}/);
});
