// School Reviews Center + Practice Reviews + Checkpoint Grading Polish +
// Module Quizzes — source-level regression guards, matching this repo's
// established convention (see checkpointEntryPoints.test.js): no rendering;
// component wiring is verified by asserting the source contains the exact
// pattern that implements it.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const schoolHqSrc = read("..", "screens", "SchoolHQ.jsx");
const reviewsPanelSrc = read("school", "SchoolReviewsPanel.jsx");
const reviewQueueSrc = read("CheckpointReviewQueue.jsx");
const programStudioSrc = read("ProgramStudio.jsx");
const practicePanelSrc = read("training", "PracticePanel.jsx");
const contentBlocksSrc = read("school", "student", "LessonContentBlocks.jsx");
const quizPanelSrc = read("school", "student", "ModuleQuizPanel.jsx");
const lessonScreenSrc = read("school", "student", "LessonScreen.jsx");
const progressSrc = read("school", "student", "ProgressScreen.jsx");
const roadmapSrc = read("school", "student", "CourseRoadmap.jsx");
const feedbackSrc = read("school", "student", "FeedbackScreen.jsx");
const schoolAppSrc = read("..", "screens", "SchoolApp.jsx");
const studentsPanelSrc = read("school", "SchoolStudentsPanel.jsx");

// ---------------------------------------------------------------------------
// School HQ → Reviews center
// ---------------------------------------------------------------------------

test("School HQ has a prominent Reviews tab with an aggregate badge", () => {
  expect(schoolHqSrc).toMatch(/key: "reviews", label: "Reviews"/);
  expect(schoolHqSrc).toMatch(/count: s\.reviews_pending/);
  expect(schoolHqSrc).toMatch(/<SchoolReviewsPanel/);
});

test("Reviews contains distinct Practice and Checkpoints sub-navigation with badges", () => {
  expect(reviewsPanelSrc).toMatch(/data-testid="reviews-subtab-practice"/);
  expect(reviewsPanelSrc).toMatch(/data-testid="reviews-subtab-checkpoints"/);
  expect(reviewsPanelSrc).toMatch(/data-testid="reviews-practice-badge"/);
  expect(reviewsPanelSrc).toMatch(/data-testid="reviews-checkpoints-badge"/);
});

test("old checkpoint deep links still resolve — 'checkpoints' tab maps into Reviews", () => {
  expect(schoolHqSrc).toMatch(/if \(t === "checkpoints"\) \{ setReviewType\("checkpoints"\); setTabRaw\("reviews"\); return; \}/);
});

test("practice deep links target the exact homework/log in the Reviews queue", () => {
  expect(schoolHqSrc).toMatch(/section_log_id: dl\.section_log_id \|\| item\.metadata\?\.section_log_id/);
  expect(reviewsPanelSrc).toMatch(/initialTarget\?\.section_log_id/);
});

test("the practice review queue rows carry dog/client/course/lesson context and open a detail view", () => {
  expect(reviewsPanelSrc).toMatch(/row\.program_name, row\.module_name, row\.lesson_name/);
  expect(reviewsPanelSrc).toMatch(/data-testid="practice-review-detail"/);
});

test("practice review offers exactly the three coaching actions — never scores", () => {
  expect(reviewsPanelSrc).toMatch(/data-testid="practice-review-looks-good"/);
  expect(reviewsPanelSrc).toMatch(/data-testid="practice-review-keep-practicing"/);
  expect(reviewsPanelSrc).toMatch(/data-testid="practice-review-trainer-attention"/);
  expect(reviewsPanelSrc).not.toMatch(/handler_scores|dog_scores/);
});

// ---------------------------------------------------------------------------
// Practice video wiring
// ---------------------------------------------------------------------------

test("non-daily practice uploads through the section practice-video route", () => {
  expect(practicePanelSrc).toMatch(/\/practice-video/);
  expect(practicePanelSrc).toMatch(/video_media_id: sectionVideoAllowed \? \(videoId \|\| ""\) : ""/);
});

