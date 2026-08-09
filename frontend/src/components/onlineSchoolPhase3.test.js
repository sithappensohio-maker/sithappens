// Online School Phase 3 — Student Journey & Support — source-level
// regression guards, matching this repo's established convention (see
// checkpointEntryPoints.test.js / onlineSchoolEntryPoints.test.js): no React
// Testing Library rendering — behaviors that depend on component wiring are
// verified by asserting the source contains the exact pattern that
// implements them. Live interaction is verified in the browser as part of
// the release report.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const dashboardSrc = read("OnlineSchoolDashboard.jsx");
const polishSrc = read("..", "lib", "onlineSchoolPolish.js");
const certSrc = read("..", "lib", "schoolCertificate.js");
const programStudioSrc = read("ProgramStudio.jsx");
const portalSrc = read("..", "screens", "Portal.jsx");

// ---------------------------------------------------------------------------
// Internal navigation
// ---------------------------------------------------------------------------

test("the dashboard has an internal 5-tab nav (Home/My Journey/Trainer Feedback/Achievements/Help), not a Portal.jsx change", () => {
  expect(dashboardSrc).toMatch(/data-testid="school-nav-tabs"/);
  expect(dashboardSrc).toMatch(/data-testid=\{`school-nav-\$\{t\.key\}`\}/);
  ["home", "journey", "feedback", "achievements", "help"].forEach(key => {
    expect(dashboardSrc).toMatch(new RegExp(`key:\\s*"${key}"`));
  });
});

test("Portal.jsx enters the native routed School instead of mounting the legacy overlay", () => {
  expect(portalSrc).toMatch(/const openSchool = \(\) =>/);
  expect(portalSrc).toMatch(/<SchoolApp/);
  expect(portalSrc).not.toMatch(/<OnlineSchoolDashboard/);
});

// ---------------------------------------------------------------------------
// Student Home
// ---------------------------------------------------------------------------

test("Recent Trainer Feedback sources the newest checkpoint-history item, never the current lesson's checkpoint_status", () => {
  expect(polishSrc).toMatch(/export function recentFeedbackFromHistory/);
  expect(dashboardSrc).toMatch(/recentFeedback = recentFeedbackFromHistory\(history\)/);
  expect(dashboardSrc).not.toMatch(/recentFeedback[^=]*=\s*roadmap\??\.checkpoint_status/);
});

test("Trainer Status stays sourced from the current roadmap's live checkpoint_status", () => {
  expect(polishSrc).toMatch(/export function trainerStatusLabel\(roadmap\)/);
  expect(polishSrc).toMatch(/roadmap\?\.requires_checkpoint \? roadmap\.checkpoint_status/);
  expect(dashboardSrc).toMatch(/trainerStatusLabel\(roadmap\)/);
});

test("history is fetched from the dedicated checkpoint-history endpoint", () => {
  expect(dashboardSrc).toMatch(/api\.get\(`\/portal\/school\/\$\{id\}\/checkpoint-history`\)/);
});

test("a completed enrollment routes Home to the Graduation view, not the active roadmap hero", () => {
  expect(dashboardSrc).toMatch(/isCompleted \?[\s\S]{0,80}<GraduationView/);
});

// ---------------------------------------------------------------------------
// Checkpoint result presentation (Home preview + Trainer Feedback history)
// ---------------------------------------------------------------------------

test("Handler and Dog scores are never framed as a pass/fail of the client", () => {
  expect(dashboardSrc).toMatch(/reflects where your dog is in training, not a handling mistake/);
});

test("rubric score rows are keyed by real criterion id/name, no hardcoded exercise or criterion names anywhere", () => {
  expect(dashboardSrc).toMatch(/function RubricScoreGroup/);
  expect(dashboardSrc).not.toMatch(/Cue clarity|Name Response|Loose Leash/);
});

// ---------------------------------------------------------------------------
// Prescribed practice / Trainer Assist
// ---------------------------------------------------------------------------

test("prescribed practice never shows a fabricated focus criterion, only the real action + remaining count", () => {
  expect(dashboardSrc).toMatch(/data-testid="school-checkpoint-prescribed"/);
  expect(dashboardSrc).not.toMatch(/FOCUS:/i);
  expect(dashboardSrc).toMatch(/practice_sessions_remaining/);
});

