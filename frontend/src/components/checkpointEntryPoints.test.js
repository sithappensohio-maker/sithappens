// Online School Phase 2 — Trainer Checkpoints & Grading — source-level
// regression guards, matching this repo's established convention (see
// onlineSchoolEntryPoints.test.js / coachModeEntryPoints.test.js): no React
// Testing Library rendering — behaviors that depend on component wiring
// are verified by asserting the source contains the exact pattern that
// implements them. Live interaction is verified in the browser as part of
// the release report.
import fs from "fs";
import path from "path";
import { checkpointState } from "./school/student/checkpoint/CheckpointCards";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const programStudioSrc = read("ProgramStudio.jsx");
const dashboardSrc = read("OnlineSchoolDashboard.jsx");
// Phase 2B+ moved the live checkpoint UI to the native School runtime; the
// legacy dashboard above is dormant. Checkpoint-state guards read the
// canonical native panel instead.
const checkpointPanelSrc = read("school", "student", "CheckpointPanel.jsx");
const cardsSrc = read("school", "student", "checkpoint", "CheckpointCards.jsx");
const reviewQueueSrc = read("CheckpointReviewQueue.jsx");
const uploaderSrc = read("training", "PracticeMediaUploader.jsx");
const dashboardScreenSrc = read("..", "screens", "Dashboard.jsx");
const pipelineScreenSrc = read("..", "screens", "Pipeline.jsx");

// ---------------------------------------------------------------------------
// Program Studio — checkpoint rubric authoring
// ---------------------------------------------------------------------------

test("the lesson editor exposes a checkpoint enable toggle bound to l.checkpoint.enabled", () => {
  expect(programStudioSrc).toMatch(/checked=\{!!l\.checkpoint\?\.enabled\}/);
  expect(programStudioSrc).toMatch(/data-testid="checkpoint-enabled-toggle"/);
});

test("checkpoint config fields (title, submission instructions, requirements, trainer-only guidance) are all editable", () => {
  expect(programStudioSrc).toMatch(/data-testid="checkpoint-title"/);
  expect(programStudioSrc).toMatch(/data-testid="checkpoint-submission-instructions"/);
  expect(programStudioSrc).toMatch(/data-testid="checkpoint-submission-requirements"/);
  expect(programStudioSrc).toMatch(/data-testid="checkpoint-pass-readiness-guidance"/);
});

test("handler and dog criteria each get their own add/remove list editor, not a shared one", () => {
  expect(programStudioSrc).toMatch(/testid="checkpoint-handler-criteria"/);
  expect(programStudioSrc).toMatch(/testid="checkpoint-dog-criteria"/);
  expect(programStudioSrc).toMatch(/function CriteriaListEditor/);
});

