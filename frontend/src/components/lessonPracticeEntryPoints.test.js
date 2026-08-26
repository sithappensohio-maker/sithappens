// Unified School trainer-flow guards: in-person/hybrid client Practice must
// come from the exact current School lesson, never from an arbitrary session
// skill checkbox or a free-form staff template picker.
import fs from "fs";
import path from "path";

const workspaceSrc = fs.readFileSync(path.join(__dirname, "TrainingSessionWorkspace.jsx"), "utf8");
const studentsSrc = fs.readFileSync(path.join(__dirname, "school", "SchoolStudentsPanel.jsx"), "utf8");

test("guided trainer completion is wired to current lesson Practice", () => {
  expect(workspaceSrc).toMatch(/current_lesson_practice/);
  expect(workspaceSrc).toMatch(/assign_lesson_practice/);
  expect(workspaceSrc).toMatch(/Send this lesson.?s Practice/);
  expect(workspaceSrc).not.toMatch(/Assign as homework/);
  expect(workspaceSrc).not.toMatch(/homework_activity_ids\s*:/);
});

test("staff School workspace only assigns the current lesson recipe", () => {
  expect(studentsSrc).toMatch(/currentLessonPracticeTemplateId/);
  expect(studentsSrc).toMatch(/Assign Current Lesson Practice/);
  expect(studentsSrc).toMatch(/Change the recipe in Program Studio/);
  expect(studentsSrc).toMatch(/currentDelivery\s*!==\s*["']online["']/);
});
