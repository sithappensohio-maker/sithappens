// Trainer Lesson Workspace — source-level regression guards, matching this
// repo's established convention (see onlineSchoolEntryPoints.test.js /
// checkpointEntryPoints.test.js): no React Testing Library rendering —
// behaviors that depend on component wiring are verified by asserting the
// source contains the exact pattern that implements them. Live interaction
// is verified in the browser as part of the release report.
//
// The privacy guarantees here are ALSO asserted at the API level in
// backend/test_trainer_lesson_workspace.py — these UI guards are the second
// layer, never the only one.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

// The workspace is deliberately split: TrainingSessionWorkspace.jsx wraps the
// optional manual In-Person progression control around the proven base
// implementation in TrainingSessionWorkspaceBase.jsx. Every pinned behaviour
// below must hold across the pair, so read them as one source.
const workspaceSrc =
  read("TrainingSessionWorkspace.jsx") + read("TrainingSessionWorkspaceBase.jsx");
const historySrc = read("school", "student", "LessonHistoryScreen.jsx");
const schoolAppSrc = read("..", "screens", "SchoolApp.jsx");
const progressSrc = read("school", "student", "ProgressScreen.jsx");

// ---------------------------------------------------------------------------
// Trainer workspace — assessment controls
// ---------------------------------------------------------------------------

