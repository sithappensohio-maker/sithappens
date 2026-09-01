// Open lesson access — source-level regression guards (repo convention).
//
// The feature: staff can grant a chosen student "take any lesson, in any
// order" on one enrollment. It relaxes ONLY the roadmap's lock statuses —
// pointer, Today's recommendation, quizzes, checkpoints, and sequential
// completion are untouched. Completed courses already open everything, so
// the automatic case needs no flag.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const serverSrc = read("..", "..", "..", "backend", "server.py");
const suiteSrc = read("..", "..", "..", "backend", "school_suite_base.py");
const panelSrc = read("school", "SchoolStudentsPanel.jsx");
const roadmapSrc = read("school", "student", "CourseRoadmap.jsx");
const cardsSrc = read("school", "student", "course", "CourseCards.jsx");

test("the flag relaxes lock statuses inside _school_roadmap itself, so every lock consumer opens at once", () => {
  expect(serverSrc).toMatch(/def _school_open_lesson_access/);
  expect(serverSrc).toMatch(/open_access = _school_open_lesson_access\(enrollment\) and not is_completed_enrollment/);
  // Would-be-locked modules become browsable "upcoming" with full lessons…
  expect(serverSrc).toMatch(/m_status = "upcoming"/);
  // …and would-be-locked lessons become full "available" entries.
  expect(serverSrc).toMatch(/if l_status == "locked" and open_access:/);
});

test("the upcoming-module sentinel is -1, never len(lessons) — len would mark every lesson completed", () => {
  expect(serverSrc).toMatch(/else -1 if m_status == "upcoming" else len\(lessons\)/);
});

test("the detail payload says the flag is on so the course screen can explain why nothing is locked", () => {
  expect(serverSrc).toMatch(/"open_lesson_access": _school_open_lesson_access\(enrollment\)/);
  expect(roadmapSrc).toMatch(/data-testid="course-open-access-banner"/);
  expect(roadmapSrc).toMatch(/!isCompleted && detail\.open_lesson_access/);
});

test("the admin grant is an audited record written by the existing student PATCH, only on actual change", () => {
  expect(suiteSrc).toMatch(/open_lesson_access: Optional\[bool\] = None/);
  expect(suiteSrc).toMatch(/body\.open_lesson_access != bool\(\(dp\.get\("open_lesson_access"\) or \{\}\)\.get\("enabled"\)\)/);
  expect(suiteSrc).toMatch(/"updated_by_name": user\.get\("name"\)/);
  // Surfaced on the students list for at-a-glance visibility.
  expect(suiteSrc).toMatch(/"open_lesson_access": bool\(\(dp\.get\("open_lesson_access"\) or \{\}\)\.get\("enabled"\)\)/);
});

test("Student Workspace has the toggle, sends it on save, and shows the completed-course case as already open", () => {
  expect(panelSrc).toMatch(/data-testid="school-open-lesson-access-toggle"/);
  expect(panelSrc).toMatch(/open_lesson_access:!!settings\.open_lesson_access/);
  expect(panelSrc).toMatch(/All lessons are already open — course complete\./);
});

test("the client UI already speaks the 'upcoming' vocabulary, so unlocked modules read as Up next, not broken", () => {
  expect(cardsSrc).toMatch(/upcoming: \{ label: "Up next"/);
});
