/* Stage 9 — the client Course journey: same curriculum, client presentation.
 *
 * Pure tests of lib/courseJourney (server roadmap + current_action → CURRENT /
 * COMING NEXT / chapters with truthful lock reasons) plus render tests of the
 * two new cards and source guards on the Course screen composition.
 */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildCourseJourney, nextStepReason, comingNext, decorateLesson } = require("../../../lib/courseJourney");
const { CurrentLessonCard, ComingNextCard } = require("./course/CourseCards.jsx");

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const roadmapSrc = read("CourseRoadmap.jsx");
const cardsSrc = read("course", "CourseCards.jsx");
const appSrc = read("..", "..", "..", "screens", "SchoolApp.jsx");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const lesson = (id, name, status, extra = {}) => ({ id, name, status, ...extra });
const roadmap = (over = {}) => ({
  current_lesson_id: "l2",
  current_lesson: { id: "l2", name: "Adding Distance", client_overview: "You're working on staying in Place while your handler moves farther away.", estimated_minutes: 12 },
  modules: [
    { id: "m1", name: "Foundations", status: "current", lessons: [
      lesson("l1", "Marker Training", "completed"), lesson("l2", "Adding Distance", "available"), lesson("l3", "Door Distractions", "locked", { locked_reason: "Complete Adding Distance before continuing." }),
    ] },
    { id: "m2", name: "Public Access", status: "locked", locked_reason: "Complete Foundations before continuing.", lessons: [] },
  ],
  requires_checkpoint: false, checkpoint_status: null, checkpoint_rubric: null,
  ...over,
});
const detail = (over = {}) => ({ program_name: "Basic Obedience", program_focus: "Calm, reliable manners.", dog_name: "Milo", delivery_mode: "online", status: "active", roadmap: roadmap(), ...over });
const home = (over = {}) => ({ progress: { course_pct: 25, lessons_completed: 1, lessons_total: 4, modules_completed: 0, modules_total: 2 }, current_action: { type: "lesson", label: "Continue lesson" }, active_practice: [], ...over });

test("CURRENT is the server's current lesson, positioned and summarised; COMING NEXT is the following lesson", () => {
  const j = buildCourseJourney({ detail: detail(), home: home() });
  expect(j.current).toMatchObject({ id: "l2", name: "Adding Distance", moduleName: "Foundations", position: "Lesson 2 of 4", minutes: 12 });
  expect(j.current.summary).toMatch(/staying in Place/);
  expect(j.next).toMatchObject({ kind: "lesson", title: "Door Distractions", id: "l3" });
  expect(j.program).toMatchObject({ name: "Basic Obedience", pct: 25, mode: "online", completed: false });
});

test("lesson rows are decorated completed → current → next → locked, and only locked rows carry a reason", () => {
  const j = buildCourseJourney({ detail: detail(), home: home() });
  const rows = j.chapters[0].lessons.map((l) => [l.name, l.state, l.reason]);
  expect(rows).toEqual([
    ["Marker Training", "completed", null],
    ["Adding Distance", "current", null],
    ["Door Distractions", "locked", "Finish Adding Distance first."],
  ]);
  expect(j.chapters[0].meta).toBe("1 of 3 lessons complete");
  expect(j.chapters[1].lessons).toEqual([]);
});

test("the lock reason for the next step comes from the real current_action, never a gate name", () => {
  const cases = [
    [{ type: "lesson" }, "online", "Finish Adding Distance first."],
    [{ type: "practice" }, "online", "Complete today's Practice first."],
    [{ type: "awaiting_review" }, "hybrid", "Waiting for your trainer to review."],
    [{ type: "submit_checkpoint" }, "hybrid", "Pass the checkpoint to continue."],
    [{ type: "remediation" }, "online", "Finish the extra Practice your trainer asked for, then retry the checkpoint."],
    [{ type: "module_quiz" }, "online", "Pass the module quiz to continue."],
    [{ type: "trainer_guided" }, "in_person", "Your trainer will move you forward at your next visit."],
    [{ type: "lesson" }, "in_person", "Your trainer will move you forward at your next visit."],
    [{ type: "advance" }, "online", null],
  ];
  for (const [action, mode, expected] of cases) expect(nextStepReason(action, mode, "Adding Distance")).toBe(expected);
  expect(JSON.stringify(cases.map((c) => nextStepReason(c[0], c[1], "x")))).not.toMatch(/instructional_steps|practice_gate|checkpoint_required|trainer_guided/);
});

