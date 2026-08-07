// Client Practice Coach upgrade — source-level regression guards, matching
// this repo's established convention (see portalPracticeEntryPoints.test.js
// / trainingEntryPoints.test.js): no React Testing Library rendering:
// behaviors that depend on component wiring are verified by asserting the
// source contains the exact pattern that implements them. Live interaction
// (Guided Practice tapping through a real round, the authoring Preview tab
// rendering live) is verified in the browser as part of the release report.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const practicePanelSrc = read("training", "PracticePanel.jsx");
const overviewSrc = read("training", "CoachPracticeOverview.jsx");
const guidedSrc = read("training", "GuidedPracticeFlow.jsx");
const setupSrc = read("training", "SetupChecklist.jsx");
const examplesSrc = read("training", "GoodRepNotThisCards.jsx");
const troubleshootingSrc = read("training", "TroubleshootingDrawer.jsx");
const endQuestionsSrc = read("training", "CoachEndQuestions.jsx");
const difficultyFeedbackSrc = read("training", "DifficultyFeedbackNotice.jsx");
const completionPanelSrc = read("training", "PracticeCompletionPanel.jsx");
const mediaUploaderSrc = read("training", "PracticeMediaUploader.jsx");
const editorSrc = read("HomeworkTemplateEditor.jsx");
const pickerSrc = read("HomeworkTemplatePicker.jsx");
const programStudioSrc = read("ProgramStudio.jsx");
const polishSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "practiceCoachPolish.js"), "utf8");

const ALL_COACH_COMPONENT_SRC = [
  practicePanelSrc, overviewSrc, guidedSrc, setupSrc, examplesSrc, troubleshootingSrc,
  endQuestionsSrc, difficultyFeedbackSrc, completionPanelSrc, mediaUploaderSrc, editorSrc,
].join("\n");

// ---------------------------------------------------------------------------
// Generality — no component may branch on a literal exercise name/string to
// determine behavior. This is what proves the SAME components render both
// the Merlin name-response recipe and an unrelated recipe (Place Duration,
// Loose Leash, etc.) — see 05_ACCEPTANCE_TESTS.md #36-38.
// ---------------------------------------------------------------------------

test("no Coach Mode component contains a literal exercise-specific string used to branch behavior", () => {
  for (const needle of ["Merlin", "Name Response", "\"Place\"", "Loose Leash"]) {
    expect(ALL_COACH_COMPONENT_SRC).not.toContain(needle);
  }
});

test("Coach Mode components render every piece of copy from practice_coach data, not hardcoded strings", () => {
  // The overview/guided/examples/setup/troubleshooting components must
  // read goal/success/steps/etc. from the `practiceCoach` prop — never
  // literal placeholder copy standing in for it.
  expect(overviewSrc).toMatch(/pc\.goal/);
  expect(overviewSrc).toMatch(/pc\.success_today/);
  expect(guidedSrc).toMatch(/practiceCoach\?\.guided_practice/);
  expect(setupSrc).toMatch(/items\.map/);
  expect(troubleshootingSrc).toMatch(/items \|\| \[\]\)\.map/);
});

// ---------------------------------------------------------------------------
// PracticePanel — Coach Mode branch, legacy/backward compatibility
// ---------------------------------------------------------------------------

test("PracticePanel renders Coach Mode only when template_snapshot.practice_coach is enabled", () => {
  expect(practicePanelSrc).toMatch(/coachEnabled = hasCoachMode\(homework\)/);
  expect(practicePanelSrc).toMatch(/coachEnabled && viewMode === "overview"/);
  expect(practicePanelSrc).toMatch(/coachEnabled && viewMode === "guided"/);
});

test("legacy/no-Coach-Mode homework defaults straight to the pre-existing simple form, unchanged", () => {
  expect(practicePanelSrc).toMatch(/useState\(coachEnabled && !readOnly \? "overview" : "form"\)/);
});

test("Quick Practice is offered only when the recipe allows it, and skips straight to the completion form", () => {
  expect(practicePanelSrc).toMatch(/onQuickPractice=\{quickPracticeAllowed\(practiceCoach\) \? startQuickPractice : undefined\}/);
  expect(practicePanelSrc).toMatch(/const startQuickPractice = \(\) => \{ setEntryContext\("quick"\); setViewMode\("form"\); \}/);
});

test("the pre-existing polished practice UI is reused as Quick Practice's foundation, not deleted", () => {
  // The same timer + PracticeInstructionSteps + PracticeCompletionPanel
  // block that existed before Coach Mode still renders for the "form" view.
  expect(practicePanelSrc).toMatch(/Practice Timer \(optional\)/);
  expect(practicePanelSrc).toMatch(/<PracticeInstructionSteps text=\{section\.instructions\}/);
});

// ---------------------------------------------------------------------------
// Backward-compatible capability gating — video stays daily-tracker only;
// difficulty/could-not-complete/photo now work for BOTH (see server.py's
// extended SectionLogIn) — never a control whose value is silently dropped.
// ---------------------------------------------------------------------------

test("video upload capability is still gated to daily-tracker only — no section-scoped upload endpoint exists yet", () => {
  expect(practicePanelSrc).toMatch(/allowVideo=\{isDailyTracker\}/);
});

test("difficulty, could-not-complete, and photo are now offered for BOTH daily-tracker and section-log homework", () => {
  expect(practicePanelSrc).toMatch(/allowDifficulty=\{true\}/);
  expect(practicePanelSrc).toMatch(/allowCouldNotComplete=\{true\}/);
  expect(practicePanelSrc).toMatch(/allowPhoto=\{true\}/);
});

