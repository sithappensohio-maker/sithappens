// Client School — redesigned Today surface.
//
// Phase 1 of the client-experience redesign: the Today/Home screen and the
// card family it introduces. Rendered behaviour was verified in the browser at
// 1440x900, 1024x768, 390x844 and 320x568 against a real enrolled client.
//
// The redesign is presentational: /portal/school/{id}/home is unchanged and
// current_action still decides the primary CTA. These tests protect the two
// things that could quietly regress — the honesty of the metrics, and the
// delivery-mode/privacy rules the brief calls non-negotiable.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const cardsSrc = read("today", "TodayCards.jsx");
const homeSrc = read("StudentHome.jsx");
const appSrc = read("..", "..", "..", "screens", "SchoolApp.jsx");

// ---------------------------------------------------------------------------
// One primary action, derived from the server
// ---------------------------------------------------------------------------

test("the primary CTA comes from the server-derived current_action, not local guessing", () => {
  expect(cardsSrc).toMatch(/const action = home\?\.current_action \|\| \{\}/);
  expect(cardsSrc).toMatch(/\{action\.label \|\| "Continue lesson"\}/);
  expect(cardsSrc).toMatch(/data-testid="today-primary-action"/);
});

test("states with no legitimate client action do not render a primary CTA", () => {
  // awaiting_review / access_expired / setup_required / course_paused are
  // states where the client genuinely cannot act — offering a button would be
  // a lie, and for access_expired it would imply access they do not have.
  expect(cardsSrc).toMatch(/const noAction = \["awaiting_review", "access_expired", "setup_required", "course_paused"\]\.includes\(action\.type\)/);
  expect(cardsSrc).toMatch(/\{!noAction && \(/);
});

// ---------------------------------------------------------------------------
// Honest metrics — the brief forbids inventing what the backend cannot track
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
  // Nothing in the School model records a practice streak. The mockup shows
  // one; implementing it would mean fabricating a number. Comments are
  // stripped first so the note explaining the omission does not trip this.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  expect(stripComments(cardsSrc)).not.toMatch(/streak/i);
  expect(stripComments(homeSrc)).not.toMatch(/streak/i);
  // and there is no fifth stat tile smuggling one in
  expect((cardsSrc.match(/<StatTile/g) || [])).toHaveLength(4);
});

test("the badge tile counts real awarded trophies for THIS dog", () => {
  expect(homeSrc).toMatch(/api\.get\("\/portal\/trophies"\)/);
  expect(homeSrc).toMatch(/t\.dog_id === dogId \|\| t\.recipient_id === dogId/);
  // a trophy lookup failure must not break the day's plan
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
  // completed practice is never shown as outstanding work
  expect(cardsSrc).toMatch(/\.filter\(p => p && p\.status !== "completed"\)/);
});

// ---------------------------------------------------------------------------
// Dog media rules
// ---------------------------------------------------------------------------

test("the hero uses the dog's real photo and falls back to brand artwork", () => {
  // The brief forbids shipping stock dog imagery to match the mockup.
  expect(cardsSrc).toMatch(/dog\.photo\s*\n?\s*\? <img src=\{dog\.photo\}/);
  expect(cardsSrc).toMatch(/<HuskyDogImage/);
  expect(cardsSrc).not.toMatch(/unsplash|placeholder\.com|pexels/i);
});

// ---------------------------------------------------------------------------
// Delivery mode + privacy stay canonical
// ---------------------------------------------------------------------------

test("delivery mode is labelled through the shared helper, not re-derived", () => {
  expect(cardsSrc).toMatch(/deliveryIcon\(home\?\.delivery_mode\)/);
  expect(cardsSrc).toMatch(/deliveryLabel\(home\?\.delivery_mode\)/);
});

test("Today never renders staff-only content", () => {
  for (const forbidden of ["session_note", "trainer_note", "private", "internal", "grading_plan", "observed_live_by"]) {
    expect(cardsSrc.toLowerCase()).not.toContain(forbidden);
  }
  // trainer feedback keeps flowing through the existing client-safe card
  expect(homeSrc).toMatch(/<LatestFeedbackCard feedback=\{home\.latest_feedback\}/);
});

test("Today does not introduce a second data source", () => {
  // Everything but the trophy count comes from the existing home view-model.
  const fetches = homeSrc.match(/api\.(get|post|put|delete)\(/g) || [];
  expect(fetches).toHaveLength(1);
  expect(homeSrc).toMatch(/api\.get\("\/portal\/trophies"\)/);
});

// ---------------------------------------------------------------------------
// Composition + wiring
// ---------------------------------------------------------------------------

test("the composition follows the brief's priority order", () => {
  const order = ["ProgramHeroCard", "CurrentLessonCard", "PracticeCard", "NextMilestoneCard", "ProgressRow"];
  let last = -1;
  for (const name of order) {
    const i = homeSrc.indexOf(`<${name}`);
    expect(i).toBeGreaterThan(last);
    last = i;
  }
});

test("a completed course replaces the daily plan rather than stacking on it", () => {
  expect(homeSrc).toMatch(/const completed = home\.status === "completed"/);
  expect(homeSrc).toMatch(/\{completed \? \(\s*\n?\s*<CourseCompletionCard/);
  expect(homeSrc).toMatch(/\{!completed && <PracticeCard/);
});

test("the new navigation callbacks are wired from SchoolApp", () => {
  expect(appSrc).toMatch(/onViewCourse=\{\(\) => goView\("course"\)\}/);
  expect(appSrc).toMatch(/onOpenPractice=\{\(hw\) => openHomework\(hw\?\.id \|\| hw\)\}/);
});

test("the redesign composes the existing premium system rather than a second one", () => {
  expect(cardsSrc).toMatch(/from "\.\.\/\.\.\/\.\.\/premium\/tokens"/);
  // no hand-rolled hex palette competing with tokens.js
  expect(cardsSrc).not.toMatch(/#[0-9a-fA-F]{6}(?!\])/);
});
