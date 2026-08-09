// Sit Happens Online School (Phase 1) — source-level regression guards,
// matching this repo's established convention (see
// coachModeEntryPoints.test.js / portalPracticeEntryPoints.test.js /
// trainingEntryPoints.test.js): no React Testing Library rendering —
// behaviors that depend on component wiring are verified by asserting the
// source contains the exact pattern that implements them. Live interaction
// is verified in the browser as part of the release report.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const portalSrc = read("..", "screens", "Portal.jsx");
const dashboardSrc = read("OnlineSchoolDashboard.jsx");
const dogTrainingTabSrc = read("DogTrainingTab.jsx");
const programStudioSrc = read("ProgramStudio.jsx");
const polishSrc = read("..", "lib", "onlineSchoolPolish.js");

// ---------------------------------------------------------------------------
// Entry point — appears only when appropriate, never buried in "More"
// ---------------------------------------------------------------------------

test("the Online School teaser renders only when schoolEntries is non-empty", () => {
  expect(portalSrc).toMatch(/\{schoolEntries\.length > 0 && \(/);
});

test("the teaser is NOT gated behind the More-toggle wrapper the way secondary sections are", () => {
  // The teaser block must appear before the first `moreOpen` wrapper div in
  // source order — i.e. it's prominent, not tucked away.
  const teaserIdx = portalSrc.indexOf("online-school-teaser");
  const firstMoreWrapperIdx = portalSrc.indexOf('data-testid="portal-more-homeworkstreak-plans"');
  expect(teaserIdx).toBeGreaterThan(-1);
  expect(firstMoreWrapperIdx).toBeGreaterThan(-1);
  expect(teaserIdx).toBeLessThan(firstMoreWrapperIdx);
});

test("opening the dashboard fetches the client's own /portal/school data, no second progress store", () => {
  expect(dashboardSrc).toMatch(/api\.get\("\/portal\/school"\)/);
  expect(dashboardSrc).toMatch(/api\.get\(`\/portal\/school\/\$\{id\}`\)/);
});

test("Portal.jsx loads schoolEntries from the same batched loadAll fetch as everything else", () => {
  expect(portalSrc).toMatch(/api\.get\("\/portal\/school"\)\.catch\(\(\)=>\(\{data:\[\]\}\)\)/);
  expect(portalSrc).toMatch(/setSchoolEntries\(schRes\.data \|\| \[\]\)/);
});

// ---------------------------------------------------------------------------
// Dashboard — next action, roadmap, locked states, Continue Training
// ---------------------------------------------------------------------------

test("the hero identifies the next action from real data, never a hardcoded lesson name", () => {
  expect(dashboardSrc).toMatch(/nextActionLabel|heroCurrentLessonName/);
  expect(dashboardSrc).toMatch(/formatCompletionPct\(heroMasteredPct\)/);
});

test("the hero prefers freshly-loaded detail over the stale list entry, so it never lags the roadmap after an advance", () => {
  expect(dashboardSrc).toMatch(/const heroMasteredPct = detail \? detail\.mastered_pct : entry\.mastered_pct/);
  expect(dashboardSrc).toMatch(/const heroCurrentLessonName = roadmap \? \(roadmap\.current_lesson\?\.name \|\| null\) : entry\.current_lesson_name/);
});

test("Continue Training opens the current lesson, and its label reflects roadmap.is_final_lesson", () => {
  expect(dashboardSrc).toMatch(/data-testid="school-continue-training"/);
  expect(dashboardSrc).toMatch(/continueButtonLabel\(roadmap\)/);
});

test("the roadmap reuses the shared ProgramRoadmap/LessonCard components — no duplicate roadmap UI", () => {
  expect(dashboardSrc).toMatch(/import ProgramRoadmap from ".\/training\/ProgramRoadmap"/);
  expect(dashboardSrc).toMatch(/import LessonCard from ".\/training\/LessonCard"/);
  expect(dashboardSrc).toMatch(/import LessonDetailPanel from ".\/training\/LessonDetailPanel"/);
  expect(dashboardSrc).toMatch(/<ProgramRoadmap/);
});

test("a locked module renders its locked_reason via EmptyState, never a bare padlock with no explanation", () => {
  expect(dashboardSrc).toMatch(/message=\{m\.lockedReason\}/);
});

test("a locked lesson card is passed its real lockedReason text, not a generic string", () => {
  expect(dashboardSrc).toMatch(/lockedReason=\{card\.status === "locked" \? card\.lockedReason : null\}/);
});

test("locked lessons never get an action — onAction/actionLabel are both gated on status !== locked", () => {
  expect(dashboardSrc).toMatch(/actionLabel=\{card\.status !== "locked" \?/);
  expect(dashboardSrc).toMatch(/onAction=\{card\.status !== "locked" \?/);
});

test("no lesson content renders without first fetching the server's own locked-enforcing endpoint", () => {
  expect(dashboardSrc).toMatch(/api\.get\(`\/portal\/school\/\$\{activeId\}\/lessons\/\$\{lessonId\}`\)/);
});

// ---------------------------------------------------------------------------
// Practice Coach handoff — never forked
// ---------------------------------------------------------------------------

test("start-practice calls the school-specific endpoint then opens the EXACT SAME PracticePanel used elsewhere", () => {
  expect(dashboardSrc).toMatch(/import PracticePanel from ".\/training\/PracticePanel"/);
  expect(dashboardSrc).toMatch(/start-practice`\)/);
  expect(dashboardSrc).toMatch(/api\.get\(`\/homework\/\$\{data\.homework_id\}`\)/);
  expect(dashboardSrc).toMatch(/<PracticePanel homework=\{practiceHomework\}/);
});

test("Online School never imports or references a second practice/guided-round engine", () => {
  expect(dashboardSrc).not.toMatch(/GuidedPracticeFlow|guidedPracticeReducer/);
});

// ---------------------------------------------------------------------------
// Advancement — explicit, gated on real practice, never automatic
// ---------------------------------------------------------------------------

test("the Continue action inside lesson detail only appears once the server confirms practice happened", () => {
  expect(dashboardSrc).toMatch(/detailLesson\.is_current && detailLesson\.practiced &&/);
  expect(dashboardSrc).toMatch(/data-testid="school-advance"/);
  expect(dashboardSrc).toMatch(/\/advance`\)/);
});

// ---------------------------------------------------------------------------
// Generality — no exercise-specific hardcoding anywhere in the school layer
// ---------------------------------------------------------------------------

test("no Online School file contains a literal exercise-specific string used to branch behavior", () => {
  const combined = [dashboardSrc, portalSrc, dogTrainingTabSrc, programStudioSrc, polishSrc].join("\n");
  for (const needle of ["Merlin", "Name Response", "\"Place\"", "Loose Leash"]) {
    expect(combined).not.toContain(needle);
  }
});

// ---------------------------------------------------------------------------
// Admin: enroll UI + delivery mode control
// ---------------------------------------------------------------------------

test("DogTrainingTab offers a distinct Online School enroll action separate from trainer-led Enroll", () => {
  expect(dogTrainingTabSrc).toMatch(/data-testid="enroll-btn"/);
  expect(dogTrainingTabSrc).toMatch(/data-testid="school-enroll-btn"/);
  expect(dogTrainingTabSrc).toMatch(/api\.post\("\/school\/enroll"/);
});

test("DogTrainingTab splits active enrollments by delivery_channel so trainer tools never render for a school row", () => {
  expect(dogTrainingTabSrc).toMatch(/const active = activeAll\.filter\(e => e\.delivery_channel !== "online_school"\)/);
  expect(dogTrainingTabSrc).toMatch(/const schoolActive = activeAll\.filter\(e => e\.delivery_channel === "online_school"\)/);
});

test("the school enroll picker is filtered to delivery_mode self_guided/both, not every program", () => {
  expect(dogTrainingTabSrc).toMatch(/const schoolCapablePrograms = programs\.filter\(p => \(p\.delivery_mode \|\| "trainer_led"\) !== "trainer_led"\)/);
});

test("removing a school enrollment calls the safe DELETE endpoint, not a raw status update", () => {
  expect(dogTrainingTabSrc).toMatch(/api\.delete\(`\/school\/enrollments\/\$\{se\.id\}`\)/);
});

test("ProgramStudio exposes exactly the 3 delivery modes and defaults the UI to trainer_led when unset", () => {
  expect(programStudioSrc).toMatch(/data-testid=\{`prog-delivery-mode-\$\{dm\.k\}`\}/);
  expect(programStudioSrc).toMatch(/\{ k: "trainer_led", label: "Trainer-Led"/);
  expect(programStudioSrc).toMatch(/\{ k: "self_guided", label: "Online School"/);
  expect(programStudioSrc).toMatch(/\{ k: "both", label: "Both"/);
  expect(programStudioSrc).toMatch(/\(program\.delivery_mode \|\| "trainer_led"\) === dm\.k/);
});

// ---------------------------------------------------------------------------
// Legacy portal behavior unchanged
// ---------------------------------------------------------------------------

test("PortalLearn/PortalProgress mounts are untouched — Online School is additive, not a replacement", () => {
  expect(portalSrc).toMatch(/<PortalLearn homework=\{homework\}\/>/);
  expect(portalSrc).toMatch(/<PortalProgress homework=\{homework\}\/>/);
});

test("ClientTodayPanel/PracticePanel legacy homework mounts are untouched", () => {
  expect(portalSrc).toMatch(/<ClientTodayPanel dogs=\{dogs\} homework=\{homework\} bookings=\{bookings\} onOpenPractice=\{setPracticeFor\}/);
  expect(portalSrc).toMatch(/\{practiceFor && \(/);
});
