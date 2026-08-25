import fs from "fs";
import path from "path";

const workspace = fs.readFileSync(path.join(__dirname, "..", "TrainingSessionWorkspace.jsx"), "utf8");
const activity = fs.readFileSync(path.join(__dirname, "ActivityCard.jsx"), "utf8");
const api = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "api.js"), "utf8");

test("training workspace shows the required trainer record instead of hiding server rules", () => {
  expect(workspace).toContain("Trainer Record Checklist");
  expect(workspace).toContain('testid="trainer-record-checklist"');
  expect(workspace).toContain("trainer_delivery_incomplete");
  expect(workspace).toContain("detail_object");
  expect(workspace).toContain('data-testid="workspace-completion-blocked"');
});

test("recovery is a first-class no-fake-score workflow", () => {
  expect(workspace).toContain("Recovery / Unable to Train");
  expect(workspace).toContain('data-testid="recovery-session-modal"');
  expect(workspace).toContain("actuals: {}");
  expect(workspace).toContain("No training progress will be invented");
  expect(workspace).toContain('advancement_action: recovery ? "remain" : action');
  expect(workspace).toContain("clientUpdate");
});

test("individual skipped work visibly requires a reason", () => {
  expect(activity).toContain("Skip reason · required");
  expect(activity).toContain("Why wasn't this worked today?");
});

test("legacy direct-progress attempts surface the session-only rule", () => {
  expect(api).toContain("trainer_delivery_session_required");
  expect(api).toContain("Open the Training Session Workspace to record progress");
});
