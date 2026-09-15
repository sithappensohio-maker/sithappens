/* Stage 6 — Trainer 60-second briefing.
 *
 * Render tests (renderToStaticMarkup) for the presentational component across
 * the states the backend view-model produces, plus source guards pinning how
 * the workspace mounts it: from the SAME bootstrap payload (no extra fetch),
 * before the working interface, with Start / Resume only revealing the
 * workspace (never a second draft), and the checkpoint action wired to the
 * one existing review queue from the screens that own it.
 */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const TrainerBriefing = require("./TrainerBriefing.jsx").default;
const { primaryActionFor } = require("./TrainerBriefing.jsx");

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const baseSrc = read("..", "TrainingSessionWorkspaceBase.jsx");
const pipelineSrc = read("..", "..", "screens", "Pipeline.jsx");
const dashboardSrc = read("..", "..", "screens", "Dashboard.jsx");

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const briefing = (over = {}) => ({
  today: { lesson_name: "Place With Distractions", lesson_number: 5, lesson_count: 8, program_name: "Basic Obedience", module_name: "Module 2",
           training_mode: "in_person", is_final_lesson: false, is_checkpoint_lesson: false, objective: "30 seconds on Place while the door opens." },
  last_session: { lesson_name: "Place With Duration", at: "2026-09-10T15:00:00+00:00", when: "4 days ago", by: "Garrett", same_lesson: false,
                  what_went_well: "Held Place for 20 seconds.", needs_work: "Broke position when the door opened.", next_lesson_focus: "Door distractions.",
                  skills: [{ name: "Door distraction", score: 2, assessment: "Needs more work", mastery: null }, { name: "Place duration", score: 3, assessment: "Improving", mastery: null }],
                  advancement_label: "Moved to the next lesson", legacy: false, summary_line: "Completed with Garrett · 4 days ago · Moved to the next lesson" },
  practice: { state: "partial", headline: "4 of 5 planned days completed.", detail: null, planned: 5, completed: 4, sessions_logged: 0,
              last_practiced_at: "2026-09-13T20:00:00+00:00", last_practiced_label: "Yesterday", quality: ["2 days approved by trainer"], items: [{ title: "Place Practice", line: "4 of 5 planned days" }], all_optional: false, review_waiting: 0 },
  client_reports: [{ kind: "practice_note", text: "Did well until visitors came over.", at: "2026-09-13T20:00:00+00:00", source: "Practice note · Place Practice · Day 4" }],
  focus: { text: "Door distractions.", source: "previous_focus", source_label: "From your last session", goal: "30 seconds on Place while the door opens.", purpose: null, conflict: null },
  checkpoint: null,
  attention: [],
  session: { status: "draft", has_recorded_work: false, recorded_skills: 0, created_at: "2026-09-14T10:00:00+00:00", created_by_name: "Garrett", session_label: "" },
  ...over,
});

const render = (b, draft = { status: "draft" }, extra = {}) =>
  renderToStaticMarkup(React.createElement(TrainerBriefing, { briefing: b, dog: { name: "Duke", photo: "" }, draft, onStart: () => {}, onClose: () => {}, ...extra }));

