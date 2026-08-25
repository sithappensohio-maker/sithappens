import fs from "fs";
import path from "path";

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), "utf8");

const form = read("student", "SchoolExperienceFeedbackCard.jsx");
const feedbackScreen = read("student", "FeedbackScreen.jsx");
const completion = read("student", "CourseCompletionCard.jsx");
const schoolHq = read("..", "..", "screens", "SchoolHQ.jsx");
const adminFeedback = read("SchoolExperienceFeedbackAdmin.jsx");

test("School Feedback screen keeps trainer feedback and adds a separate School experience survey", () => {
  expect(feedbackScreen).toContain("Trainer Feedback");
  expect(feedbackScreen).toMatch(/<SchoolExperienceFeedbackCard enrollmentId=\{enrollmentId\} source="feedback_screen"/);
  expect(feedbackScreen).toContain('data-testid="school-experience-feedback-section"');
});

test("completed courses show the stronger rate-this-course prompt", () => {
  expect(completion).toMatch(/<SchoolExperienceFeedbackCard enrollmentId=\{home\?\.school_enrollment_id\} source="course_completion" completionPrompt/);
  expect(form).toContain("You did it — one last thing");
  expect(form).toContain("How was your experience with this course?");
  expect(form).toContain("Rate this course");
});

test("survey includes the agreed rating, clarity, progress, comments, recommendation, and testimonial permission", () => {
  expect(form).toContain("Overall experience");
  expect(form).toContain("How easy are the lessons to follow?");
  expect(form).toContain("Do you feel like you and your dog are making progress?");
  expect(form).toContain("What are you liking most?");
  expect(form).toContain("What could we make better?");
  expect(form).toContain("Would you recommend Sit Happens Online School?");
  expect(form).toContain("Sit Happens may use my comments as a testimonial.");
  expect(form).toContain("Leave this unchecked if you want your comments used only as private School feedback.");
});

test("survey reads and updates one server-owned experience review", () => {
  expect(form).toMatch(/api\.get\(`\/portal\/school\/\$\{enrollmentId\}\/experience-feedback`\)/);
  expect(form).toMatch(/api\.put\(`\/portal\/school\/\$\{enrollmentId\}\/experience-feedback`/);
  expect(form).toContain("Update feedback");
});

test("School HQ has a dedicated Client Feedback destination", () => {
  expect(schoolHq).toContain('key: "client_feedback", label: "Client Feedback"');
  expect(schoolHq).toContain('{tab === "client_feedback" && <SchoolExperienceFeedbackAdmin />}');
  expect(adminFeedback).toContain("Overall rating");
  expect(adminFeedback).toContain("Would recommend");
  expect(adminFeedback).toContain("Easy to follow");
  expect(adminFeedback).toContain("Making progress");
  expect(adminFeedback).toContain("Testimonial OK");
});

test("School HQ feedback dashboard is read-only with search and filters", () => {
  expect(adminFeedback).toMatch(/api\.get\("\/admin\/school\/experience-feedback"/);
  expect(adminFeedback).toContain('data-testid="school-client-feedback-search"');
  expect(adminFeedback).toContain('data-testid="school-client-feedback-recommend-filter"');
  expect(adminFeedback).toContain('data-testid="school-client-feedback-rating-filter"');
  expect(adminFeedback).not.toMatch(/api\.(post|put|patch|delete)\("\/admin\/school\/experience-feedback/);
});
