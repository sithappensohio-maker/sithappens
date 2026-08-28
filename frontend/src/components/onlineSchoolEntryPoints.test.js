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

test("the School entry point is the full-width HERO above the portal grid — never tucked behind More", () => {
  // School UX fix: the slim teaser was replaced by OnlineSchoolHeroCard,
  // rendered full-width BEFORE the column grid (maximum prominence on
  // desktop and mobile alike).
  const heroIdx = portalSrc.indexOf("<OnlineSchoolHeroCard");
  const gridIdx = portalSrc.indexOf('"grid grid-cols-1 md:grid-cols-3 gap-8"');
  const firstMoreWrapperIdx = portalSrc.indexOf('data-testid="portal-more-homeworkstreak-plans"');
  expect(heroIdx).toBeGreaterThan(-1);
  expect(gridIdx).toBeGreaterThan(-1);
  expect(heroIdx).toBeLessThan(gridIdx);
  expect(heroIdx).toBeLessThan(firstMoreWrapperIdx);
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

test("DogTrainingTab offers ONE unified Assign Program action for every delivery mode", () => {
  // School consolidation: the old pair of separate trainer-led / Online
  // School enroll buttons is deliberately replaced by a single Assign
  // Program flow that chooses the delivery mode inside the modal. The
  // canonical /school/enroll endpoint still backs all three modes.
  expect(dogTrainingTabSrc).toMatch(/data-testid="school-assign-btn"/);
  expect(dogTrainingTabSrc).toMatch(/data-testid="school-program-assign-modal"/);
  expect(dogTrainingTabSrc).toMatch(/api\.post\("\/school\/enroll"/);
  expect(dogTrainingTabSrc).toMatch(/delivery_mode: deliveryMode/);
});

test("DogTrainingTab splits active enrollments by delivery_channel so trainer tools never render for a school row", () => {
  // In-person/hybrid School rows became deliberately staff-run (unified
  // trainer progression); online_school rows still never get trainer tools.
  expect(dogTrainingTabSrc).toMatch(/const STAFF_SCHOOL_CHANNELS = \["in_person_school", "hybrid_school"\]/);
  expect(dogTrainingTabSrc).toMatch(/const active = activeAll\.filter\(e => STAFF_SCHOOL_CHANNELS\.includes\(e\.delivery_channel\)\)/);
  expect(dogTrainingTabSrc).toMatch(/const schoolActive = activeAll\.filter\(e => e\.delivery_channel === "online_school"\)/);
});

test("the no-active empty state is gated on activeAll so an online-only dog is never told it has no program", () => {
  // Visual QA regression: `active` deliberately excludes online_school rows
  // (they render in the Online School block), so gating the empty state on
  // `active` made a dog with a live online enrollment show BOTH
  // "1 active School program" and "No active training program · Enroll …"
  // stacked directly above its own active enrollment card.
  expect(dogTrainingTabSrc).toMatch(/\) : activeAll\.length === 0 \? \(/);
  expect(dogTrainingTabSrc).not.toMatch(/\{active\.length > 0 \? \([\s\S]*?\) : \(\s*<div[^>]*data-testid="no-active"/);
});

test("delivery choices are restricted to what each program actually supports", () => {
  // Same intent as the old program-list filter, relocated: the modal now
  // offers ONLY the delivery modes a given program is configured for, so a
  // self_guided course can never be assigned in person and a trainer_led
  // course can never be assigned online.
  expect(dogTrainingTabSrc).toMatch(/const modesFor = \(p\) =>/);
  // The School unification made every curriculum trainer-runnable in person;
  // Online/Hybrid stay restricted to courses that support self-guided access,
  // and a trainer_led course still can never be assigned online.
  expect(dogTrainingTabSrc).toMatch(/if \(configured === "self_guided" \|\| configured === "both"\) return \[/);
  expect(dogTrainingTabSrc).toMatch(/return \[\{ key: "in_person", label: "In Person"/);
  expect(dogTrainingTabSrc).toMatch(/modesFor\(selected\)\.map/);
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