test("the practice timer lives where the reps happen — guided screen and quick/legacy form, never only the after-guided completion form", () => {
  // The mobile UX fix put the cue + scoring buttons FIRST on the guided
  // screen; the optional timer follows the rep loop instead of preceding it.
  expect(practicePanelSrc).toMatch(/<GuidedPracticeFlow[\s\S]*?\/>\s*\{timerCard\}/);
  // The wrap-up redesign renders the live timer in exactly two places — the
  // guided screen and the quick/legacy form branch; after guided practice
  // the elapsed time is reported as a tracked result chip instead.
  expect((practicePanelSrc.match(/\{timerCard\}/g) || []).length).toBe(2);
  expect(practicePanelSrc).toMatch(/if \(timerSec > 0\) items\.push\(\{ key: "guided-time"/);
});

test("section video control appears only when the recipe requests video", () => {
  expect(practicePanelSrc).toMatch(/const sectionVideoAllowed = !isDailyTracker && !!practiceCoach\?\.media\?\.request_video/);
  expect(practicePanelSrc).toMatch(/allowVideo=\{isDailyTracker \|\| sectionVideoAllowed\}/);
});

// ---------------------------------------------------------------------------
// Checkpoint grading polish
// ---------------------------------------------------------------------------

test("checkpoint scores no longer default to 3 — grading opens with empty score maps", () => {
  expect(reviewQueueSrc).toMatch(/setHandlerScores\(\{\}\);/);
  expect(reviewQueueSrc).toMatch(/setDogScores\(\{\}\);/);
  expect(reviewQueueSrc).not.toMatch(/\.map\(c => \[c\.id, 3\]\)/);
});

test("checkpoint grading offers only 1-5 (no 0) and gates actions until every criterion is scored", () => {
  expect(reviewQueueSrc).toMatch(/\{\[1, 2, 3, 4, 5\]\.map\(n =>/);
  expect(reviewQueueSrc).not.toMatch(/\[0, 1, 2, 3, 4, 5\]/);
  expect(reviewQueueSrc).toMatch(/const allScored =/);
  expect(reviewQueueSrc).toMatch(/disabled=\{busy \|\| !allScored\}/);
  expect(reviewQueueSrc).toMatch(/data-testid="checkpoint-review-incomplete-scores"/);
});

test("the 1-5 scale legend and its meanings are rendered while grading", () => {
  expect(reviewQueueSrc).toMatch(/Needs significant work/);
  expect(reviewQueueSrc).toMatch(/Excellent \/ ready/);
  expect(reviewQueueSrc).toMatch(/data-testid="checkpoint-score-legend"/);
});

test("criterion guidance and pass/readiness guidance are shown to the trainer", () => {
  expect(reviewQueueSrc).toMatch(/checkpoint-criterion-guidance-/);
  expect(reviewQueueSrc).toMatch(/data-testid="checkpoint-pass-readiness-guidance"/);
  expect(reviewQueueSrc).toMatch(/rubric_snapshot\.pass_readiness_guidance/);
});

test("running Handler/Dog score summaries are computed from criterion means", () => {
  expect(reviewQueueSrc).toMatch(/function ScoreSummary/);
  expect(reviewQueueSrc).toMatch(/partial/);
});

test("decision labels read Pass Checkpoint / Practice & Resubmit / Recommend Trainer Assist", () => {
  expect(reviewQueueSrc).toMatch(/Pass Checkpoint/);
  expect(reviewQueueSrc).toMatch(/Practice &amp; Resubmit/);
  expect(reviewQueueSrc).toMatch(/Recommend Trainer Assist/);
  expect(reviewQueueSrc).not.toMatch(/Advance to Next Lesson/);
});

// ---------------------------------------------------------------------------
// Module Quiz authoring (Program Studio)
// ---------------------------------------------------------------------------

test("Module Editor exposes the Module Quiz builder with enable toggle", () => {
  expect(programStudioSrc).toMatch(/function ModuleQuizEditor/);
  expect(programStudioSrc).toMatch(/data-testid="module-quiz-enabled-toggle"/);
});

test("quiz builder has passing score, questions, explanations, and a review-lesson dropdown", () => {
  expect(programStudioSrc).toMatch(/data-testid="module-quiz-passing-score"/);
  expect(programStudioSrc).toMatch(/data-testid="module-quiz-add-question"/);
  expect(programStudioSrc).toMatch(/module-quiz-explanation-/);
  expect(programStudioSrc).toMatch(/module-quiz-review-lesson-/);
  // Trainer never pastes lesson ids — the review lesson is a <select>.
  expect(programStudioSrc).toMatch(/onChange=\{\(e\) => setQuestion\(qi, \{ review_lesson_id: e\.target\.value \|\| null \}\)\}/);
});

test("quiz question types are exactly multiple choice and true/false", () => {
  expect(programStudioSrc).toMatch(/value="multiple_choice">Multiple choice/);
  expect(programStudioSrc).toMatch(/value="true_false">True \/ False/);
});

// ---------------------------------------------------------------------------
// Lesson Knowledge Check stays separate and non-gating
// ---------------------------------------------------------------------------

test("the lesson Knowledge Check block still declares itself non-gating", () => {
  expect(contentBlocksSrc).toMatch(/Knowledge checks reinforce the lesson; they do not unlock or block course progression\./);
});

test("the content-block palette labels the quiz block as Knowledge Check", () => {
  expect(programStudioSrc).toMatch(/\["quiz","Knowledge Check"\]/);
});

// ---------------------------------------------------------------------------
// Client quiz experience
// ---------------------------------------------------------------------------

test("client quiz submissions send only answers + idempotency key — no scores", () => {
  expect(quizPanelSrc).toMatch(/answers: questions\.map\(\(q\) => \(\{ question_id: q\.id, selected_option_id: answers\[q\.id\] \}\)\)/);
  expect(quizPanelSrc).toMatch(/idempotency_key: idemKey/);
  expect(quizPanelSrc).not.toMatch(/score_percent:\s|passed:\strue/);
});

test("client quiz UI never derives correctness locally — no embedded correct answers pre-submit", () => {
  // Correct answers appear only in the POST result rendering, never against
  // the GET question payload.
  expect(quizPanelSrc).not.toMatch(/q\.correct_option_id|question\.correct_option_id/);
});

test("all questions must be answered before submitting, with a clear message", () => {
  expect(quizPanelSrc).toMatch(/Answer every question first/);
  expect(quizPanelSrc).toMatch(/unanswered > 0/);
});

test("failed quiz renders the encouraging retry experience with review links", () => {
  expect(quizPanelSrc).toMatch(/Almost There —/);
  expect(quizPanelSrc).toMatch(/data-testid="module-quiz-try-again"/);
  expect(quizPanelSrc).toMatch(/quiz-review-lesson-/);
  expect(quizPanelSrc).not.toMatch(/FAILED/);
});

test("passed quiz renders the continue experience and never re-advances client-side", () => {
  expect(quizPanelSrc).toMatch(/Passed — \{Math\.round\(result\.score_percent\)\}%/);
  expect(quizPanelSrc).toMatch(/data-testid="module-quiz-continue"/);
  expect(quizPanelSrc).toMatch(/Server already advanced during the passing submit/);
});

test("the lesson screen surfaces the quiz gate and routes the advance 409 into the quiz", () => {
  expect(lessonScreenSrc).toMatch(/data-testid="lesson-take-module-quiz"/);
  expect(lessonScreenSrc).toMatch(/module_quiz_required/);
  expect(lessonScreenSrc).toMatch(/Trainer Checkpoint Passed/);
});

test("SchoolApp hosts the quiz panel and the module_quiz action opens it", () => {
  expect(schoolAppSrc).toMatch(/<ModuleQuizPanel/);
  expect(schoolAppSrc).toMatch(/t === "module_quiz"/);
});

// ---------------------------------------------------------------------------
// Progress / roadmap / trainer visibility
// ---------------------------------------------------------------------------

test("Progress renders module quiz status and expandable attempt history", () => {
  expect(progressSrc).toMatch(/data-testid="progress-module-quizzes"/);
  expect(progressSrc).toMatch(/quiz\/attempts/);
});

test("the course roadmap shows a quiz chip per gated module", () => {
  expect(roadmapSrc).toMatch(/moduleQuizChip/);
  expect(roadmapSrc).toMatch(/course-module-quiz-/);
});

test("client Feedback shows practice review coaching with status wording", () => {
  expect(feedbackSrc).toMatch(/data-testid="native-practice-reviews"/);
  expect(feedbackSrc).toMatch(/Looks Good/);
  expect(feedbackSrc).toMatch(/Keep Practicing/);
});

test("School HQ student detail shows module quiz summaries (informational only)", () => {
  expect(studentsPanelSrc).toMatch(/data-testid="student-module-quizzes"/);
  expect(studentsPanelSrc).toMatch(/module_quizzes/);
});

// ---------------------------------------------------------------------------
// Mobile-safety spot checks — no fixed-width overflow constructs introduced
// ---------------------------------------------------------------------------

test("new panels use overflow-safe containers and wrap long text", () => {
  expect(quizPanelSrc).toMatch(/overflow-y-auto/);
  expect(quizPanelSrc).toMatch(/break-words/);
  expect(reviewsPanelSrc).toMatch(/min-w-0/);
  expect(reviewsPanelSrc).toMatch(/whitespace-pre-wrap/);
});
