// Final Online School build — source-level architecture guards.
// Behavioral/end-to-end coverage is intentionally delegated to the full
// backend/Jest/browser QA pass; these checks prevent the major product
// boundaries from silently regressing in ordinary frontend edits.
import fs from "fs";
import path from "path";

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), "utf8");
const schoolApp = read("..", "screens", "SchoolApp.jsx");
const schoolHq = read("..", "screens", "SchoolHQ.jsx");
const students = read("school", "SchoolStudentsPanel.jsx");
const blocks = read("school", "student", "LessonContentBlocks.jsx");
const studio = read("ProgramStudio.jsx");
const settings = read("..", "screens", "Settings.jsx");
const shop = read("ShopItemDetail.jsx");
const search = read("school", "student", "SearchScreen.jsx");
const schoolMedia = read("..", "lib", "schoolMedia.js");


test("Student School is fully native and does not mount the legacy dashboard", () => {
  expect(schoolApp).not.toMatch(/OnlineSchoolDashboard/);
  ["StudentHome", "CourseRoadmap", "LessonScreen", "TodayScreen", "FeedbackScreen", "ProgressScreen", "ResourcesScreen"].forEach((name) => {
    expect(schoolApp).toMatch(new RegExp(`<${name}`));
  });
});


test("School HQ exposes the full operational suite", () => {
  ["SchoolStudentsPanel", "SchoolInterventionsPanel", "SchoolAnalyticsPanel", "SchoolResourcesPanel", "SchoolSettingsPanel"].forEach((name) => {
    expect(schoolHq).toMatch(new RegExp(name));
  });
  expect(schoolHq).toMatch(/setCheckpointTargetId/);
  expect(schoolHq).toMatch(/setTrainerAssistTargetId/);
});


test("Student Workspace supports ownership, plan editing, trainer requests, history, and safe impersonation", () => {
  expect(students).toMatch(/assigned_trainer_id/);
  expect(students).toMatch(/api\.patch\(`\/admin\/school\/students\/\$\{studentId\}\/plans\/\$\{id\}`/);
  expect(students).toMatch(/Completed tasks stay completed/);
  expect(students).toMatch(/requests\/\$\{requestId\}\/resolve/);
  expect(students).toMatch(/dog_school_history/);
  expect(students).toMatch(/owner\/admin accounts only/);
});


test("Course Builder 2.0 has interactive and media/resource blocks with real knowledge-check feedback", () => {
  ["video", "image", "steps", "trainer_tip", "warning", "checklist", "quiz", "timer", "rep_counter", "download", "practice", "checkpoint"].forEach((type) => {
    expect(studio).toContain(`\"${type}\"`);
  });
  expect(studio).toMatch(/correct_answer/);
  expect(blocks).toMatch(/Check answer/);
  expect(blocks).toMatch(/That’s it\./);
  expect(blocks).toMatch(/do not unlock or block course progression/);
});


test("Course authoring exposes School support, onboarding, prerequisites, and pathways", () => {
  expect(studio).toMatch(/school_support/);
  expect(studio).toMatch(/school_onboarding/);
  expect(studio).toMatch(/Required prerequisites \(complete all selected\)/);
  expect(studio).toMatch(/recommended_next_program_slugs/);
});


test("School commerce explains trainer support and prerequisite eligibility before purchase", () => {
  expect(shop).toMatch(/Real trainer oversight/);
  expect(shop).toMatch(/Trainer Assist support/);
  expect(shop).toMatch(/school_prerequisite_eligibility/);
  expect(shop).toMatch(/Complete Prerequisites First/);
});


test("Settings exposes School-media recovery rather than pretending JSON alone backs up videos", () => {
  expect(settings).toMatch(/SchoolMediaRecoveryPanel/);
  expect(settings).toMatch(/restore-school-media/);
  expect(settings).toMatch(/uploaded School resources live on persistent disk/);
});


test("School search covers reached lessons, resources, and trainer feedback without crowding the mobile nav", () => {
  expect(schoolApp).toMatch(/<SearchScreen/);
  // Consolidation rebrand: one "School", not "Online School".
  expect(schoolApp).toMatch(/aria-label="Search School"/);
  expect(search).toMatch(/lessons/);
  expect(search).toMatch(/resources/);
  expect(search).toMatch(/Trainer Feedback/);
});


test("School media uses authenticated file blobs and lesson-linked video/image resources render inline", () => {
  expect(schoolMedia).toMatch(/\/portal\/school\/media\/\$\{mediaId\}\/file/);
  expect(schoolMedia).toMatch(/responseType: "blob"/);
  expect(blocks).toMatch(/LinkedResourceMedia/);
  expect(blocks).toMatch(/Loading School media/);
});
