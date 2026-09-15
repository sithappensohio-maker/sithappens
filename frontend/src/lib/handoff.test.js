/* Stage 10 — "What happens next?" transition matrix (client side).
 *
 * Every handoff is derived from canonical data (the fresh home view-model or
 * a mutation response), never invented, never persisted, and always scoped
 * to one enrollment. */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  makeHandoff, clientNextStep, lessonCompleteHandoff, quizHandoff, checkpointSubmittedHandoff,
  trainerSaveHandoff, practiceReviewHandoff, checkpointGradeHandoff, HANDOFF_LABELS, HANDOFF_STATES,
} = require("./handoff");
const { practiceCompletionHandoff } = require("./practiceState");
const HandoffPanel = require("../components/HandoffPanel.jsx").default;

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const render = (h, props = {}) => renderToStaticMarkup(React.createElement(HandoffPanel, { handoff: h, autoFocus: false, ...props }));

const home = (over = {}) => ({
  id: "se-1", delivery_mode: "online", dog: { name: "Milo" },
  current_lesson: { id: "l6", name: "Adding Distance" },
  current_action: { type: "lesson", label: "Continue lesson", sublabel: "Adding Distance", target: { screen: "lesson", lesson_id: "l6" } },
  journey: { now: { kind: "lesson", title: "Adding Distance", body: "", practice: null, cta: { label: "Continue lesson", run: "action" } }, next: { title: "Door Distractions", body: "After Practice." } },
  active_practice: [],
  ...over,
});

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

test("makeHandoff normalises: unknown states fall back, empty next is dropped, an action without a run is never a button", () => {
  const h = makeHandoff({ state: "bogus", title: "  Done  ", summary: "", next: { label: "", description: "" }, action: { label: "Go", run: null }, secondary: { label: "Back to Today", run: "today" } });
  expect(h).toEqual({ state: "complete", title: "Done", summary: null, next: null, action: null, secondary: { label: "Back to Today", run: "today", kind: "today" }, scope: null });
  expect(HANDOFF_STATES).toEqual(["complete", "next", "waiting", "needs_work", "program_complete", "saved", "error"]);
});

// ---------------------------------------------------------------------------
// Client: lesson complete → …
// ---------------------------------------------------------------------------

test("lesson complete → Practice (online)", () => {
  const h = lessonCompleteHandoff({ lessonName: "Place With Duration", home: home({ current_action: { type: "practice", label: "Start Practice", sublabel: "Place With Duration Practice" } }) });
  expect(h.title).toBe("Lesson complete");
  expect(h.summary).toBe("You finished Place With Duration.");
  expect(h.next.label).toBe("Practice what you learned before continuing.");
  expect(h.action).toMatchObject({ label: "Start Practice", run: "action" });
  expect(h.secondary).toMatchObject({ label: "Back to Today", run: "today" });
});

test("lesson complete → next lesson (no Practice) and → checkpoint", () => {
  const next = lessonCompleteHandoff({ lessonName: "Marker Word", home: home() });
  expect(next.next.label).toBe("Lesson — Adding Distance");
  expect(next.action).toMatchObject({ label: "Continue Lesson", run: "action" });
  const cp = lessonCompleteHandoff({ lessonName: "Place Skills", home: home({ current_action: { type: "submit_checkpoint", label: "Submit your checkpoint" }, current_lesson: { id: "l7", name: "Place Skills" } }) });
  expect(cp.next.label).toBe("Checkpoint — Place Skills");
  expect(cp.action).toMatchObject({ label: "Start Checkpoint", run: "action" });
});

