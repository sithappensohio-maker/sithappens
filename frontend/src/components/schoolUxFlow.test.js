// Online School UX fix — portal hero prominence + Finish Practice flow —
// source-level regression guards (repo convention: assert the exact
// implementing patterns, no rendering).
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const heroSrc = read("school", "OnlineSchoolHeroCard.jsx");
const portalSrc = read("..", "screens", "Portal.jsx");
const practiceSrc = read("training", "PracticePanel.jsx");
const schoolAppSrc = read("..", "screens", "SchoolApp.jsx");

// ---------------------------------------------------------------------------
// 1. Portal hero — School dominates the dashboard
// ---------------------------------------------------------------------------

test("the Online School hero renders full-width ABOVE the portal column grid, not buried inside it", () => {
  const heroAt = portalSrc.indexOf("<OnlineSchoolHeroCard");
  const gridAt = portalSrc.indexOf('"grid grid-cols-1 md:grid-cols-3 gap-8"');
  expect(heroAt).toBeGreaterThan(-1);
  expect(gridAt).toBeGreaterThan(-1);
  expect(heroAt).toBeLessThan(gridAt);
});

test("the old slim teaser card is gone", () => {
  expect(portalSrc).not.toMatch(/online-school-teaser/);
});

test("hero shows course name, Week/Module X of Y, big progress bar, percentage, and next lesson", () => {
  expect(heroSrc).toMatch(/Sit Happens Online School/);
  expect(heroSrc).toMatch(/-course-name/);
  expect(heroSrc).toMatch(/\$\{unit\} \$\{e\.module_number \?\? 1\} of \$\{e\.modules_total\}/);
  expect(heroSrc).toMatch(/-progress/);
  expect(heroSrc).toMatch(/-pct/);
  expect(heroSrc).toMatch(/-up-next/);
  // Week vs Module label comes from the module's own name, not a guess.
  expect(heroSrc).toMatch(/\^week.*current_module_name/i);
});

test("the CTA is state-dependent: Start Today's Training / Continue Training / View Course", () => {
  expect(heroSrc).toMatch(/Start Today's Training/);
  expect(heroSrc).toMatch(/Continue Training/);
  expect(heroSrc).toMatch(/View Course/);
  expect(heroSrc).toMatch(/current_lesson_practiced/);
});

test("hero layout is two-column on desktop and stacks with a wide CTA on mobile", () => {
  expect(heroSrc).toMatch(/grid-cols-1 lg:grid-cols-2/);
  expect(heroSrc).toMatch(/w-full lg:w-auto/);
});

// ---------------------------------------------------------------------------
// 2-4. Finish Practice — completion is a workflow, not a popup
// ---------------------------------------------------------------------------

test("a successful Finish Practice replaces the form with the inline completion state (no success toast to dismiss)", () => {
  expect(practiceSrc).toMatch(/setViewMode\("complete"\)/);
  expect(practiceSrc).toMatch(/data-testid="practice-complete-state"/);
  expect(practiceSrc).not.toMatch(/toast\.success\("Practice logged"\)/);
});

test("School-hosted completion auto-routes after a brief transition; generic homework gets one obvious CONTINUE", () => {
  expect(practiceSrc).toMatch(/Updating your training plan/);
  expect(practiceSrc).toMatch(/setTimeout\(\(\) => onCompleted\(\), 1400\)/);
  expect(practiceSrc).toMatch(/data-testid="practice-complete-continue"/);
});

test("double-clicking Finish Practice cannot double-submit", () => {
  expect(practiceSrc).toMatch(/if \(saveState === "saving" \|\| saveState === "saved"\) return/);
});

test("one completion action: mark-complete no longer sits beside Finish Practice — it lives in the completion state", () => {
  // It must appear exactly once, inside the complete-state branch.
  const matches = practiceSrc.match(/practice-mark-assignment-complete/g) || [];
  expect(matches.length).toBe(1);
  const completeAt = practiceSrc.indexOf('data-testid="practice-complete-state"');
  const markAt = practiceSrc.indexOf("practice-mark-assignment-complete");
  expect(markAt).toBeGreaterThan(completeAt);
  expect(practiceSrc).toMatch(/mark it complete/);
});

// ---------------------------------------------------------------------------
// 5. Routing follows the backend, never frontend math
// ---------------------------------------------------------------------------

test("SchoolApp routes post-completion from the refreshed backend current_action ladder", () => {
  expect(schoolAppSrc).toMatch(/const practiceCompleted = useCallback/);
  expect(schoolAppSrc).toMatch(/api\.get\(`\/portal\/school\/\$\{selectedId\}\/home`\)/);
  expect(schoolAppSrc).toMatch(/freshHome\?\.current_action/);
  expect(schoolAppSrc).toMatch(/onCompleted=\{practiceCompleted\}/);
  // Every branch keys off act.type — no "next lesson = current + 1" math.
  expect(schoolAppSrc).not.toMatch(/lesson_index\s*\+\s*1|currentLessonIdx\s*\+\s*1/);
});

test("post-completion destinations cover practice, remediation, checkpoint, quiz, course completion, and Today", () => {
  const fn = schoolAppSrc.slice(schoolAppSrc.indexOf("const practiceCompleted"), schoolAppSrc.indexOf("// ── One router"));
  expect(fn).toMatch(/t === "practice"/);
  expect(fn).toMatch(/t === "remediation"/);
  expect(fn).toMatch(/t === "submit_checkpoint"/);
  expect(fn).toMatch(/t === "module_quiz"/);
  expect(fn).toMatch(/t === "course_complete"/);
  expect(fn).toMatch(/go\("today"\)/);
});