test("a prescribed refresher lesson gets a real Go-to-Refresher affordance sourced from the resolved lesson id/name", () => {
  expect(polishSrc).not.toMatch(/refresher_lesson_id.*=.*["'][^"']+["']/); // never hardcoded
  expect(dashboardSrc).toMatch(/data-testid="school-checkpoint-go-to-refresher"/);
  expect(dashboardSrc).toMatch(/onGoToRefresher\(p\.refresher_lesson_id\)/);
});

test("the trainer-assist hold never renders a submit control and explains progress is preserved", () => {
  const holdBlock = dashboardSrc.slice(dashboardSrc.indexOf('status?.on_hold'), dashboardSrc.indexOf('status?.on_hold') + 2500);
  expect(holdBlock).not.toMatch(/CheckpointSubmitForm/);
  expect(holdBlock).toMatch(/course progress stays exactly where it is/);
});

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

test("Achievements renders only real, already-awarded trophies for the active dog, no fabricated milestones", () => {
  expect(dashboardSrc).toMatch(/api\.get\("\/portal\/trophies"\)/);
  expect(dashboardSrc).toMatch(/dog_trophies \|\| \[\]\)\.filter\(t => t\.recipient_id === entry\.dog_id\)/);
  expect(dashboardSrc).not.toMatch(/\bcoins\b|\bXP\b|\bloot box\b/i);
});

// ---------------------------------------------------------------------------
// Help / I'm Stuck
// ---------------------------------------------------------------------------

test("Help offers the full structured reason picker before contacting a trainer", () => {
  expect(dashboardSrc).toMatch(/data-testid=\{`school-stuck-\$\{r\.key\}`\}/);
  ["wont_do", "stopped", "distracted", "confused", "worried", "need_trainer"].forEach(key => {
    expect(dashboardSrc).toMatch(new RegExp(`key:\\s*"${key}"`));
  });
  expect(dashboardSrc).toMatch(/data-testid="school-contact-trainer"/);
});

// ---------------------------------------------------------------------------
// Final Assessment (author-defined, not inferred) + Graduation
// ---------------------------------------------------------------------------

test("Program Studio lets an author explicitly mark a checkpoint as the Final Assessment, defaulting off", () => {
  expect(programStudioSrc).toMatch(/data-testid="checkpoint-final-assessment-toggle"/);
  expect(programStudioSrc).toMatch(/checked=\{l\.checkpoint\?\.assessment_type === "final_assessment"\}/);
});

test("checkpoint screen copy keys off assessment_type, never off is_final_lesson", () => {
  expect(dashboardSrc).toMatch(/assessment_type === "final_assessment"/);
  expect(dashboardSrc).not.toMatch(/is_final_lesson[\s\S]{0,40}Final Assessment/);
});

test("Graduation shows only real completion_summary fields, no invented Stage number or What's Next", () => {
  expect(dashboardSrc).toMatch(/function GraduationView/);
  expect(dashboardSrc).toMatch(/completionSummary\.total_modules/);
  expect(dashboardSrc).toMatch(/completionSummary\.total_lessons/);
  expect(dashboardSrc).toMatch(/completionSummary\.checkpoints_passed/);
  expect(dashboardSrc).toMatch(/completionSummary\.practice_sessions_logged/);
  expect(dashboardSrc).not.toMatch(/Stage \d/);
  expect(dashboardSrc).not.toMatch(/What'?s Next/i);
});

test("the final_assessment Handler/Dog summary only renders when completionSummary.final_assessment is present", () => {
  expect(dashboardSrc).toMatch(/completionSummary\?\.final_assessment && \(/);
});

test("the certificate reuses the existing client-side print pattern, no new backend certificate call", () => {
  expect(dashboardSrc).toMatch(/import \{ printSchoolCertificate \} from "\.\.\/lib\/schoolCertificate"/);
  expect(certSrc).toMatch(/window\.open\(url, "_blank", "noopener"\)/);
  expect(certSrc).not.toMatch(/api\.(get|post)\(/);
});

// ---------------------------------------------------------------------------
// Practice Coach / checkpoint architecture untouched
// ---------------------------------------------------------------------------

test("PracticePanel is still the exact same, unforked Practice Coach engine", () => {
  expect(dashboardSrc).toMatch(/import PracticePanel from "\.\/training\/PracticePanel"/);
  expect(dashboardSrc).toMatch(/<PracticePanel homework=\{practiceHomework\}/);
});