test("the six-level assessment reuses the canonical outcome field, keeping the original four keys", () => {
  for (const key of ["skipped", "introduced", "needs_more_work", "improving", "passed", "reliable"]) {
    expect(workspaceSrc).toMatch(new RegExp(`key: "${key}"`));
  }
  // the pre-existing keys must not have been renamed out from under old drafts
  expect(workspaceSrc).toMatch(/\{ key: "passed", label: "Good"/);
  expect(workspaceSrc).toMatch(/\{ key: "skipped", label: "Not Worked"/);
});

test("scoring and assessment are few-tap, touch-sized controls rather than a table", () => {
  expect(workspaceSrc).toMatch(/data-testid=\{`activity-\$\{a\.id\}-assessment`\}/);
  expect(workspaceSrc).toMatch(/grid-cols-3 sm:grid-cols-6/);      // 3-up on phones
  expect(workspaceSrc).toMatch(/min-h-\[38px\][^"]*rounded text-\[10px\]/); // tap target
  expect(workspaceSrc).toMatch(/SkillLevelIndicator score=\{actual\.score \?\? -1\}/);
});

test("mastery is an explicit, separately-toggled decision — never derived from the score", () => {
  expect(workspaceSrc).toMatch(/data-testid=\{`activity-\$\{a\.id\}-mastery-mastered`\}/);
  expect(workspaceSrc).toMatch(/data-testid=\{`activity-\$\{a\.id\}-mastery-not-yet`\}/);
  // toggling off returns to "no decision today"
  expect(workspaceSrc).toMatch(/mastery_decision: actual\.mastery_decision === "mastered" \? null : "mastered"/);
  expect(workspaceSrc).toMatch(/mastery_decision: actual\.mastery_decision === "not_yet" \? null : "not_yet"/);
});

// ---------------------------------------------------------------------------
// Trainer workspace — staff/client separation
// ---------------------------------------------------------------------------

test("per-skill client observation and private trainer note are two distinct fields", () => {
  expect(workspaceSrc).toMatch(/data-testid=\{`activity-\$\{a\.id\}-client-observation`\}/);
  expect(workspaceSrc).toMatch(/data-testid=\{`activity-\$\{a\.id\}-private-note`\}/);
  expect(workspaceSrc).toMatch(/onChange\(\{ client_observation: e\.target\.value \}\)/);
  expect(workspaceSrc).toMatch(/onChange\(\{ notes: e\.target\.value \}\)/);
  // and they are visually distinguishable, not two identical boxes
  expect(workspaceSrc).toMatch(/never sent to the client/);
  expect(workspaceSrc).toMatch(/the owner reads this in their recap/);
});

test("the two session-level notes are labelled unmistakably", () => {
  expect(workspaceSrc).toMatch(/Private trainer note · never shown to the client/);
  expect(workspaceSrc).toMatch(/Client recap note · the owner reads this/);
});

test("the three structured summary fields exist and are autosaved", () => {
  for (const f of ["what_went_well", "needs_work", "next_lesson_focus"]) {
    expect(workspaceSrc).toMatch(new RegExp(`updateDraft\\(\\{ ${f}: e\\.target\\.value \\}\\)`));
    expect(workspaceSrc).toMatch(new RegExp(`${f}: d\\.${f},`)); // included in the PUT
  }
  expect(workspaceSrc).toMatch(/data-testid="workspace-lesson-summary"/);
});

// ---------------------------------------------------------------------------
// Trainer workspace — checkpoint gate + handoff
// ---------------------------------------------------------------------------

test("the checkpoint gate 409 is surfaced as an explanation, not a generic toast", () => {
  expect(workspaceSrc).toMatch(/detail\?\.error_code === "checkpoint_required_before_advancement"/);
  expect(workspaceSrc).toMatch(/data-testid="workspace-checkpoint-blocked"/);
  // the workspace stays open and says the recorded work is safe
  expect(workspaceSrc).toMatch(/Everything you recorded is saved/);
});

test("the previous-session handoff shows real context, not just the last note", () => {
  expect(workspaceSrc).toMatch(/data-testid="workspace-last-lesson-handoff"/);
  expect(workspaceSrc).toMatch(/overview\.last_session\.strongest_skills/);
  expect(workspaceSrc).toMatch(/overview\.last_session\.needs_work_skills/);
  expect(workspaceSrc).toMatch(/overview\.last_session\.practice_assigned/);
  expect(workspaceSrc).toMatch(/overview\.last_session\.next_lesson_focus/);
});

// ---------------------------------------------------------------------------
// Client lesson history
// ---------------------------------------------------------------------------

test("client lesson history reads the per-attempt endpoint, never a cross-dog feed", () => {
  expect(historySrc).toMatch(/api\.get\(`\/portal\/school\/\$\{enrollmentId\}\/lesson-history`\)/);
  expect(schoolAppSrc).toMatch(/<LessonHistoryScreen enrollmentId=\{selectedId\}/);
});

test("client history renders score, assessment and client-safe observation per skill", () => {
  expect(historySrc).toMatch(/<ScorePips score=\{s\.score\}/);
  expect(historySrc).toMatch(/ASSESSMENT_LABELS\[s\.assessment\]/);
  expect(historySrc).toMatch(/\{s\.observation &&/);
});

test("client history renders the structured summary and practice", () => {
  for (const f of ["what_went_well", "needs_work", "trainer_feedback", "practice_assigned"]) {
    expect(historySrc).toMatch(new RegExp(`l\\.${f}`));
  }
  expect(historySrc).toMatch(/data-testid="lesson-history-progress"/);
});

test("the client history component never references any staff-only field", () => {
  // Privacy is enforced server-side by an allowlist; this guard makes sure a
  // future edit doesn't start reaching for internal fields in the UI either.
  for (const forbidden of ["session_note", "private", "internal", "goal_updates", "grading_plan"]) {
    expect(historySrc.toLowerCase()).not.toContain(forbidden.toLowerCase() + '"');
  }
  expect(historySrc).not.toMatch(/l\.session_note/);
  expect(historySrc).not.toMatch(/s\.notes/);
});

test("training history is reachable from Progress without adding a 7th mobile nav tab", () => {
  expect(progressSrc).toMatch(/data-testid="progress-open-lesson-history"/);
  expect(schoolAppSrc).toMatch(/onOpenHistory=\{\(\) => go\("lesson_history"\)\}/);
  const navSrc = read("school", "student", "SchoolNav.jsx");
  const itemCount = (navSrc.match(/\{ view: "/g) || []).length;
  expect(itemCount).toBeLessThanOrEqual(6);
});
