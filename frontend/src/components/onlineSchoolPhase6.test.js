// Online School Phase 6 — Enrollment Lifecycle & Launch Hardening —
// source-level regression guards, matching this repo's established
// convention (see onlineSchoolPhase3.test.js / onlineSchoolPhase4.test.js):
// no React Testing Library rendering — behaviors that depend on component
// wiring are verified by asserting the source contains the exact pattern
// that implements them. Live interaction is verified in the browser as
// part of the release report.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const dogTrainingTabSrc = read("DogTrainingTab.jsx");
const dashboardSrc = read("OnlineSchoolDashboard.jsx");
const shopManagerSrc = read("..", "screens", "ShopManager.jsx");
const shopItemDetailSrc = read("ShopItemDetail.jsx");
const dailyCheckInSrc = read("DailyCheckInCard.jsx");
const mediaUploaderSrc = read("training", "PracticeMediaUploader.jsx");

// ---------------------------------------------------------------------------
// Admin — Withdraw Student control/state
// ---------------------------------------------------------------------------

test("an active school enrollment gets a Withdraw Student action, not just Remove", () => {
  expect(dogTrainingTabSrc).toMatch(/onWithdraw && e\.status === "active"/);
  expect(dogTrainingTabSrc).toMatch(/Withdraw Student/);
  expect(dogTrainingTabSrc).toMatch(/api\.post\(`\/school\/enrollments\/\$\{se\.id\}\/withdraw`, \{ reason: reason\.trim\(\), revoke_access: revokeAccess \}\)/);
});

test("Withdraw Student requires a non-empty reason before calling the API", () => {
  expect(dogTrainingTabSrc).toMatch(/if \(!reason\.trim\(\)\)/);
});

// ---------------------------------------------------------------------------
// Admin — hard-remove vs Withdraw distinction
// ---------------------------------------------------------------------------

test("Remove is presented as the zero-history path, distinct from Withdraw Student", () => {
  expect(dogTrainingTabSrc).toMatch(/Only works for an enrollment with no checkpoint history yet — use Withdraw Student for one with real progress\./);
  expect(dogTrainingTabSrc).toMatch(/api\.delete\(`\/school\/enrollments\/\$\{se\.id\}`\)/);
});

test("Remove and Withdraw Student are two distinct buttons/actions on the same card, never merged into one", () => {
  expect(dogTrainingTabSrc).toMatch(/data-testid=\{`school-withdraw-\$\{e\.id\}`\}/);
  expect(dogTrainingTabSrc).toMatch(/data-testid=\{`school-unenroll-\$\{e\.id\}`\}/);
});

// ---------------------------------------------------------------------------
// Admin — access state control
// ---------------------------------------------------------------------------

test("access can be revoked and restored from the same card, calling the dedicated access endpoint", () => {
  expect(dogTrainingTabSrc).toMatch(/api\.post\(`\/school\/enrollments\/\$\{se\.id\}\/access`, \{ access_state: accessState, reason \}\)/);
  expect(dogTrainingTabSrc).toMatch(/Revoke Access/);
  expect(dogTrainingTabSrc).toMatch(/Restore Access/);
});

test("access state is visibly distinct from training status on the card (Access Active / Access Revoked)", () => {
  expect(dogTrainingTabSrc).toMatch(/\{accessRevoked \? "Access Revoked" : "Access Active"\}/);
});

// ---------------------------------------------------------------------------
// Admin — completed vs withdrawn vs active presentation
// ---------------------------------------------------------------------------

test("active/completed/withdrawn each get a distinct staff-facing label, no invented states", () => {
  expect(dogTrainingTabSrc).toMatch(/const SCHOOL_STATUS_LABEL = \{ active: "Active", completed: "Completed", withdrawn: "Withdrawn" \}/);
});

