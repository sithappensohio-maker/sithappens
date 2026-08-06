// Gap-closing pass — regression guard for the release blocker: Pipeline's
// per-row button and DogTrainingTab's "Log Session" button used to open
// TrainingTrackerModal, a second, lighter path that wrote goal_progress
// directly and bypassed the training_session_drafts draft/completion
// pipeline (session log shape, advancement, homework). Both now open
// TrainingSessionWorkspace instead — the same component the booking-based
// check-in flow uses — so there is exactly one session-writing surface.
//
// This repo has no React Testing Library / component-render test
// convention (see the other *.test.js files here — all pure-function
// tests), so this deliberately stays a lightweight source-level guard
// rather than introducing a new test-tooling dependency for one check.
// The actual click-through behavior (button click -> TrainingSessionWorkspace
// renders, not the old modal) is verified live in the browser as part of
// the UI verification pass — see the release report for that evidence.
import fs from "fs";
import path from "path";

const pipelineSrc = fs.readFileSync(path.join(__dirname, "Pipeline.jsx"), "utf8");
const dogTrainingTabSrc = fs.readFileSync(
  path.join(__dirname, "..", "components", "DogTrainingTab.jsx"), "utf8"
);
const trackerModalPath = path.join(__dirname, "..", "components", "TrainingTrackerModal.jsx");

test("TrainingTrackerModal no longer exists anywhere in the app", () => {
  expect(fs.existsSync(trackerModalPath)).toBe(false);
});

test("Pipeline.jsx does not import or render TrainingTrackerModal", () => {
  expect(pipelineSrc).not.toMatch(/TrainingTrackerModal/);
});

test("Pipeline.jsx imports TrainingSessionWorkspace and the per-row button opens it with dogId/enrollmentId", () => {
  expect(pipelineSrc).toMatch(/import TrainingSessionWorkspace from ["']\.\.\/components\/TrainingSessionWorkspace["']/);
  // The per-row "Log Session" button sets workspaceFor to a dog/enrollment
  // pair (not a bookingId) — this is the direct, no-booking entry point
  // backed by POST /dogs/{id}/programs/{eid}/training-session/draft.
  expect(pipelineSrc).toMatch(/onOpenWorkspace=\{\(\) => setWorkspaceFor\(\{ dogId: r\.dog_id, enrollmentId: r\.id \}\)\}/);
  expect(pipelineSrc).toMatch(/<TrainingSessionWorkspace[\s\S]*?dogId=\{workspaceFor\.dogId\}[\s\S]*?enrollmentId=\{workspaceFor\.enrollmentId\}/);
});

test("Pipeline.jsx's booking-based Open Plan button still opens the same TrainingSessionWorkspace, not a second component", () => {
  expect(pipelineSrc).toMatch(/setWorkspaceFor\(\{ bookingId: r\.booking_id \}\)/);
  expect(pipelineSrc).toMatch(/<TrainingSessionWorkspace[\s\S]*?bookingId=\{workspaceFor\.bookingId\}/);
});

test("DogTrainingTab.jsx does not import or render TrainingTrackerModal", () => {
  expect(dogTrainingTabSrc).not.toMatch(/TrainingTrackerModal/);
});

test("DogTrainingTab.jsx imports TrainingSessionWorkspace and Log Session opens it with dogId/enrollmentId", () => {
  expect(dogTrainingTabSrc).toMatch(/import TrainingSessionWorkspace from ["']\.\/TrainingSessionWorkspace["']/);
  expect(dogTrainingTabSrc).toMatch(/onOpenWorkspace=\{\(\)=>setWorkspaceFor\(\{ dog_id: dogId, enrollment_id: e\.id \}\)\}/);
  expect(dogTrainingTabSrc).toMatch(/<TrainingSessionWorkspace[\s\S]*?dogId=\{workspaceFor\.dog_id\}[\s\S]*?enrollmentId=\{workspaceFor\.enrollment_id\}/);
});