test("criteria are author-defined — no default/hardcoded criterion data anywhere in ProgramStudio's checkpoint UI", () => {
  // A placeholder HINT showing the expected format is fine (purely
  // illustrative UI copy); what must never exist is an actual default
  // criterion object/value baked into the editor's own logic.
  expect(programStudioSrc).not.toMatch(/name:\s*["']Cue clarity["']/);
  expect(programStudioSrc).not.toMatch(/name:\s*["']Name Response["']/);
  expect(programStudioSrc).not.toMatch(/name:\s*["']Loose Leash["']/);
});

// ---------------------------------------------------------------------------
// OnlineSchoolDashboard — checkpoint-gated advancement, submit, states
// ---------------------------------------------------------------------------

test("the ordinary self-advance Continue button is suppressed for a checkpoint-required lesson", () => {
  expect(dashboardSrc).toMatch(/detailLesson\.is_current && detailLesson\.practiced && !roadmap\?\.requires_checkpoint/);
});

test("a checkpoint-required current lesson renders CheckpointPanel instead", () => {
  expect(dashboardSrc).toMatch(/detailLesson\.is_current && roadmap\?\.requires_checkpoint/);
  expect(dashboardSrc).toMatch(/<CheckpointPanel/);
});

test("checkpoint submission posts to the dedicated checkpoint endpoint, not the generic advance endpoint", () => {
  expect(dashboardSrc).toMatch(/\/portal\/school\/\$\{activeId\}\/lessons\/\$\{lessonId\}\/checkpoint/);
});

test("CheckpointPanel covers not-practiced, awaiting-review, prescribed-practice, and trainer-assist-hold states", () => {
  expect(checkpointPanelSrc).toMatch(/testid="school-checkpoint-needs-practice"/);
  expect(checkpointPanelSrc).toMatch(/data-testid="school-checkpoint-awaiting-review"/);
  expect(checkpointPanelSrc).toMatch(/data-testid="school-checkpoint-prescribed"/);
  expect(checkpointPanelSrc).toMatch(/data-testid="school-checkpoint-hold"/);
});

test("the prescribed-practice state shows the live remaining-practice count, not a static message", () => {
  // Phase 3 renamed the local alias (const p = status.prescription || {})
  // but reads the exact same live field — not a static message.
  expect(checkpointPanelSrc).toMatch(/const p = status\??\.prescription \|\| \{\}/);
  expect(checkpointPanelSrc).toMatch(/p\.practice_sessions_remaining/);
  expect(checkpointPanelSrc).toMatch(/data-testid="school-checkpoint-remaining"/);
});

test("the trainer-assist hold state never renders a submit control", () => {
  const holdBlock = dashboardSrc.slice(dashboardSrc.indexOf('status?.on_hold'), dashboardSrc.indexOf('status?.on_hold') + 600);
  expect(holdBlock).not.toMatch(/CheckpointSubmitForm/);
});

test("the checkpoint video picker reuses PracticeMediaUploader with a 10 MB ceiling and no photo picker", () => {
  expect(checkpointPanelSrc).toMatch(/import PracticeMediaUploader from "\.\.\/\.\.\/training\/PracticeMediaUploader"/);
  expect(checkpointPanelSrc).toMatch(/allowPhoto=\{false\} allowVideo videoMaxMb=\{10\}/);
});

test("PracticeMediaUploader's video size ceiling and photo picker are both configurable, not hardcoded", () => {
  expect(uploaderSrc).toMatch(/videoMaxMb = DEFAULT_VIDEO_MAX_MB/);
  expect(uploaderSrc).toMatch(/allowPhoto = true/);
  expect(uploaderSrc).not.toMatch(/const VIDEO_MAX_MB = 15;\s*\n\s*export default/); // no longer a fixed module constant driving the check
});

// ---------------------------------------------------------------------------
// CheckpointReviewQueue — trainer grading UI
// ---------------------------------------------------------------------------

test("the review queue fetches the pending endpoint and renders a badge per queue_state", () => {
  expect(reviewQueueSrc).toMatch(/api\.get\("\/admin\/school\/checkpoints\/pending"\)/);
  expect(reviewQueueSrc).toMatch(/QUEUE_BADGES\[it\.queue_state\]/);
  expect(reviewQueueSrc).toMatch(/state_conflict:/);
  expect(reviewQueueSrc).toMatch(/grading_resume_needed:/);
  expect(reviewQueueSrc).toMatch(/trainer_assist_hold:/);
});

test("the video plays back through the authenticated School media file/blob path, not base64 JSON", () => {
  expect(reviewQueueSrc).toMatch(/loadSchoolMediaUrl\(mediaId\)/);
  const schoolMediaSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "schoolMedia.js"), "utf8");
  expect(schoolMediaSrc).toMatch(/api\.get\(`\/portal\/school\/media\/\$\{mediaId\}\/file`, \{ responseType: "blob" \}\)/);
});

test("scoring renders one input per rubric criterion, not a single overall score", () => {
  expect(reviewQueueSrc).toMatch(/rubric_snapshot\?\.handler_criteria \|\| \[\]\)\.map\(c => \(/);
  expect(reviewQueueSrc).toMatch(/rubric_snapshot\?\.dog_criteria \|\| \[\]\)\.map\(c => \(/);
  expect(reviewQueueSrc).toMatch(/function ScoreRow/);
});

test("all three outcomes are real actions wired to the grade endpoint", () => {
  expect(reviewQueueSrc).toMatch(/data-testid="checkpoint-review-advance"/);
  expect(reviewQueueSrc).toMatch(/data-testid="checkpoint-review-prescribe-practice"/);
  expect(reviewQueueSrc).toMatch(/data-testid="checkpoint-review-trainer-assist"/);
  expect(reviewQueueSrc).toMatch(/grade\("advance"\)/);
  expect(reviewQueueSrc).toMatch(/grade\("prescribe_practice"\)/);
  expect(reviewQueueSrc).toMatch(/grade\("trainer_assist_recommended"\)/);
});

test("prescribe_practice offers all three structured remediation actions, not free text only", () => {
  expect(reviewQueueSrc).toMatch(/value="repeat_current_recipe"/);
  expect(reviewQueueSrc).toMatch(/value="assign_recipe"/);
  expect(reviewQueueSrc).toMatch(/value="assign_refresher_lesson"/);
});

test("the clear-hold action posts to the dedicated endpoint and only appears for a held submission", () => {
  expect(reviewQueueSrc).toMatch(/\/admin\/school\/checkpoints\/\$\{active\.id\}\/clear-trainer-assist-hold/);
  expect(reviewQueueSrc).toMatch(/active\.queue_state === "trainer_assist_hold"/);
  expect(reviewQueueSrc).toMatch(/data-testid="checkpoint-review-clear-hold"/);
});

test("a state_conflict row never silently re-grades — it shows an explicit reconciliation message", () => {
  expect(reviewQueueSrc).toMatch(/active\.queue_state === "state_conflict"/);
  expect(reviewQueueSrc).toMatch(/moved since submission/);
});

test("no exercise-specific string is hardcoded anywhere in the review queue", () => {
  expect(reviewQueueSrc).not.toMatch(/Cue clarity|Name Response|Loose Leash/);
});

// ---------------------------------------------------------------------------
// Entry points — Dashboard and Pipeline
// ---------------------------------------------------------------------------

test("Dashboard batches the pending-checkpoints fetch into the same loadAll Promise.all as every other widget", () => {
  expect(dashboardScreenSrc).toMatch(/api\.get\("\/admin\/school\/checkpoints\/pending"\)\.catch\(\(\)=>\(\{data:\[\]\}\)\)/);
  expect(dashboardScreenSrc).toMatch(/setPendingCheckpoints\(Array\.isArray\(cp\.data\) \? cp\.data : \[\]\)/);
});

test("Dashboard's checkpoint card is permission-gated the same way finance widgets are", () => {
  expect(dashboardScreenSrc).toMatch(/canRef\.current\("manage_training_sessions"\)/);
});

test("Dashboard opens CheckpointReviewQueue as a modal, not a screen navigation", () => {
  expect(dashboardScreenSrc).toMatch(/import CheckpointReviewQueue from "\.\.\/components\/CheckpointReviewQueue"/);
  expect(dashboardScreenSrc).toMatch(/checkpointQueueOpen && \(/);
  expect(dashboardScreenSrc).toMatch(/<CheckpointReviewQueue onClose=\{\(\) => setCheckpointQueueOpen\(false\)\} onGraded=\{load\}\/>/);
});

test("Pipeline surfaces the checkpoint queue next to Today's Training Dogs, not on a separate screen", () => {
  expect(pipelineScreenSrc).toMatch(/import CheckpointReviewQueue from "\.\.\/components\/CheckpointReviewQueue"/);
  expect(pipelineScreenSrc).toMatch(/data-testid="open-checkpoint-queue-pipeline"/);
  const todayHeaderIdx = pipelineScreenSrc.indexOf("Today&rsquo;s Training Dogs");
  const checkpointButtonIdx = pipelineScreenSrc.indexOf("open-checkpoint-queue-pipeline");
  expect(todayHeaderIdx).toBeGreaterThan(-1);
  expect(checkpointButtonIdx).toBeGreaterThan(-1);
  expect(checkpointButtonIdx - todayHeaderIdx).toBeLessThan(600); // physically adjacent, not elsewhere on the screen
});

// ---------------------------------------------------------------------------
// B6 — in-person students are never asked for a checkpoint video
// ---------------------------------------------------------------------------

test("CheckpointPanel replaces BOTH submission-soliciting states for in-person students", () => {
  // Visual QA regression: the B6 server guard 409s a video checkpoint from an
  // in-person School student, but the client still told them to "submit a
  // checkpoint video" and rendered the uploader — instructing the client to do
  // something the server refuses. Only the two soliciting states are swapped.
  // Phase 4 replaced the inline guards with a derived state, so this is now
  // asserted BEHAVIOURALLY — a stronger check than matching the old source
  // shape: neither submission-soliciting state can be reached at all.
  expect(cardsSrc).toMatch(/const trainerAssessed = deliveryMode === "in_person" \|\| deliveryMode === "trainer_led"/);
  expect(checkpointPanelSrc).toMatch(/data-testid="school-checkpoint-in-person"/);
  for (const mode of ["in_person", "trainer_led"]) {
    expect(checkpointState({ deliveryMode: mode, practiced: false })).toBe("in_person");
    expect(checkpointState({ deliveryMode: mode, practiced: true })).toBe("in_person");
  }
  expect(checkpointState({ deliveryMode: "online", practiced: false })).toBe("not_ready");
  expect(checkpointState({ deliveryMode: "online", practiced: true })).toBe("ready");
});

test("awaiting-review / prescribed-practice / Trainer Assist stay reachable for in-person students", () => {
  // A live trainer checkpoint can still return prescribe_practice or raise a
  // Trainer Assist hold, so those states must NOT be short-circuited — the
  // in-person guards sit after them, never at the top of the component.
  // Asserted behaviourally in phase 4: an in-person student whose live
  // trainer checkpoint produced one of these outcomes still lands in that
  // state, never short-circuited to the in-person placeholder.
  const inPerson = (status) => checkpointState({ deliveryMode: "in_person", practiced: true, status });
  expect(inPerson({ status: "awaiting_review" })).toBe("awaiting_review");
  expect(inPerson({ status: "graded", outcome: "prescribe_practice" })).toBe("more_practice");
  expect(inPerson({ status: "graded", outcome: "trainer_assist_recommended" })).toBe("trainer_assist");
  expect(inPerson({ status: "graded", outcome: "advance" })).toBe("passed");
  expect(inPerson({ on_hold: true, trainer_assist: { status: "scheduled" } })).toBe("trainer_assist");
});

test("delivery mode is threaded from SchoolApp through LessonScreen into CheckpointPanel", () => {
  const schoolApp = read("..", "screens", "SchoolApp.jsx");
  const lessonScreen = read("school", "student", "LessonScreen.jsx");
  expect(schoolApp).toMatch(/deliveryMode=\{selectedEntry\?\.delivery_mode\}/);
  expect(lessonScreen).toMatch(/dogName, dogPhoto, deliveryMode,/);
  expect(lessonScreen).toMatch(/deliveryMode=\{deliveryMode\}/);
});
