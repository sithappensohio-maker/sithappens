// Client School redesign — phase 2: navigation IA, Course, Lesson.
//
// The routing and lesson-mapping logic are pure, so they are tested
// BEHAVIOURALLY. The React wiring is pinned the way this repo does elsewhere.
// Rendered behaviour was verified in the browser as a real enrolled client at
// 1440x900, 1024x768, 390x844 and 320x568.
import fs from "fs";
import path from "path";
import { parseSchoolPath, schoolPathFor, SCHOOL_DEFAULT_VIEW } from "../../../lib/studentSchool";
import { buildGuide, splitSteps, GUIDE_SECTIONS } from "./lesson/LessonGuide";
import { NAV_ITEMS } from "./SchoolNav";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
/* Assertions about what the UI must NOT contain run against code with
   comments removed — otherwise a comment explaining why something is absent
   trips the very check that proves it is absent. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const navSrc = read("SchoolNav.jsx");
const courseSrc = read("CourseRoadmap.jsx");
const courseCardsSrc = read("course", "CourseCards.jsx");
const lessonSrc = read("LessonScreen.jsx");
const guideSrc = read("lesson", "LessonGuide.jsx");
const appSrc = read("..", "..", "..", "screens", "SchoolApp.jsx");

// ---------------------------------------------------------------------------
// Information architecture
// ---------------------------------------------------------------------------

test("client navigation is exactly the five destinations from the brief", () => {
  expect(NAV_ITEMS.map(i => i.view)).toEqual(["today", "course", "practice", "progress", "feedback"]);
});

test("navigation no longer offers both Home and Today", () => {
  const views = NAV_ITEMS.map(i => i.view);
  expect(views).not.toContain("home");
  expect(views.filter(v => v === "today")).toHaveLength(1);
});

test("Today is the single default landing page", () => {
  expect(SCHOOL_DEFAULT_VIEW).toBe("today");
  expect(parseSchoolPath("/school").view).toBe("today");
  expect(parseSchoolPath("").view).toBe("today");
  expect(parseSchoolPath("/school/not-a-real-view").view).toBe("today");
});

test("the legacy /school/home link still works and normalises to Today", () => {
  // Backward compatibility for existing links and bookmarks — it must not
  // 404, and it must not resurrect a second landing page.
  expect(parseSchoolPath("/school/home").view).toBe("today");
  expect(schoolPathFor("home")).toBe("/school");
  expect(schoolPathFor("today")).toBe("/school");
});

test("client navigation exposes no trainer or admin destination", () => {
  for (const v of NAV_ITEMS.map(i => i.view)) {
    expect(["today", "course", "practice", "progress", "feedback"]).toContain(v);
  }
  expect(code(navSrc)).not.toMatch(/trainer_hq|admin|staff|school_hq/i);
});

test("desktop and mobile render the SAME five destinations", () => {
  expect(navSrc).toMatch(/data-testid="school-nav-desktop"/);
  expect(navSrc).toMatch(/data-testid="school-nav-mobile"/);
  // one shared list drives both, so they cannot drift apart
  expect((navSrc.match(/NAV_ITEMS\.map/g) || [])).toHaveLength(2);
});

test("Practice has a real destination rather than only a modal", () => {
  expect(appSrc).toMatch(/parsed\.view === "practice"/);
  expect(appSrc).toMatch(/<PracticeScreen/);
});

// ---------------------------------------------------------------------------
// Course — real metrics, real state
// ---------------------------------------------------------------------------

test("course progress uses the backend's own values, not recomputed ones", () => {
  expect(courseCardsSrc).toMatch(/detail\?\.course_pct/);
  expect(courseCardsSrc).toMatch(/l\.status === "completed"/);
  expect(courseCardsSrc).toMatch(/detail\?\.checkpoints_passed/);
});

test("the checkpoint metric is hidden when the program has no checkpoints", () => {
  // Showing "0 / 0 checkpoints" would be noise, not progress.
  expect(courseCardsSrc).toMatch(/\{cpTotal > 0 && \(/);
});

test("Continue targets the canonical current lesson", () => {
  expect(courseCardsSrc).toMatch(/const current = roadmap\?\.current_lesson/);
  expect(courseCardsSrc).toMatch(/onClick=\{\(\) => onResume\(current\.id\)\}/);
});

test("module state words are friendly and cover every server status", () => {
  for (const key of ["completed", "complete", "current", "upcoming", "locked"]) {
    expect(courseCardsSrc).toMatch(new RegExp(`^\\s*${key}: \\{`, "m"));
  }
  expect(courseCardsSrc).toMatch(/label: "Complete"/);
  expect(courseCardsSrc).toMatch(/label: "In progress"/);
  expect(courseCardsSrc).toMatch(/label: "Up next"/);
});

test("a locked module explains what unlocks it instead of just blocking", () => {
  expect(courseCardsSrc).toMatch(/data-testid=\{`course-module-locked-\$\{m\.id\}`\}/);
  expect(courseCardsSrc).toMatch(/\{m\.lockedReason\}/);
  expect(courseCardsSrc).toMatch(/lesson\.locked_reason/);
});

test("the current module expands by default and locked modules cannot be opened", () => {
  expect(courseSrc).toMatch(/defaultOpen=\{!isCompleted && m\.status === "current"\}/);
  expect(courseCardsSrc).toMatch(/\{open && !locked && \(/);
});

test("Course still reads lock/progression state from the server", () => {
  // buildSchoolRoadmap is the existing projection — the redesign must not
  // start deciding locks in the client.
  expect(courseSrc).toMatch(/buildSchoolRoadmap\(roadmap\)/);
  expect(code(courseCardsSrc)).not.toMatch(/unlock|canAccess|isAllowed/i);
});

// ---------------------------------------------------------------------------
// Lesson — mapping, not duplicating
// ---------------------------------------------------------------------------

test("the guided sequence is the eight steps from the brief, in order", () => {
  expect(GUIDE_SECTIONS.map(s => s.key)).toEqual([
    "learn", "get_ready", "train", "watch_for", "know_got_it", "practice", "quick_check", "next_step",
  ]);
});

test("each step maps to an authored field rather than new curriculum data", () => {
  const lesson = {
    client_overview: "Overview.", why_it_matters: "Why.",
    equipment_needed: "Long line.", client_instructions: "Do this.",
    common_mistakes: "Watch out.", success_criteria: "5 in a row.",
  };
  const keys = buildGuide(lesson, { hasPractice: true, hasQuiz: true }).map(s => s.key);
  expect(keys).toEqual(["learn", "get_ready", "train", "watch_for", "know_got_it", "practice", "quick_check", "next_step"]);
});

test("Learn merges the overview and why-it-matters the trainer already wrote", () => {
  const g = buildGuide({ client_overview: "A.", why_it_matters: "B." });
  expect(g.find(s => s.key === "learn").body).toBe("A.\n\nB.");
});

test("sections with no authored content are omitted, never shown empty", () => {
  // The brief forbids empty shells — notably fake video placeholders.
  const sparse = buildGuide({ client_overview: "Only this." }, { hasPractice: false, hasQuiz: false });
  expect(sparse.map(s => s.key)).toEqual(["learn", "next_step"]);
  expect(sparse.find(s => s.key === "get_ready")).toBeUndefined();
  expect(sparse.find(s => s.key === "train")).toBeUndefined();
});

test("Practice and Quick Check appear only when they genuinely exist", () => {
  expect(buildGuide({ client_overview: "x" }, { hasPractice: false, hasQuiz: false }).map(s => s.key)).not.toContain("practice");
  expect(buildGuide({ client_overview: "x" }, { hasPractice: true, hasQuiz: false }).map(s => s.key)).toContain("practice");
  expect(buildGuide({ client_overview: "x" }, { hasPractice: false, hasQuiz: true }).map(s => s.key)).toContain("quick_check");
});

test("authored step lists become numbered steps; prose stays prose", () => {
  expect(splitSteps("1. Spot it\n2. Keep moving\n3. Reward")).toEqual(["Spot it", "Keep moving", "Reward"]);
  expect(splitSteps("- One\n- Two")).toEqual(["One", "Two"]);
  // structure is never fabricated from a paragraph
  expect(splitSteps("Walk your dog and reward calm attention.")).toBeNull();
  expect(splitSteps("")).toBeNull();
});

test("Course Builder blocks still win over the guided sequence", () => {
  // A trainer who authored content_blocks already controls presentation and
  // ordering; the guide must not duplicate that renderer.
  expect(lessonSrc).toMatch(/\(lesson\.content_blocks \|\| \[\]\)\.some\(\(b\) => b\?\.active !== false\)\s*\n?\s*\? <LessonContentBlocks/);
});

test("a thin lesson keeps the flat renderer rather than a one-item checklist", () => {
  expect(lessonSrc).toMatch(/const hasGuide = guideSections\.filter\(sx => sx\.body !== "ready"\)\.length >= 2/);
  expect(lessonSrc).toMatch(/: <LessonDetailPanel lesson=\{lesson\}/);
});

test("troubleshooting and safety collapse instead of burying the steps", () => {
  expect(guideSrc).toMatch(/title="Troubleshooting"/);
  expect(guideSrc).toMatch(/title="Safety notes"/);
  expect(guideSrc).toMatch(/const \[open, setOpen\] = useState\(false\)/);
});

// ---------------------------------------------------------------------------
// Delivery modes + canonical behaviour
// ---------------------------------------------------------------------------

test("the redesign does not touch the lesson action state machine", () => {
  // Every progression control still comes from the backend-driven branches
  // that existed before the redesign.
  expect(lessonSrc).toMatch(/data-testid="lesson-start-practice"/);
  expect(lessonSrc).toMatch(/data-testid="lesson-complete"/);
  expect(lessonSrc).toMatch(/data-testid="lesson-advance"/);
  expect(lessonSrc).toMatch(/data-testid="lesson-setup-required"/);
  expect(lessonSrc).toMatch(/<CheckpointPanel/);
});

test("In Person students are still never offered a client checkpoint upload", () => {
  // The B6 rule from the School consolidation must survive the redesign.
  const panel = read("CheckpointPanel.jsx");
  expect(panel).toMatch(/const trainerAssessed = deliveryMode === "in_person" \|\| deliveryMode === "trainer_led"/);
  expect(panel).toMatch(/if \(trainerAssessed\) return inPersonPanel;/);
  expect(lessonSrc).toMatch(/deliveryMode=\{deliveryMode\}/);
});

test("one School design serves all three delivery modes", () => {
  // No per-mode component forks — mode only changes state-aware actions.
  for (const src of [courseCardsSrc, guideSrc]) {
    expect(code(src)).not.toMatch(/if \(deliveryMode === "online"\)/);
    expect(code(src)).not.toMatch(/OnlineCourse|InPersonCourse|HybridCourse/);
  }
});

test("the redesigned surfaces render no staff-only content", () => {
  for (const src of [courseCardsSrc, guideSrc]) {
    for (const forbidden of ["session_note", "private", "internal", "graded_by", "observed_live_by"]) {
      expect(code(src).toLowerCase()).not.toContain(forbidden);
    }
  }
});
