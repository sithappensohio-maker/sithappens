// Online School Phase 4 — Trainer Assist & Human Support Handoff —
// source-level regression guards, matching this repo's established
// convention (see onlineSchoolPhase3.test.js / checkpointEntryPoints.test.js):
// no React Testing Library rendering — behaviors that depend on component
// wiring are verified by asserting the source contains the exact pattern
// that implements them. Live interaction is verified in the browser as
// part of the release report.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const queueSrc = read("TrainerAssistQueue.jsx");
const messageModalSrc = read("MessageClientModal.jsx");
const bookingDetailSrc = read("BookingDetailModal.jsx");
const dashboardSrc = read("OnlineSchoolDashboard.jsx");
// Phase 2B+ moved the live checkpoint UI to the native School runtime; the
// legacy dashboard above is dormant. Checkpoint-state guards read the
// canonical native panel instead.
const checkpointPanelSrc = read("school", "student", "CheckpointPanel.jsx");
const polishSrc = read("..", "lib", "onlineSchoolPolish.js");
const adminDashboardSrc = read("..", "screens", "Dashboard.jsx");
const adminBookingModalSrc = read("AdminBookingModal.jsx");

// ---------------------------------------------------------------------------
// Staff queue
// ---------------------------------------------------------------------------

test("the staff queue has 4 sections: Needs Attention / Contacted / Scheduled / Recently Completed", () => {
  ["needs_attention", "contacted", "scheduled", "completed"].forEach(key => {
    expect(queueSrc).toMatch(new RegExp(`key:\\s*"${key}"`));
  });
  expect(queueSrc).toMatch(/title: "Needs Attention"/);
  expect(queueSrc).toMatch(/title: "Recently Completed"/);
});

test("the queue is sourced from the dedicated Trainer Assist endpoint, not the Phase 2 grading queue", () => {
  expect(queueSrc).toMatch(/api\.get\("\/admin\/school\/trainer-assist"\)/);
  expect(queueSrc).not.toMatch(/\/admin\/school\/checkpoints\/pending/);
});

// ---------------------------------------------------------------------------
// Detail — video, scores, context reused (no duplication)
// ---------------------------------------------------------------------------

test("case detail reuses the existing homework-media endpoint for video, no new storage", () => {
  expect(queueSrc).toMatch(/api\.get\(`\/homework\/\$\{homeworkId\}\/media\/\$\{mediaId\}`\)/);
});

test("case detail shows Handler and Dog scores read-only (no grading controls — grading already happened)", () => {
  expect(queueSrc).toMatch(/function ScoreGroup/);
  expect(queueSrc).not.toMatch(/ScoreRow/); // that's the Phase 2 grading component, not reused here
});

test("case detail shows the client note and trainer feedback from the ORIGINAL checkpoint, not fabricated", () => {
  expect(queueSrc).toMatch(/cp\?\.client_note/);
  expect(queueSrc).toMatch(/cp\?\.trainer_feedback/);
});

// ---------------------------------------------------------------------------
// Actions: contact / schedule / complete
// ---------------------------------------------------------------------------

test("Mark Contacted is an explicit action calling the dedicated endpoint", () => {
  expect(queueSrc).toMatch(/api\.post\(`\/admin\/school\/trainer-assist\/\$\{activeId\}\/contact`, \{\}\)/);
});

test("Schedule reuses the real AdminBookingModal, not a new calendar", () => {
  expect(queueSrc).toMatch(/import AdminBookingModal from "\.\/AdminBookingModal"/);
  expect(queueSrc).toMatch(/presetServiceType="training"/);
  expect(queueSrc).toMatch(/api\.post\(`\/admin\/school\/trainer-assist\/\$\{activeId\}\/schedule`, \{ booking_id: booking\.id \}\)/);
});