test("the briefing leads with today's lesson, then last time, Practice, client report and focus — in that order", () => {
  const html = render(briefing());
  const order = ["briefing-today", "briefing-last", "briefing-practice", "briefing-client-reported", "briefing-focus", "briefing-primary-action"]
    .map((id) => html.indexOf(`data-testid="${id}"`));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const t = text(html);
  expect(t).toMatch(/Today Place With Distractions Lesson 5 of 8 · Basic Obedience · Trainer-Led/);
  expect(t).toMatch(/Last time Place With Duration Completed with Garrett · 4 days ago · Moved to the next lesson/);
  expect(t).toMatch(/Door distraction 2\/5 · Needs more work Place duration 3\/5 · Improving/);
  expect(t).toMatch(/Went well · Held Place for 20 seconds\./);
  expect(t).toMatch(/Needs work · Broke position when the door opened\./);
  expect(t).toMatch(/Home Practice 4 of 5 planned days completed\. Last practised: Yesterday · 2 days approved by trainer/);
  expect(t).toMatch(/Client reported “Did well until visitors came over\.” Practice note · Place Practice · Day 4/);
  expect(t).toMatch(/Today's focus Door distractions\. From your last session Goal · 30 seconds on Place while the door opens\./);
  expect(t).toMatch(/Start Lesson/);
  // no raw enums / ids anywhere on screen
  expect(t).not.toMatch(/\b(in_person|needs_redo|prescribe_practice|previous_focus|enrollment_id|advance_next)\b/);
});

test("Start vs Resume vs Open come from the draft, never from a second session", () => {
  expect(primaryActionFor(briefing(), { status: "draft" })).toEqual({ key: "start", label: "Start Lesson" });
  const inProgress = briefing({ session: { status: "draft", has_recorded_work: true, recorded_skills: 2, created_by_name: "Garrett" },
                                attention: [{ kind: "resume_session", text: "A session is already in progress for today — resume it, don't start over." }] });
  expect(primaryActionFor(inProgress, { status: "draft" })).toEqual({ key: "resume", label: "Resume Lesson" });
  const html = render(inProgress);
  expect(html).toMatch(/data-primary-action="resume"/);
  expect(text(html)).toMatch(/Resume Lesson 2 skills already recorded today · opened by Garrett/);
  expect(text(html)).toMatch(/Needs attention A session is already in progress for today/);
  expect(primaryActionFor(briefing(), { status: "completed" })).toEqual({ key: "view", label: "Open Session Record" });
});

test("hybrid mode, a checkpoint lesson and the review action route to the existing queue", () => {
  const cp = { state: "submitted", label: "Checkpoint needs review", detail: "Client submitted Checkpoint yesterday. Review it before advancing.", action: "review", submission_id: "sub-1", title: "Checkpoint", trainer_feedback: null };
  const b = briefing({ today: { ...briefing().today, training_mode: "hybrid", is_checkpoint_lesson: true }, checkpoint: cp,
                       attention: [{ kind: "checkpoint_review", text: "Checkpoint submitted — review it before this lesson." }] });
  let seen = null;
  const html = render(b, { status: "draft" }, { onReviewCheckpoint: (c) => { seen = c; } });
  const t = text(html);
  expect(t).toMatch(/Today's checkpoint Place With Distractions Lesson 5 of 8 · Basic Obedience · Hybrid/);
  expect(html).toMatch(/data-testid="briefing-checkpoint" data-state="submitted"/);
  expect(t).toMatch(/Checkpoint needs review Client submitted Checkpoint yesterday/);
  expect(html).toMatch(/data-testid="briefing-review-checkpoint"/);
  // without a queue owner the briefing still tells the trainer where to go
  const plain = render(b);
  expect(plain).toMatch(/data-testid="briefing-review-checkpoint-hint"/);
  expect(text(plain)).toMatch(/Review it from Training → Checkpoints/);
  expect(seen).toBeNull();
});

test("checkpoint remediation, more Practice and passed states read plainly", () => {
  const more = render(briefing({ checkpoint: { state: "more_practice", label: "More Practice required", detail: "2 more Practice sessions before the client can try again.", action: null, trainer_feedback: "Nearly there." } }));
  expect(text(more)).toMatch(/More Practice required 2 more Practice sessions before the client can try again\. Your feedback: “Nearly there\.”/);
  const passed = render(briefing({ checkpoint: { state: "passed", label: "Checkpoint passed", detail: "Passed today. This dog is clear to advance.", action: null } }));
  expect(passed).toMatch(/data-state="passed"/);
  expect(text(passed)).toMatch(/Checkpoint passed Passed today\. This dog is clear to advance\./);
});

test("Practice adherence is truthful in every state and optional work is not a failure", () => {
  const cases = [
    [{ state: "completed", headline: "5 of 5 planned days completed.", last_practiced_label: "Yesterday", quality: [], items: [] }, /5 of 5 planned days completed\. Last practised: Yesterday/],
    [{ state: "none", headline: "No Practice logged since the last lesson.", last_practiced_label: null, quality: [], items: [] }, /No Practice logged since the last lesson\./],
    [{ state: "not_assigned", headline: "No home Practice was assigned after the last session.", quality: [], items: [] }, /No home Practice was assigned after the last session\./],
    [{ state: "needs_redo", headline: "Day 2 of Place Practice was sent back for another try.", detail: "Slow down before the door.", quality: ["1 day sent back for another try"], items: [] }, /sent back for another try\. Your note: “Slow down before the door\.” · 1 day sent back/],
    [{ state: "optional_incomplete", headline: "Optional Practice — nothing logged.", quality: [], items: [] }, /Optional Practice — nothing logged\./],
    [{ state: "partial", headline: "2 Practice sessions logged since the last lesson.", quality: ["1 waiting for your review", "Client marked 1 session hard"], items: [] }, /2 Practice sessions logged since the last lesson\. · 1 waiting for your review · Client marked 1 session hard/],
  ];
  for (const [practice, re] of cases) {
    const html = render(briefing({ practice: { ...briefing().practice, last_practiced_label: null, detail: null, ...practice } }));
    expect(text(html)).toMatch(re);
    expect(html).toMatch(new RegExp(`data-state="${practice.state}"`));
  }
});

test("a focus conflict shows both the previous trainer focus and the lesson objective", () => {
  const html = render(briefing({ focus: { text: null, source: null, source_label: null, goal: "Increase duration to 45 seconds.", purpose: null,
                                          conflict: { previous: "Door distraction", previous_lesson: "Place With Duration", current_objective: "Increase duration to 45 seconds." } } }));
  expect(html).toMatch(/data-testid="briefing-focus-conflict"/);
  expect(text(html)).toMatch(/Previous trainer focus \(Place With Duration\) · Door distraction Current lesson objective · Increase duration to 45 seconds\./);
});

test("first lesson, legacy history and a missing client report degrade to honest text — never blank boxes", () => {
  const first = text(render(briefing({ last_session: null, client_reports: [], practice: { state: "not_assigned", headline: "No home Practice assigned yet.", quality: [], items: [] },
                                        focus: { text: "30 seconds on Place while the door opens.", source: "lesson_objective", source_label: "Lesson objective", goal: null, conflict: null } })));
  expect(first).toMatch(/Last time No trainer session on this program yet\. This is the first lesson\./);
  expect(first).not.toMatch(/Client reported/);
  expect(first).toMatch(/Today's focus 30 seconds on Place while the door opens\. Lesson objective/);
  const legacy = text(render(briefing({ last_session: { lesson_name: "Lesson 4", summary_line: "Completed with Garrett · Sep 3 · Stayed on this lesson", legacy: true, skills: [], what_went_well: null, needs_work: null, next_lesson_focus: null } })));
  expect(legacy).toMatch(/Last time Lesson 4 Completed with Garrett · Sep 3 · Stayed on this lesson No written summary was recorded for that session\./);
  expect(legacy).not.toMatch(/Went well ·|Needs work ·/);
});

test("the workspace shows the briefing first, from the same bootstrap payload, and Start only reveals the workspace", () => {
  expect(baseSrc).toMatch(/import TrainerBriefing from "\.\/training\/TrainerBriefing"/);
  // Stage 7 — BEFORE is a phase of the same workspace; the briefing is its body.
  expect(baseSrc).toMatch(/const \[phase, setPhaseState\] = useState\("before"\)/);
  expect(baseSrc).toMatch(/<TrainerBriefing embedded briefing=\{briefing\} dog=\{dog\} draft=\{draft\} onStart=\{startLesson\}/);
  expect(baseSrc).toMatch(/const startLesson = \(\) => setPhase\(resumePhase\(draft\)\);/);
  // the wrapper no longer floats a control over the workspace at all
  const wrapperSrc = read("..", "TrainingSessionWorkspace.jsx");
  expect(wrapperSrc).not.toMatch(/fixed z-\[70\]/);
  expect(wrapperSrc).toMatch(/manualProgress=\{options\?\.future_lessons\?\.length \? \{ open: openControl/);
  // every new draft (another dog, another program) opens at the briefing again
  expect(baseSrc).toMatch(/useEffect\(\(\) => \{ if \(draftId\) setPhaseState\("before"\); \}, \[draftId\]\);/);
  // exactly the one bootstrap POST per entry route — no briefing fetch
  expect((baseSrc.match(/api\.(get|post)\(/g) || []).length).toBe(3); // booking draft, direct draft, complete — nothing else
  expect(baseSrc).not.toMatch(/\/briefing`?\)/);
  expect(baseSrc).toContain('data-testid={`phase-nav-${p.key}`}'); // the way back to the briefing
});

test("Today's Training Dogs and the dashboard route the checkpoint action to the one existing review queue", () => {
  expect(pipelineSrc).toMatch(/onReviewCheckpoint=\{\(\) => \{ setWorkspaceFor\(null\); setCheckpointFor\(\{ open: true, submissionId: null \}\); \}\}/);
  expect(dashboardSrc).toMatch(/onReviewCheckpoint=\{\(\)=>\{ setTrainingTrackerFor\(null\); setCheckpointQueueOpen\(true\); \}\}/);
});
