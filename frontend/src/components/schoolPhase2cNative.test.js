// Online School Phase 2C — source-level wiring guards. This repo already uses
// this style heavily for integration wiring that does not need RTL rendering.
import fs from "fs";
import path from "path";

const readSrc = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), "utf8");

const schoolApp = readSrc("..", "screens", "SchoolApp.jsx");
const portal = readSrc("..", "screens", "Portal.jsx");
const feedback = readSrc("school", "student", "FeedbackScreen.jsx");
const progress = readSrc("school", "student", "ProgressScreen.jsx");
const ask = readSrc("school", "student", "AskTrainerPanel.jsx");
const current = readSrc("school", "student", "CurrentTrainingCard.jsx");
const lesson = readSrc("school", "student", "LessonScreen.jsx");
const hq = readSrc("..", "screens", "SchoolHQ.jsx");


test("normal Student School runtime no longer mounts the legacy OnlineSchoolDashboard", () => {
  expect(schoolApp).not.toMatch(/OnlineSchoolDashboard/);
  expect(portal).not.toMatch(/import OnlineSchoolDashboard/);
  expect(portal).not.toMatch(/<OnlineSchoolDashboard/);
  expect(schoolApp).toMatch(/<FeedbackScreen/);
  expect(schoolApp).toMatch(/<ProgressScreen/);
});


test("Practice Coach question refresh cannot masquerade as Practice completion", () => {
  expect(schoolApp).toMatch(/onChanged=\{refreshAll\}/);
  expect(schoolApp).toMatch(/onPracticeLogged=\{practiceLogged\}/);
  expect(schoolApp).not.toMatch(/onChanged=\{closePractice\}/);
  expect(schoolApp).toMatch(/setPracticeDone\(true\)/);
});


test("Student Home uses the backend lesson equipment field", () => {
  expect(current).toMatch(/lesson\?\.equipment_needed/);
  expect(current).not.toMatch(/lesson\?\.equipment\)/);
});


test("native Progress consumes the real portal trophies response shape", () => {
  expect(progress).toMatch(/t\.data\?\.dog_trophies \|\| \[\]/);
  expect(progress).toMatch(/t\.trophy_description/);
  expect(progress).toMatch(/p\.course_pct/);
  expect(progress).toMatch(/Skill mastery/);
});


test("contextual Ask Trainer reuses global Messages and sends School ids", () => {
  expect(ask).toMatch(/api\.post\("\/me\/messages"/);
  expect(ask).toMatch(/school_enrollment_id:/);
  expect(ask).toMatch(/school_lesson_id:/);
  expect(ask).toMatch(/school_checkpoint_id:/);
  expect(feedback).toMatch(/\/portal\/school\/\$\{enrollmentId\}\/support/);
});


test("School HQ actionable records carry exact target ids into the destination workflow", () => {
  expect(hq).toMatch(/setCheckpointTargetId/);
  expect(hq).toMatch(/setTrainerAssistTargetId/);
  expect(hq).toMatch(/thread_id:/);
  expect(hq).toMatch(/video_media_id:/);
  expect(hq).toMatch(/question_id:/);
  expect(hq).toMatch(/section_log_id:/);
});


test("remediation launches the backend-prescribed homework instead of generic lesson practice", () => {
  expect(schoolApp).toMatch(/\/remediation\/start/);
  expect(schoolApp).toMatch(/if \(t === "remediation"\) \{ openPrescribedPractice\(\)/);
  expect(schoolApp).toMatch(/onStartPrescribedPractice=\{openPrescribedPractice\}/);
});


test("a trainer-prescribed recipe suppresses the lesson's generic Practice Again path", () => {
  expect(lesson).toMatch(/prescribedRemediation/);
  expect(lesson).toMatch(/hasPractice && !prescribedRemediation/);
});