test("only actions the gating allows: waiting states carry no primary button", () => {
  for (const type of ["awaiting_review", "trainer_assist"]) {
    const n = clientNextStep(home({ current_action: { type, label: "x" } }));
    expect(n.state).toBe("waiting");
    expect(n.action).toBeNull();
    expect(n.secondary).toMatchObject({ label: "Back to Today" });
  }
  expect(clientNextStep(home({ current_action: { type: "awaiting_review" } })).next.description).toMatch(/You don't need to do anything right now/);
});

// ---------------------------------------------------------------------------
// Client: Practice → …
// ---------------------------------------------------------------------------

test("Practice → another round today", () => {
  const h = practiceCompletionHandoff(home({ journey: { now: { kind: "practice", title: "Practice Recall", body: "Round 2 of 2", practice: { id: "hw-2" } }, next: null }, current_action: { type: "practice" } }), "hw-1");
  expect(h.title).toBe("Practice complete");
  expect(h.next.label).toBe("Practice Recall");
  expect(h.action).toMatchObject({ label: "Start Practice", run: "action" });
  expect(h.cta).toEqual({ label: "Start Practice", kind: "action" });
});

test("Practice → done for today (no unnecessary CTA)", () => {
  const h = practiceCompletionHandoff(home({ journey: { now: { kind: "practice", title: "Practice", practice: { id: "hw-1" } }, next: { title: "Adding Distance", body: "" } } }), "hw-1");
  expect(h.state).toBe("complete");
  expect(h.next.label).toBe("Come back tomorrow for your next round.");
  expect(h.action).toBeNull();
  expect(h.cta).toEqual({ label: "Back to Today", kind: "today" });
});

test("Practice → next lesson available, → waiting for review, → redo requested", () => {
  const adv = practiceCompletionHandoff(home({ journey: { now: { kind: "advance", title: "You finished Place", body: "" }, next: { title: "Lesson 6 — Adding Distance", body: "" } } }), "hw-1");
  expect(adv.summary).toBe("You're ready for the next lesson.");
  expect(adv.next.label).toBe("Lesson 6 — Adding Distance");
  const waiting = practiceCompletionHandoff(home({ active_practice: [{ id: "hw-t", daily_tracker: true, daily_progress: [{ day_number: 1, status: "submitted", log: {} }] }] }), "hw-t");
  expect(waiting.state).toBe("waiting");
  expect(waiting.title).toBe("Practice submitted");
  expect(waiting.action).toBeNull();
  // redo is the client's next step on Today/Practice (the coach feed's Try Again), not the Coach's completion screen
  const redo = clientNextStep(home({ current_action: { type: "remediation", label: "Start Practice", sublabel: "Door Manners Practice" } }));
  expect(redo.state).toBe("needs_work");
  expect(redo.next.label).toBe("Door Manners Practice");
  expect(redo.action).toMatchObject({ label: "Start Practice" });
});

// ---------------------------------------------------------------------------
// Client: checkpoint
// ---------------------------------------------------------------------------

test("checkpoint submit → waiting; pass → next lesson; remediation → Practice", () => {
  const sent = checkpointSubmittedHandoff({ lessonName: "Place Skills" });
  expect(sent).toMatchObject({ state: "waiting", title: "Checkpoint submitted", action: null });
  expect(sent.next.description).toMatch(/You do not need to submit it again/);
  const passed = clientNextStep(home({ current_action: { type: "advance" }, journey: { next: { title: "Lesson 9 — Working Around Distractions", body: "" } } }));
  expect(passed.next.label).toBe("Next: Lesson 9 — Working Around Distractions");
  expect(passed.action).toMatchObject({ label: "Continue Course", run: "action" });
  const rem = clientNextStep(home({ current_action: { type: "remediation", sublabel: "Door Manners Practice" } }));
  expect(rem).toMatchObject({ state: "needs_work", action: { label: "Start Practice" } });
});

// ---------------------------------------------------------------------------
// Client: trainer-led, hybrid, program complete
// ---------------------------------------------------------------------------

test("trainer-led clients are never invited to self-advance: caught up / read the lesson / practice only", () => {
  const guided = clientNextStep(home({ delivery_mode: "in_person", current_action: { type: "trainer_guided" } }));
  expect(guided).toMatchObject({ state: "waiting", action: null });
  expect(guided.next.description).toBe("Your trainer will move you forward at your next lesson.");
  const lesson = clientNextStep(home({ delivery_mode: "in_person", current_action: { type: "lesson" } }));
  expect(lesson.action.label).toBe("Continue Lesson");
  expect(lesson.next.description).toBe("Your trainer will move you forward at your next lesson.");
  const practice = clientNextStep(home({ delivery_mode: "in_person", current_action: { type: "practice", sublabel: "Name game" } }));
  expect(practice.action.label).toBe("Start Practice");
  // even an "advance" type (should the server ever emit it) never becomes a self-advance button for trainer-led
  expect(clientNextStep(home({ delivery_mode: "trainer_led", current_action: { type: "advance" } })).action).toBeNull();
});

test("hybrid follows the online ladder (in-app steps) and program complete points at Progress / Course", () => {
  const hy = clientNextStep(home({ delivery_mode: "hybrid", current_action: { type: "submit_checkpoint" } }));
  expect(hy.action.label).toBe("Start Checkpoint");
  const done = clientNextStep(home({ current_action: { type: "course_complete" } }));
  expect(done).toMatchObject({ state: "program_complete", action: { label: "View Progress", run: "progress" }, secondary: { label: "Review Course", run: "course" } });
  const lc = lessonCompleteHandoff({ lessonName: "Down", home: home({ current_action: { type: "course_complete" } }) });
  expect(lc.title).toBe("Program complete");
});

test("module quiz: pass → next step, pass on the last module → program complete, fail → try again (a training outcome, not an error)", () => {
  const pass = quizHandoff({ passed: true, score_percent: 90, correct_count: 9, question_count: 10, course_completed: false }, home({ current_action: { type: "lesson" } }));
  expect(pass).toMatchObject({ state: "complete", title: "Module quiz passed", action: { label: "Continue Lesson" } });
  const last = quizHandoff({ passed: true, score_percent: 100, correct_count: 5, question_count: 5, course_completed: true }, home());
  expect(last).toMatchObject({ state: "program_complete", action: { label: "View Progress", run: "progress" } });
  const fail = quizHandoff({ passed: false, score_percent: 40, correct_count: 2, question_count: 5 }, home());
  expect(fail).toMatchObject({ state: "needs_work", title: "Almost there", action: { label: "Try Again", run: "retry" } });
});

// ---------------------------------------------------------------------------
// Scope: deep links, multiple dogs, multiple programs, refresh
// ---------------------------------------------------------------------------

const appSrc = read("..", "screens", "SchoolApp.jsx");
const homeSrc = read("..", "components", "school", "student", "StudentHome.jsx");
const lessonSrc = read("..", "components", "school", "student", "LessonScreen.jsx");

test("every landing reads the FRESH home of the SELECTED enrollment and stamps the handoff with it", () => {
  // deep-linked lesson, Today, Course, Coach: the lesson screen's advance and the shell's advance both land here
  expect(appSrc).toMatch(/const landLessonComplete = useCallback\(async \(previousLessonName\) => \{\s+const enrollmentId = selectedId;\s+let fresh = null;\s+try \{\s+const res = await api\.get\(`\/portal\/school\/\$\{enrollmentId\}\/home`\);/);
  expect(appSrc).toMatch(/setHandoff\(\{ enrollmentId, \.\.\.lessonCompleteHandoff\(\{ lessonName: previousLessonName, home: fresh \|\| home, scope: \{ enrollmentId \} \}\) \}\);/);
  expect(appSrc).toMatch(/onAdvanced=\{\(_res, previousLessonName\) => landLessonComplete\(previousLessonName\)\}/);
  expect(lessonSrc).toMatch(/onAdvanced\?\.\(res, data\?\.lesson\?\.name \|\| null\);/);
  // Practice completion: same rule since Stage 4
  expect(appSrc).toMatch(/return practiceCompletionHandoff\(freshHome \|\| home, hwId\);/);
});

test("multiple dogs / programs: a handoff from Dog A is never shown while Dog B is selected", () => {
  const mounts = appSrc.match(/handoff=\{handoff && handoff\.enrollmentId === selectedId \? handoff : null\}/g) || [];
  expect(mounts.length).toBe(2);
  expect(homeSrc).toMatch(/\{handoff && !completed && \(/);
});

test("the handoff is presentation state only: cleared when the client acts or leaves Today, never stored, never a replayed mutation", () => {
  expect(appSrc).toMatch(/if \(view !== "today" && view !== "home"\) setHandoff\(null\);/);
  expect(appSrc).toMatch(/onHandoffAction=\{\(a\) => \{\s+setHandoff\(null\);/);
  for (const src of [appSrc, homeSrc, lessonSrc, read("handoff.js"), read("..", "components", "HandoffPanel.jsx")]) {
    expect(src).not.toMatch(/localStorage\.setItem\([^)]*handoff|sessionStorage\.setItem\([^)]*handoff/);
  }
  // the lesson screen's own moments are component state, reconstructed from canonical data after a reload
  expect(lessonSrc).toMatch(/const \[lessonJustCompleted, setLessonJustCompleted\] = useState\(false\);/);
  expect(lessonSrc).toMatch(/const \[cpJustSubmitted, setCpJustSubmitted\] = useState\(false\);/);
});

test("a refused self-advance is an application message, not silence", () => {
  expect(appSrc).not.toMatch(/catch \{ \/\* backend gate holds \*\/ \}/);
  expect(appSrc).toMatch(/title: "Couldn't move on yet"/);
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

test("the panel is Result → Next → Action, uses a real heading and buttons, and shows its state in words", () => {
  const html = render(lessonCompleteHandoff({ lessonName: "Place With Duration", home: home({ current_action: { type: "practice" } }) }), { testid: "today-handoff" });
  expect(html).toMatch(/<section role="status" aria-live="polite" data-testid="today-handoff" data-state="complete"/);
  expect(html).toMatch(/<h2 tabindex="-1"[^>]*data-testid="today-handoff-title">Lesson complete<\/h2>/);
  const t = text(html);
  expect(t).toMatch(/Done Lesson complete You finished Place With Duration\. Next Practice what you learned before continuing\. Start Practice Back to Today/);
  const order = ["today-handoff-title", "today-handoff-next", "today-handoff-action", "today-handoff-secondary"].map((id) => html.indexOf(`data-testid="${id}"`));
  expect(order.every((i) => i > 0) && [...order].sort((a, b) => a - b).join() === order.join()).toBe(true);
  expect(html).toMatch(/<button type="button"[^>]*data-testid="today-handoff-action"/);
});

test("waiting renders calmly with no fake primary; errors are a different role; testids can be remapped", () => {
  const waiting = render(checkpointSubmittedHandoff({ lessonName: "Place Skills" }));
  expect(waiting).toMatch(/data-state="waiting"/);
  expect(waiting).not.toMatch(/handoff-action"/);
  expect(text(waiting)).toMatch(/^Waiting Checkpoint submitted/);
  const err = render(makeHandoff({ state: "error", title: "Couldn't move on yet", summary: "Complete today's Practice first." }));
  expect(err).toMatch(/<section role="alert"/);
  expect(text(err)).toMatch(/Something went wrong Couldn't move on yet/);
  const mapped = render(practiceCompletionHandoff(home({ journey: { now: { kind: "practice", title: "Practice", practice: { id: "hw-1" } }, next: null } }), "hw-1"), { ids: { title: "practice-complete-title", next: "practice-complete-next", secondary: "practice-complete-continue" } });
  expect(mapped).toMatch(/data-testid="practice-complete-title"/);
  expect(mapped).toMatch(/data-testid="practice-complete-next"/);
  expect(mapped).toMatch(/data-testid="practice-complete-continue"/);
});

test("button vocabulary is the normalised set", () => {
  expect(Object.values(HANDOFF_LABELS)).toEqual(expect.arrayContaining(["Start Practice", "Continue Practice", "Continue Lesson", "Start Checkpoint", "View Results", "Back to Today", "View Progress", "Return to Training"]));
  for (const bad of ["Proceed", "Continue On", "Advance", "Go"]) expect(Object.values(HANDOFF_LABELS)).not.toContain(bad);
  const buttons = [trainerSaveHandoff({}), practiceReviewHandoff("looks_good", {}), checkpointGradeHandoff({ outcome: "advance" }, {})].flatMap((h) => [h.action?.label, h.secondary?.label]).filter(Boolean);
  for (const b of buttons) expect(["Proceed", "Next", "Continue On", "Go", "Advance"]).not.toContain(b);
});
