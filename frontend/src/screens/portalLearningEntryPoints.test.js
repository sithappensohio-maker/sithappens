// Training UI Phase 4 — source-level regression guards for the Learn/
// Progress/Report-Card redesign, matching this repo's established
// no-RTL convention (see trainingEntryPoints.test.js / portalPracticeEntryPoints.test.js).
import fs from "fs";
import path from "path";

const portalSrc = fs.readFileSync(path.join(__dirname, "Portal.jsx"), "utf8");
const portalLearnSrc = fs.readFileSync(path.join(__dirname, "..", "components", "PortalLearn.jsx"), "utf8");
const portalProgressSrc = fs.readFileSync(path.join(__dirname, "..", "components", "PortalProgress.jsx"), "utf8");
const portalTrainingCardSrc = fs.readFileSync(path.join(__dirname, "..", "components", "PortalTrainingCard.jsx"), "utf8");
const lessonDetailSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "LessonDetailPanel.jsx"), "utf8");
const sessionRecapSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "SessionRecapCard.jsx"), "utf8");
const reportCardSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "TrainingReportCard.jsx"), "utf8");
const trainerFeedbackSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "TrainerFeedbackNotice.jsx"), "utf8");

// Matches actual property-access usage (e.g. `log.session_note`), not
// explanatory comments that merely mention the field name as a contrast.
const INTERNAL_FIELD_PATTERN = /\.(trainer_instructions|trainer_prep_notes|advancement_criteria|trainer_only_guidance|session_note|internal_trainer_notes|trainer_purpose)\b/;

// 5. Client-safe lesson fields render.
test("LessonDetailPanel reads only client-safe Lesson fields", () => {
  for (const field of ["client_overview", "why_it_matters", "equipment_needed", "success_criteria", "safety_notes", "client_instructions", "common_mistakes", "troubleshooting", "demo_video_url"]) {
    expect(lessonDetailSrc).toMatch(new RegExp(`lesson\\.${field}`));
  }
});

// 6. Trainer-only lesson fields never render.
test("LessonDetailPanel never references trainer-only Lesson fields", () => {
  expect(lessonDetailSrc).not.toMatch(INTERNAL_FIELD_PATTERN);
});

test("PortalLearn and PortalProgress never reference trainer-only/internal fields", () => {
  expect(portalLearnSrc).not.toMatch(INTERNAL_FIELD_PATTERN);
  expect(portalProgressSrc).not.toMatch(INTERNAL_FIELD_PATTERN);
});

// 11 / 12. Session history uses client-safe recap text; internal trainer
// notes never render anywhere in the new client-facing components.
test("SessionRecapCard only reads recap_note (client-safe), never session_note (internal)", () => {
  expect(sessionRecapSrc).toMatch(/recap\.recap_note/);
  expect(sessionRecapSrc).not.toMatch(INTERNAL_FIELD_PATTERN);
});

test("TrainerFeedbackNotice has no fetch of its own — it only ever renders text explicitly passed to it", () => {
  expect(trainerFeedbackSrc).not.toMatch(/api\.get|fetch\(/);
});

// 9 / 10. Multi-dog and multi-program progress remain separated — the
// active dog/program is always resolved by matching dog_id, never blended
// across the full response array.
test("PortalProgress resolves the active dog by dog_id match, and filters recaps/trophies by the same id", () => {
  expect(portalProgressSrc).toMatch(/data\.find\(d => d\.dog_id === activeDogId\)/);
  expect(portalProgressSrc).toMatch(/recaps\.filter\(r => r\.dog_id === entry\.dog_id\)/);
  expect(portalProgressSrc).toMatch(/trophies\.dog_trophies\.filter\(t => t\.recipient_id === entry\.dog_id\)/);
});

test("PortalLearn resolves the active dog by dog_id match, never blending two dogs' curricula", () => {
  expect(portalLearnSrc).toMatch(/data\.find\(d => d\.dog_id === activeDogId\)/);
});

// 13. Report-card values come from existing progress data — no fetch of
// its own inside the component; every value is a prop.
test("TrainingReportCard makes no network calls of its own — every value comes from props", () => {
  expect(reportCardSrc).not.toMatch(/api\.get|api\.post|fetch\(/);
});

// 14. Certificate eligibility remains unchanged — printCertificate is
// exported (reused, not duplicated) with its logic untouched; Progress
// only adds an entry point, never a second copy of the completion check.
test("printCertificate is exported and reused, not duplicated, and Progress never re-implements completion eligibility", () => {
  expect(portalTrainingCardSrc).toMatch(/export function printCertificate/);
  expect(portalProgressSrc).not.toMatch(/function printCertificate/);
  expect(portalProgressSrc).not.toMatch(/completed_at/); // eligibility stays PortalTrainingCard's concern
});

// 15. Empty states render without undefined fields — every list in
// PortalLearn/PortalProgress has an EmptyState fallback branch.
test("PortalLearn and PortalProgress render EmptyState for no-lessons/no-skills/no-sessions cases", () => {
  expect(portalLearnSrc).toMatch(/EmptyState/);
  expect(portalProgressSrc).toMatch(/progress-skills-empty/);
  expect(portalProgressSrc).toMatch(/progress-history-empty/);
});

// 16. Existing Learn/Progress deep links remain valid — same anchor ids.
test("portal-learn-anchor and portal-progress-anchor ids are preserved", () => {
  expect(portalLearnSrc).toMatch(/id="portal-learn-anchor"/);
  expect(portalProgressSrc).toMatch(/id="portal-progress-anchor"/);
});

// 18. No duplicate progress calculation — Learn/Progress never call a
// second/parallel progress endpoint, and Progress passes the backend's
// own mastered_pct straight through rather than recomputing a percentage.
test("PortalProgress passes the backend's own mastered_pct through without recomputing a percentage", () => {
  expect(portalProgressSrc).toMatch(/completionPct=\{entry\.mastered_pct\}/);
  expect(portalProgressSrc).not.toMatch(/mastered_pct\s*=\s*\(|Math\.round\([^)]*mastered/);
});

test("Portal.jsx passes the already-loaded homework state into Learn/Progress instead of a second fetch", () => {
  expect(portalSrc).toMatch(/<PortalLearn homework=\{homework\}\/>/);
  expect(portalSrc).toMatch(/<PortalProgress homework=\{homework\}\/>/);
});