test("PracticeCompletionPanel never renders a control whose capability flag is false", () => {
  expect(completionPanelSrc).toMatch(/\{allowDifficulty && \(/);
  expect(completionPanelSrc).toMatch(/\{allowCouldNotComplete && \(/);
  expect(completionPanelSrc).toMatch(/\{allowPhoto && \(/);
});

test("PracticeMediaUploader hides the video control entirely when allowVideo is false, rather than showing a dead button", () => {
  expect(mediaUploaderSrc).toMatch(/\{allowVideo && \(/);
});

// ---------------------------------------------------------------------------
// section-log Ask Trainer — reuses the SAME question object semantics
// ---------------------------------------------------------------------------

test("PracticePanel asks the section-scoped endpoint for non-daily-tracker homework, day-scoped for daily-tracker", () => {
  expect(practicePanelSrc).toMatch(/\/homework\/\$\{homework\.id\}\/day\/\$\{activeDay\.day_number\}\/ask/);
  expect(practicePanelSrc).toMatch(/\/homework\/\$\{homework\.id\}\/section\/\$\{section\.id\}\/ask/);
});

test("TroubleshootingDrawer escalates to the existing Ask Trainer function as its last action", () => {
  expect(troubleshootingSrc).toMatch(/Still stuck\? Ask your trainer/);
  expect(troubleshootingSrc).toMatch(/onAskTrainer\s*&&/);
});

// ---------------------------------------------------------------------------
// Guided Practice persistence boundary — local UI state only, folded into
// the EXISTING submit call, never a second authoritative log engine.
// ---------------------------------------------------------------------------

test("GuidedPracticeFlow keeps round/rep state local (useReducer) — no network calls of its own", () => {
  expect(guidedSrc).toMatch(/useReducer\(/);
  expect(guidedSrc).not.toMatch(/api\.(get|post|put|delete)\(/);
});

test("PracticePanel folds guided metrics into the SAME existing submit call via field_values, not a new endpoint", () => {
  expect(practicePanelSrc).toMatch(/field_values\.__reps_attempted = guidedMetrics\.reps_attempted/);
  expect(practicePanelSrc).toMatch(/field_values\.__successful_reps = guidedMetrics\.successful_reps/);
});

// ---------------------------------------------------------------------------
// Authoring UI — four tabs, real production components in Preview
// ---------------------------------------------------------------------------

test("HomeworkTemplateEditor has exactly the four required tabs", () => {
  expect(editorSrc).toMatch(/const TABS = \["basics", "coach", "troubleshooting", "preview"\]/);
});

test("HomeworkTemplateEditor's Preview tab renders the REAL production client components, not a separate mock", () => {
  expect(editorSrc).toMatch(/import CoachPracticeOverview from "\.\/training\/CoachPracticeOverview"/);
  expect(editorSrc).toMatch(/import GuidedPracticeFlow from "\.\/training\/GuidedPracticeFlow"/);
  expect(editorSrc).toMatch(/import PracticeCompletionPanel from "\.\/training\/PracticeCompletionPanel"/);
  expect(editorSrc).toMatch(/<CoachPracticeOverview practiceCoach=\{pc\}/);
});

test("HomeworkTemplateEditor's preview updates from live draft state, never a publish/assign step", () => {
  expect(editorSrc).not.toMatch(/POST.*\/homework\/from-template/);
  expect(editorSrc).toMatch(/previewHomework = useMemo/);
});

test("readiness checklist never treats missing video as a blocking error", () => {
  expect(editorSrc).toMatch(/ReadinessChecklist/);
  expect(polishSrc).toMatch(/optional: true/);
});

test("setup items, steps, troubleshooting, and end questions all support add/reorder/delete via the shared ListEditor", () => {
  expect(editorSrc).toMatch(/items=\{pc\.setup_items\}.*testid="tpl-setup-items"/s);
  expect(editorSrc).toMatch(/items=\{pc\.steps\}.*testid="tpl-steps"/s);
  expect(editorSrc).toMatch(/items=\{pc\.troubleshooting\}.*testid="tpl-troubleshooting"/s);
  expect(editorSrc).toMatch(/items=\{pc\.end_questions\}.*testid="tpl-end-questions"/s);
});

// ---------------------------------------------------------------------------
// Extends the EXISTING editor/picker rather than a second disconnected tool
// ---------------------------------------------------------------------------

test("the template editor is reached from the existing HomeworkTemplatePicker, not a separate admin screen", () => {
  expect(pickerSrc).toMatch(/import HomeworkTemplateEditor from "\.\/HomeworkTemplateEditor"/);
  expect(pickerSrc).toMatch(/<HomeworkTemplateEditor/);
});

test("Program Studio's existing module homework-template select gets an edit affordance into the SAME editor, not a duplicate", () => {
  expect(programStudioSrc).toMatch(/import HomeworkTemplateEditor from "\.\/HomeworkTemplateEditor"/);
  expect(programStudioSrc).toMatch(/module-edit-homework-template/);
});

// ---------------------------------------------------------------------------
// Token safety
// ---------------------------------------------------------------------------

test("only dog_name and client_first_name are ever substituted — no general template language", () => {
  expect(polishSrc).toMatch(/const TOKEN_WHITELIST = \["dog_name", "client_first_name"\]/);
});