test("Complete requires a client-facing summary before the button is enabled", () => {
  expect(queueSrc).toMatch(/disabled=\{busy \|\| !clientSummary\.trim\(\)\}/);
  expect(queueSrc).toMatch(/api\.post\(`\/admin\/school\/trainer-assist\/\$\{activeId\}\/complete`/);
});

test("internal note field is visually and semantically distinct from the client-facing summary", () => {
  expect(queueSrc).toMatch(/staff-only, optional/);
  expect(queueSrc).toMatch(/Client-facing follow-up summary \(required\)/);
});

// ---------------------------------------------------------------------------
// Message Client — reuses existing Messages system, no auto-send
// ---------------------------------------------------------------------------

test("Message Client checks for an existing thread before deciding reply vs start", () => {
  expect(messageModalSrc).toMatch(/api\.get\(`\/admin\/messages\?client_id=/);
});

test("nothing is sent until the trainer explicitly clicks Send — the body is always editable first", () => {
  expect(messageModalSrc).toMatch(/Edit as needed before sending — nothing is sent automatically/);
  expect(messageModalSrc).toMatch(/disabled=\{sending \|\| !body\.trim\(\)\}/);
});

test("Message Client reuses the real thread reply/start endpoints, no new chat system", () => {
  expect(messageModalSrc).toMatch(/api\.post\(`\/admin\/messages\/\$\{existingThreadId\}\/reply`/);
  expect(messageModalSrc).toMatch(/api\.post\("\/admin\/messages\/start"/);
});

test("sending a message from Trainer Assist can auto-mark contacted only via the real send event, never on panel-open", () => {
  expect(queueSrc).toMatch(/onSent: markContacted/);
  expect(queueSrc).not.toMatch(/useEffect\(\(\) => \{[\s\S]{0,80}markContacted/);
});

// ---------------------------------------------------------------------------
// BookingDetailModal — trainer sees Online School context, additive only
// ---------------------------------------------------------------------------

test("Online School Trainer Assist context only renders when the booking carries the additive back-reference", () => {
  expect(bookingDetailSrc).toMatch(/booking\.trainer_assist_case_id && \(/);
  expect(bookingDetailSrc).toMatch(/<TrainerAssistContext caseId=\{booking\.trainer_assist_case_id\}\/>/);
});

test("the booking context section reuses the staff Trainer Assist detail endpoint, not a duplicate context builder", () => {
  expect(bookingDetailSrc).toMatch(/api\.get\(`\/admin\/school\/trainer-assist\/\$\{caseId\}`\)/);
});

// ---------------------------------------------------------------------------
// AdminBookingModal — additive preset props only
// ---------------------------------------------------------------------------

test("AdminBookingModal gains optional preset props with no change to existing callers' behavior", () => {
  expect(adminBookingModalSrc).toMatch(/presetServiceType = null, presetNotes = null/);
  expect(adminBookingModalSrc).toMatch(/useState\(existing\?\.service_type \|\| presetServiceType \|\| "daycare"\)/);
  expect(adminBookingModalSrc).toMatch(/useState\(existing\?\.notes \|\| presetNotes \|\| ""\)/);
});

test("the single-booking create path passes the created booking back to onCreated for linking", () => {
  expect(adminBookingModalSrc).toMatch(/const \{ data \} = await api\.post\("\/bookings", body\);/);
  expect(adminBookingModalSrc).toMatch(/onCreated\?\.\(data\);/);
});

// ---------------------------------------------------------------------------
// Dashboard entry point
// ---------------------------------------------------------------------------

test("Dashboard gates the Trainer Assist queue fetch behind manage_training_sessions, matching the checkpoint queue's own gate", () => {
  const idx = adminDashboardSrc.indexOf('api.get("/admin/school/trainer-assist")');
  expect(idx).toBeGreaterThan(-1);
  const before = adminDashboardSrc.slice(Math.max(0, idx - 200), idx);
  expect(before).toMatch(/canRef\.current\("manage_training_sessions"\)/);
});

test("the Trainer Assist tile is visually distinct (purple) from the checkpoint review tile (accent/orange)", () => {
  expect(adminDashboardSrc).toMatch(/data-testid="trainer-assist-tile"/);
  expect(adminDashboardSrc).toMatch(/bg-purple-500\/10 border border-purple-400\/40/);
});

test("Message Client is gated by the messages permission, not manage_training_sessions", () => {
  expect(adminDashboardSrc).toMatch(/canMessage=\{canRef\.current\("messages"\)\}/);
});

// ---------------------------------------------------------------------------
// Client lifecycle UX
// ---------------------------------------------------------------------------

test("the held checkpoint panel shows the real lifecycle sub-status (needs_attention/contacted/scheduled), not just a single hold message", () => {
  expect(checkpointPanelSrc).toMatch(/data-testid="school-checkpoint-hold-status"/);
  expect(checkpointPanelSrc).toMatch(/ta\.status === "scheduled"/);
  expect(checkpointPanelSrc).toMatch(/ta\.status === "contacted"/);
});

test("scheduled status shows the REAL date from stored data, never an invented ETA", () => {
  expect(checkpointPanelSrc).toMatch(/ta\.scheduled_date/);
  expect(checkpointPanelSrc).not.toMatch(/within 24 hours|1-2 business days/i);
});

test("Trainer Assist complete shows the client-facing summary and a Return to Checkpoint action, not an auto-resubmit", () => {
  expect(checkpointPanelSrc).toMatch(/data-testid="school-checkpoint-assist-complete"/);
  expect(checkpointPanelSrc).toMatch(/data-testid="school-checkpoint-return-to-checkpoint"/);
  expect(checkpointPanelSrc).toMatch(/setReturnedToCheckpoint\(true\)/);
});

test("the hold and completed states never show scary fail/warning copy to the client — this reads as help, not failure", () => {
  const start = checkpointPanelSrc.indexOf("function CheckpointPanel");
  const panelSrc = checkpointPanelSrc.slice(start, start + 4000);
  // Renderable JSX text only — excludes source comments (which legitimately
  // discuss the word "fail" while explaining what NOT to render).
  const jsxText = panelSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(jsxText).not.toMatch(/YOU FAILED|failed the (course|checkpoint|program)/i);
  expect(panelSrc).toMatch(/wants to help with this one/);
});

test("Student Home Trainer Status reflects the real Trainer Assist sub-status, no invented response-time promise", () => {
  expect(polishSrc).toMatch(/ta\.status === "scheduled"/);
  expect(polishSrc).toMatch(/Trainer contacted you/);
  expect(polishSrc).toMatch(/Trainer Assist complete — ready to continue/);
  expect(polishSrc).not.toMatch(/within 24 hours|1-2 business days/i);
});

test("Trainer Feedback history renders Trainer Assist as a later chapter, never overwriting the original checkpoint review", () => {
  expect(dashboardSrc).toMatch(/entry\.trainer_assist && \(/);
  expect(dashboardSrc).toMatch(/what happened afterward/);
});

// ---------------------------------------------------------------------------
// Cancellation / reschedule lifecycle integrity — "reschedule_needed" is a
// DERIVED-ONLY value (never stored; see server.py's
// _enrich_trainer_assist_schedule) surfaced when the linked booking was
// cancelled through the existing, untouched booking-cancellation path.
// ---------------------------------------------------------------------------

test("client held-checkpoint panel has a distinct reschedule-needed sub-state, not a stale scheduled date", () => {
  expect(checkpointPanelSrc).toMatch(/ta\.status === "reschedule_needed"/);
  expect(checkpointPanelSrc).toMatch(/Trainer Assist needs to be rescheduled/);
});

test("Trainer Feedback history reflects reschedule-needed too, not just the live current-lesson state", () => {
  expect(dashboardSrc).toMatch(/entry\.trainer_assist\.status === "reschedule_needed"/);
  expect(dashboardSrc).toMatch(/That appointment was canceled/);
});

test("Student Home Trainer Status has a reschedule-needed branch with no invented ETA", () => {
  expect(polishSrc).toMatch(/ta\.status === "reschedule_needed"/);
  expect(polishSrc).toMatch(/Trainer Assist needs rescheduling/);
});

test("staff queue flags cancelled appointments without moving the case out of its section (no item disappears)", () => {
  expect(queueSrc).toMatch(/it\.appointment_cancelled/);
  expect(queueSrc).toMatch(/Needs Reschedule/);
});

test("staff detail shows a distinct Appointment Canceled state, not a misleading blue Scheduled Appointment box", () => {
  expect(queueSrc).toMatch(/data-testid="trainer-assist-appointment-cancelled"/);
  expect(queueSrc).toMatch(/Appointment Canceled/);
  expect(queueSrc).toMatch(/Schedule a replacement/);
});

test("STATUS_META has a reschedule_needed entry so the detail status pill never silently falls back to blank", () => {
  expect(queueSrc).toMatch(/reschedule_needed:\s*\{ label: "Needs Reschedule"/);
});

test("the Reschedule button label covers both scheduled and reschedule_needed", () => {
  expect(queueSrc).toMatch(/status === "scheduled" \|\| status === "reschedule_needed" \? "Reschedule"/);
});