test("withdrawn history shows structured withdrawal metadata (who/when/why), not just a bare status word", () => {
  expect(dogTrainingTabSrc).toMatch(/e\.status === "withdrawn" && \(/);
  expect(dogTrainingTabSrc).toMatch(/e\.withdrawn_by_name/);
  expect(dogTrainingTabSrc).toMatch(/e\.withdrawal_reason/);
});

test("completed/withdrawn school enrollments get their own collapsed History section, separate from active", () => {
  expect(dogTrainingTabSrc).toMatch(/data-testid="school-history-section"/);
  expect(dogTrainingTabSrc).toMatch(/schoolHistory\.map/);
});

test("manual vs purchase provenance is shown on every school enrollment card", () => {
  expect(dogTrainingTabSrc).toMatch(/const provenance = e\.enrollment_source === "purchase" \? "Purchased" : "Manually enrolled"/);
});

// ---------------------------------------------------------------------------
// Admin — graded checkpoint history entry point
// ---------------------------------------------------------------------------

test("staff can open graded checkpoint history (Handler/Dog scores) from the school enrollment card", () => {
  expect(dogTrainingTabSrc).toMatch(/api\.get\(`\/admin\/school-enrollments\/\$\{schoolEnrollmentId\}\/checkpoint-history`\)/);
  expect(dogTrainingTabSrc).toMatch(/Handler avg/);
  expect(dogTrainingTabSrc).toMatch(/Dog avg/);
});

test("checkpoint history is keyed by the school_enrollments row's own id, not the dog_programs (enrollment) id — regression for a real 404 caught by live browser verification", () => {
  // The admin endpoint (server.py) is GET /admin/school-enrollments/{school_enrollment_id}/checkpoint-history —
  // e.id is dog_programs.id, a DIFFERENT id space. schoolEnrollmentId must be
  // threaded through as its own prop, resolved by the parent from
  // schoolEnrollmentsById, not read off the enrollment object itself.
  expect(dogTrainingTabSrc).toMatch(/function SchoolEnrollmentAdminCard\(\{ enrollment: e, dogName, schoolEnrollmentId, onWithdraw, onRemove, onSetAccess \}\)/);
  expect(dogTrainingTabSrc).toMatch(/schoolEnrollmentId=\{schoolEnrollmentsById\[e\.id\]\?\.id\}/);
  expect(dogTrainingTabSrc).not.toMatch(/api\.get\(`\/admin\/school-enrollments\/\$\{e\.id\}\/checkpoint-history`\)/);
});

// ---------------------------------------------------------------------------
// Shop Manager — dog name + fulfillment error + retry presentation
// ---------------------------------------------------------------------------

test("Online Orders shows which dog an online_school line is for, not just the program name", () => {
  expect(shopManagerSrc).toMatch(/\$\{l\.dog_name \? ` \(\$\{l\.dog_name\}\)` : ""\}/);
});

test("a failed fulfillment line shows the actual server error, not just a generic Needs Attention badge", () => {
  expect(shopManagerSrc).toMatch(/\(o\.lines \|\| \[\]\)\.filter\(\(l\) => l\.fulfillment_error\)/);
  expect(shopManagerSrc).toMatch(/data-testid=\{`sm-order-line-error-\$\{l\.item_id\}`\}/);
});

test("Retry Fulfillment stays the one recovery action, never a second/duplicate mechanism", () => {
  expect(shopManagerSrc).toMatch(/runAction\(o\.id, "retry_fulfillment"\)/);
  expect(shopManagerSrc).toMatch(/data-testid=\{`sm-order-retry-\$\{o\.id\}`\}/);
});

// ---------------------------------------------------------------------------
// Client — withdrawn read-only state
// ---------------------------------------------------------------------------

test("a withdrawn enrollment shows a client-facing banner explaining read-only status, not a silent disappearance", () => {
  expect(dashboardSrc).toMatch(/entry\.status === "withdrawn" && \(/);
  expect(dashboardSrc).toMatch(/data-testid="school-withdrawn-banner"/);
  expect(dashboardSrc).toMatch(/This enrollment was withdrawn\. You can still browse past lessons and feedback, but training progress has stopped\./);
});

test("Continue Training is disabled for a withdrawn enrollment even though the lesson content is still browsable", () => {
  expect(dashboardSrc).toMatch(/onContinue=\{\(\) => entry\.status !== "withdrawn" && roadmap\?\.current_lesson && openLesson\(roadmap\.current_lesson\.id\)\}/);
});

// ---------------------------------------------------------------------------
// Client — revoked access lock state
// ---------------------------------------------------------------------------

test("revoked access shows a lock screen instead of the roadmap, with no bypass path", () => {
  expect(dashboardSrc).toMatch(/entry\.access_state === "revoked" \? \(/);
  expect(dashboardSrc).toMatch(/testid="online-school-access-revoked"/);
  expect(dashboardSrc).toMatch(/Access to this course has been revoked\. Contact us if you believe this is a mistake\./);
});

test("client Shop repurchase is blocked (not silently offered) for a withdrawn enrollment", () => {
  expect(shopItemDetailSrc).toMatch(/selectedDogEnrollment\?\.status === "withdrawn"/);
  expect(shopItemDetailSrc).toMatch(/data-testid="shop-detail-withdrawn-disabled"/);
});

// ---------------------------------------------------------------------------
// Daily-tracker video limit alignment (6F.4) — frontend must match the
// real server ceiling (10 MB, see server.py's upload_day_video), not the
// old 15 MB it previously advertised.
// ---------------------------------------------------------------------------

test("PracticeMediaUploader's default video ceiling matches the server's real enforced limit (10 MB), not the old 15 MB", () => {
  expect(mediaUploaderSrc).toMatch(/const DEFAULT_VIDEO_MAX_MB = 10;/);
  expect(mediaUploaderSrc).not.toMatch(/const DEFAULT_VIDEO_MAX_MB = 15;/);
});

test("DailyCheckInCard's own video picker also matches the 10 MB server ceiling", () => {
  expect(dailyCheckInSrc).toMatch(/const VIDEO_MAX_MB = 10;/);
  expect(dailyCheckInSrc).not.toMatch(/const VIDEO_MAX_MB = 15;/);
});