test("a checkpoint lesson puts the checkpoint before the next lesson; a module boundary shows the quiz, then the next chapter", () => {
  const cp = buildCourseJourney({ detail: detail({ roadmap: roadmap({ requires_checkpoint: true, checkpoint_status: { status: "not_submitted" }, checkpoint_rubric: { title: "Place Skills" } }) }), home: home({ current_action: { type: "submit_checkpoint" } }) });
  expect(cp.next).toMatchObject({ kind: "checkpoint", title: "Place Skills", reason: "Pass the checkpoint to continue." });
  expect(cp.current.isCheckpoint).toBe(true);
  // graded but NOT passed (more practice / trainer assist) → the checkpoint retry is still what comes next
  for (const outcome of ["prescribe_practice", "trainer_assist"]) {
    const retry = comingNext(roadmap({ requires_checkpoint: true, checkpoint_status: { status: "graded", outcome }, checkpoint_rubric: { title: "Place Skills" } }));
    expect(retry).toMatchObject({ kind: "checkpoint", title: "Place Skills" });
  }
  expect(comingNext(roadmap({ requires_checkpoint: true, checkpoint_status: { status: "graded", outcome: "advance" } }))).toMatchObject({ kind: "lesson", title: "Door Distractions" });
  // a rubric literally titled "Checkpoint" is not announced as "Checkpoint — Checkpoint"
  expect(text(renderToStaticMarkup(React.createElement(ComingNextCard, { next: { kind: "checkpoint", title: "Checkpoint", reason: null } })))).toBe("Coming next Checkpoint");
  const last = roadmap({ current_lesson_id: "l3", current_lesson: { id: "l3", name: "Door Distractions" } });
  last.modules[0].lessons[2] = lesson("l3", "Door Distractions", "available");
  last.modules[0].quiz = { enabled: true, status: "available" };
  const quiz = comingNext(last);
  expect(quiz).toMatchObject({ kind: "quiz", title: "Module quiz — Foundations" });
  last.modules[0].quiz = { enabled: true, status: "passed" };
  expect(comingNext(last)).toMatchObject({ kind: "module", title: "Public Access" });
});

