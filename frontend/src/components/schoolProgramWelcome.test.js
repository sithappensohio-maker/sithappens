// Program Welcome page — source-level regression guards (repo convention:
// assert the exact implementing patterns, no rendering).
//
// The feature: every School program gets a welcome/index page — what the
// program covers, how School works, and a full read-only table of contents.
// A client with zero completed lessons lands there once per device; after
// that, the course hero's "About this program" link reopens it.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const welcomeSrc = read("school", "student", "ProgramWelcome.jsx");
const schoolAppSrc = read("..", "screens", "SchoolApp.jsx");
const courseCardsSrc = read("school", "student", "course", "CourseCards.jsx");
const roadmapSrc = read("school", "student", "CourseRoadmap.jsx");
const libSrc = read("..", "lib", "studentSchool.js");
const serverSrc = read("..", "..", "..", "backend", "server.py");

// ---------------------------------------------------------------------------
// 1. The welcome screen itself
// ---------------------------------------------------------------------------

test("welcome hero shows the program name with Start Lesson 1 / Continue and a skip-to-course escape hatch", () => {
  expect(welcomeSrc).toMatch(/data-testid="welcome-program-name"/);
  expect(welcomeSrc).toMatch(/Start Lesson 1/);
  expect(welcomeSrc).toMatch(/Continue training/);
  expect(welcomeSrc).toMatch(/data-testid="welcome-start"/);
  expect(welcomeSrc).toMatch(/data-testid="welcome-skip-to-course"/);
});

test("what's-covered renders the program description plus the admin-authored outcomes, and degrades when either is missing", () => {
  expect(welcomeSrc).toMatch(/data-testid="welcome-outcomes"/);
  // Section renders when EITHER exists; a program with neither shows no shell.
  expect(welcomeSrc).toMatch(/\(w\.description \|\| outcomes\.length > 0\)/);
});

test("the index is read-only orientation: no lesson-open navigation, and the whole-journey footer states the contract", () => {
  expect(welcomeSrc).toMatch(/data-testid="welcome-index"/);
  expect(welcomeSrc).not.toMatch(/onOpenLesson/);
  expect(welcomeSrc).toMatch(/including parts that unlock later/);
});

test("how-it-works adapts step 3 for in-person delivery instead of promising module unlocks", () => {
  expect(welcomeSrc).toMatch(/delivery_mode === "in_person"/);
  expect(welcomeSrc).toMatch(/Train with your trainer/);
  expect(welcomeSrc).toMatch(/Your trainer checks in/);
});

// ---------------------------------------------------------------------------
// 2. Routing + first-visit landing
// ---------------------------------------------------------------------------

test("SchoolApp routes the welcome view to ProgramWelcome and highlights the course tab for it", () => {
  expect(schoolAppSrc).toMatch(/parsed\.view === "welcome"/);
  expect(schoolAppSrc).toMatch(/<ProgramWelcome/);
  expect(schoolAppSrc).toMatch(/parsed\.view === "lesson" \|\| parsed\.view === "welcome" \? "course"/);
});

test("first-visit redirect: 0 lessons completed lands on welcome ONCE — flag written BEFORE navigating so it can never loop", () => {
  const effect = schoolAppSrc.slice(schoolAppSrc.indexOf("Program Welcome — a client"));
  expect(effect).toMatch(/lessons_completed \?\? 0\) !== 0\) return/);
  expect(effect).toMatch(/if \(welcomeSeen\(selectedId\)\) return/);
  const markAt = effect.indexOf("markWelcomeSeen(selectedId)");
  const navAt = effect.indexOf('onNavigate(schoolPathFor("welcome", selectedId))');
  expect(markAt).toBeGreaterThan(-1);
  expect(navAt).toBeGreaterThan(markAt);
  // Never intercept a completed or revoked course.
  expect(effect).toMatch(/detail\.access_state === "revoked" \|\| detail\.status === "completed"/);
});

test("a broken localStorage reports the welcome as already seen (redirect-loop guard)", () => {
  expect(libSrc).toMatch(/catch \{ return true; \}/);
});

test("the course hero carries an About-this-program link wired through CourseRoadmap", () => {
  expect(courseCardsSrc).toMatch(/data-testid="course-about-program"/);
  expect(roadmapSrc).toMatch(/onAbout=\{onAbout\}/);
  expect(schoolAppSrc).toMatch(/onAbout=\{\(\) => go\("welcome"\)\}/);
});

// ---------------------------------------------------------------------------
// 3. Backend contract
// ---------------------------------------------------------------------------

test("the detail payload's welcome index comes from the frozen snapshot with names/minutes/quiz counts and NO lesson ids or lock state", () => {
  const helper = serverSrc.slice(
    serverSrc.indexOf("def _school_welcome_payload"),
    serverSrc.indexOf('@api.get("/portal/school/{school_enrollment_id}")'),
  );
  expect(helper).toMatch(/_effective_lesson_list\(m\)/);
  // The lesson entry is EXACTLY name + minutes — adding ids or status here
  // would leak curriculum handles the roadmap deliberately withholds.
  expect(helper).toMatch(/\{"name": l\.get\("name"\), "estimated_minutes": l\.get\("estimated_minutes"\)\}/);
  expect(helper).toMatch(/quiz_question_count/);
});

test("welcome content is gated exactly like the roadmap on revoked access, and outcomes read from the LIVE program", () => {
  const detailFn = serverSrc.slice(
    serverSrc.indexOf("async def portal_school_detail"),
    serverSrc.indexOf("def _school_current_action"),
  );
  expect(detailFn).toMatch(/welcome = None\s+if access_state != "revoked":/);
  // The live read also carries module id/icon for the icon merge — still a
  // narrow projection, never the whole program.
  expect(detailFn).toMatch(/\{"_id": 0, "welcome_outcomes": 1, "modules\.id": 1, "modules\.icon": 1\}/);
  expect(detailFn).toMatch(/"welcome": welcome/);
});

test("ProgramIn.welcome_outcomes drops blank textarea lines at the boundary", () => {
  expect(serverSrc).toMatch(/welcome_outcomes: List\[str\] = \[\]/);
  expect(serverSrc).toMatch(/def _clean_bullet_lines/);
  expect(serverSrc).toMatch(/if s and s\.strip\(\)\]\[:12\]/);
});