test("trainer-led clients are never invited to self-advance; Practice is offered when it exists", () => {
  const inPerson = detail({ delivery_mode: "in_person" });
  const guided = buildCourseJourney({ detail: inPerson, home: home({ current_action: { type: "trainer_guided" } }) });
  expect(guided.current.action).toEqual({ kind: "none", label: null, modeLine: "You'll work on this with your trainer. Keep practising until your next visit." });
  const practice = buildCourseJourney({ detail: inPerson, home: home({ current_action: { type: "practice" }, active_practice: [{ id: "hw1", title: "Place Practice", source_lesson_id: "l2" }] }) });
  expect(practice.current.action.kind).toBe("practice");
  expect(practice.current.practice).toEqual({ id: "hw1", title: "Place Practice" });
  const html = renderToStaticMarkup(React.createElement(CurrentLessonCard, { journey: practice, roadmap: inPerson.roadmap, onResume: () => {}, onOpenLesson: () => {}, onOpenPractice: () => {} }));
  expect(html).toMatch(/data-testid="course-current-practice"/);
  expect(html).not.toMatch(/data-testid="course-continue"/);
  expect(text(html)).toMatch(/Current Adding Distance Lesson 2 of 4 · Foundations · 12 min/);
  expect(text(html)).toMatch(/You'll work on this with your trainer\. Practice is ready in the meantime\. Go to Practice/);
});

test("online continues in the app; hybrid says which side does this step", () => {
  const online = renderToStaticMarkup(React.createElement(CurrentLessonCard, { journey: buildCourseJourney({ detail: detail(), home: home() }), roadmap: roadmap(), onResume: () => {} }));
  expect(online).toMatch(/data-testid="course-continue"/);
  expect(text(online)).toMatch(/Continue lesson/);
  const hybrid = buildCourseJourney({ detail: detail({ delivery_mode: "hybrid" }), home: home({ current_action: { type: "practice" } }) });
  expect(hybrid.current.action.modeLine).toBe("Do this in the app. Your trainer also works on it with you in person.");
  const waiting = buildCourseJourney({ detail: detail({ delivery_mode: "hybrid" }), home: home({ current_action: { type: "awaiting_review" } }) });
  expect(waiting.current.action.kind).toBe("none");
  expect(waiting.next.reason).toBe("Waiting for your trainer to review.");
});

test("a completed program has no CURRENT or NEXT and a legacy roadmap degrades to titles", () => {
  const done = buildCourseJourney({ detail: detail({ status: "completed" }), home: home({ current_action: { type: "course_complete" } }) });
  expect(done.current).toBeNull();
  expect(done.next).toBeNull();
  expect(done.program.completed).toBe(true);
  const legacy = buildCourseJourney({ detail: detail({ roadmap: roadmap({ current_lesson: { id: "l2", name: "Adding Distance" } }) }), home: { progress: {}, current_action: null } });
  expect(legacy.current.summary).toBe("");
  expect(legacy.current.position).toBeNull();
  expect(legacy.next.reason).toBeNull();
  expect(text(renderToStaticMarkup(React.createElement(ComingNextCard, { next: legacy.next })))).toBe("Coming next Door Distractions");
});

test("the Coming next card names the milestone and its reason; locked rows are announced with their reason", () => {
  const html = renderToStaticMarkup(React.createElement(ComingNextCard, { next: { kind: "checkpoint", title: "Place Skills", reason: "Pass the checkpoint to continue." } }));
  expect(text(html)).toBe("Coming next Checkpoint — Place Skills Pass the checkpoint to continue.");
  const row = decorateLesson(lesson("l3", "Door Distractions", "locked", { locked_reason: "Complete Adding Distance before continuing." }), { currentLessonId: "l2", nextId: "l9", nextReason: "x" });
  expect(row.reason).toBe("Complete Adding Distance before continuing.");
  expect(cardsSrc).toMatch(/aria-label=\{`\$\{lesson\.name\} — \$\{st\.label\}\$\{reason \? `\. \$\{reason\}` : ""\}`\}/);
});

test("the Course screen composes hero → CURRENT → COMING NEXT → chapters from one journey, still off the server roadmap", () => {
  expect(roadmapSrc).toMatch(/const journey = buildCourseJourney\(\{ detail, home \}\)/);
  expect(roadmapSrc).toMatch(/buildSchoolRoadmap\(roadmap\)/);
  const order = ["<CourseHero", "<CurrentLessonCard", "<ComingNextCard", 'data-testid="course-roadmap-modules"'].map((s) => roadmapSrc.indexOf(s));
  expect(order.every((i) => i > 0) && [...order].sort((a, b) => a - b).join() === order.join()).toBe(true);
  expect(appSrc).toMatch(/<CourseRoadmap detail=\{detail\} progress=\{home\?\.progress\} home=\{home\}/);
  expect(appSrc).toMatch(/onOpenPractice=\{\(hwId\) => openHomework\(hwId\)\}/);
  // completed rows are quiet: smaller, muted, no chevron
  expect(cardsSrc).toMatch(/\{!locked && !done && <i className="fas fa-chevron-right/);
  expect(cardsSrc).toMatch(/done \? "text-\[15px\] font-bold text-shTextMuted"/);
  // 320px: the row's minutes pill yields to the lesson name (the CURRENT card still states the minutes)
  expect(cardsSrc).toMatch(/className=\{`sh-lesson-minutes /);
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.css"), "utf8");
  const ruleAt = css.indexOf(".sh-lesson-minutes { display: none; }");
  expect(ruleAt).toBeGreaterThan(0);
  const before = css.slice(0, ruleAt);
  // …and that rule sits inside a max-width:359px block (no closing brace between the block start and the rule)
  expect(before.lastIndexOf("@media (max-width: 359px)")).toBeGreaterThan(before.lastIndexOf(String.fromCharCode(10) + "}"));
});

test("the hero stat tiles keep count + word at phone widths: the icon square yields, nothing is dropped", () => {
  expect((cardsSrc.match(/className="sh-course-stat /g) || []).length).toBe(3);
  expect((cardsSrc.match(/sh-course-stat-icon /g) || []).length).toBe(3);
  expect((cardsSrc.match(/sh-course-stat-label /g) || []).length).toBe(3);
  expect(cardsSrc).toMatch(/sh-course-stat-num block text-\[17px\][^"]*whitespace-nowrap/);
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.css"), "utf8");
  const at = css.indexOf(".sh-course-stat-icon { display: none; }");
  expect(at).toBeGreaterThan(0);
  const before = css.slice(0, at);
  expect(before.lastIndexOf("@media (max-width: 479px)")).toBeGreaterThan(before.lastIndexOf(String.fromCharCode(10) + "}"));
  expect(css).toMatch(/\.sh-course-stat-label \{ font-size: 10px; letter-spacing: 0\.04em; \}/);
});
