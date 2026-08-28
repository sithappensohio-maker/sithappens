// Action Required / Pending Actions — source-level regression guards,
// matching this repo's established convention (see checkpointEntryPoints
// .test.js): no rendering; component wiring is verified by asserting the
// source contains the exact pattern that implements it.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const panelSrc = read("PendingActionsPanel.jsx");
const dashboardSrc = read("..", "screens", "Dashboard.jsx");
const bookingsSrc = read("..", "screens", "Bookings.jsx");
const posSrc = read("..", "screens", "Pos.jsx");
const appSrc = read("..", "App.js");

// ---------------------------------------------------------------------------
// Dashboard — Action Required panel above normal content
// ---------------------------------------------------------------------------

test("Dashboard renders the Action Required panel above operational widgets and never widget-gates it", () => {
  const panelAt = dashboardSrc.indexOf("<PendingActionsPanel");
  const ownerToolsAt = dashboardSrc.indexOf('data-testid="owner-tools-row"');
  expect(panelAt).toBeGreaterThan(-1);
  expect(ownerToolsAt).toBeGreaterThan(-1);
  expect(panelAt).toBeLessThan(ownerToolsAt);
  // Not wrapped in widgetOn(...) — a pending request must never be hidden
  // by dashboard customization.
  const before = dashboardSrc.slice(Math.max(0, panelAt - 200), panelAt);
  expect(before).not.toMatch(/widgetOn\(/);
});

test("the no-actions state collapses to a subtle line instead of an alarm panel", () => {
  expect(panelSrc).toMatch(/No pending actions/);
  expect(panelSrc).toMatch(/data-testid=\{`\$\{testid\}-empty`\}/);
});

// ---------------------------------------------------------------------------
// Panel content — request date AND requested appointment date, escalation
// ---------------------------------------------------------------------------

test("action cards show both the submission time and the requested appointment date", () => {
  expect(panelSrc).toMatch(/Requested\s*<span/);
  expect(panelSrc).toMatch(/Received \{fmtReceived\(action\.created_at\)\}/);
  expect(panelSrc).toMatch(/action\.waiting_label/);
});

test("urgency states visually differ and use the danger style for overdue/urgent", () => {
  expect(panelSrc).toMatch(/action_required:/);
  expect(panelSrc).toMatch(/waiting:/);
  expect(panelSrc).toMatch(/overdue:/);
  expect(panelSrc).toMatch(/urgent_today:/);
  expect(panelSrc).toMatch(/overdue_requested_passed:/);
  expect(panelSrc).toMatch(/red-500/);
});

test("cards deep-link to the exact record via the stored target + sh:nav", () => {
  expect(panelSrc).toMatch(/PENDING_ACTION_TARGET_KEY/);
  expect(panelSrc).toMatch(/sessionStorage\.setItem\(PENDING_ACTION_TARGET_KEY, JSON\.stringify\(dl\)\)/);
  expect(panelSrc).toMatch(/new CustomEvent\("sh:nav", \{ detail: dl\.screen \|\| "bookings" \}\)/);
});

test("long client/dog/service names wrap instead of overflowing", () => {
  expect(panelSrc).toMatch(/break-words/);
  expect(panelSrc).toMatch(/min-w-0/);
});

// ---------------------------------------------------------------------------
// Bookings — Needs Approval before ordinary bookings, unmistakable status
// ---------------------------------------------------------------------------

test("Bookings has a Needs Approval section rendered before the normal booking list", () => {
  const needsAt = bookingsSrc.indexOf('data-testid="bookings-needs-approval"');
  const listAt = bookingsSrc.indexOf('testid="bookings-active-groups"');
  expect(needsAt).toBeGreaterThan(-1);
  expect(listAt).toBeGreaterThan(-1);
  expect(needsAt).toBeLessThan(listAt);
  expect(bookingsSrc).toMatch(/data-testid="bookings-needs-approval-count"/);
});

test("pending bookings read PENDING APPROVAL with a bordered high-contrast chip", () => {
  expect(bookingsSrc).toMatch(/s === "pending" \? "PENDING APPROVAL"/);
  expect(bookingsSrc).toMatch(/pending: "bg-shAccent\/20 text-shAccent border border-shAccent\/50"/);
});

test("approve/reject from the Needs Approval queue update the global pending badge immediately", () => {
  expect(bookingsSrc).toMatch(/announcePendingActionsChanged\(\); load\(\);/);
  expect(bookingsSrc).toMatch(/data-testid=\{`needs-approval-approve-\$\{i\}`\}/);
  expect(bookingsSrc).toMatch(/data-testid=\{`needs-approval-reject-\$\{i\}`\}/);
});

test("Bookings consumes the pending-action deep link exactly once and opens that booking", () => {
  expect(bookingsSrc).toMatch(/sessionStorage\.getItem\(PENDING_ACTION_TARGET_KEY\)/);
  expect(bookingsSrc).toMatch(/setDetailFor\(b\);/);
  expect(bookingsSrc).toMatch(/sessionStorage\.removeItem\(PENDING_ACTION_TARGET_KEY\)/);
});

// ---------------------------------------------------------------------------
// Navigation badges + Front Desk
// ---------------------------------------------------------------------------

test("pending-action nav badges moved to the consolidated Today and Schedule destinations", () => {
  // Phase 6 consolidated the nav counters behind useAdminNavCounts
  // (lib/sharedData.js, one /admin/live-summary call); the badge, its
  // permission gate, and the change-event refresh all still exist.
  const sharedSrc = read("..", "lib", "sharedData.js");
  expect(appSrc).toMatch(/useAdminNavCounts\(/);
  expect(appSrc).toMatch(/n\.id === "schedule" \|\| n\.id === "today"\) && pendingActions > 0/);
  expect(appSrc).toMatch(/pendingActions: !!can\?\.\("booking_edit"\)/);
  expect(sharedSrc).toMatch(/sh:pending-actions-changed/);
  expect(sharedSrc).toMatch(/pendingActions: allowPending \? \(payload\.pending_actions\?\.total \|\| 0\) : 0/);
});

test("Front Desk reuses the same shared panel (no duplicated queue logic)", () => {
  expect(posSrc).toMatch(/<PendingActionsPanel testid="frontdesk-pending-actions"/);
});

// ---------------------------------------------------------------------------
// Lifecycle separation — reading notifications never clears actions
// ---------------------------------------------------------------------------

test("the panel derives ONLY from /admin/pending-actions — no notification read/dismiss endpoints involved", () => {
  expect(panelSrc).toMatch(/api\.get\("\/admin\/pending-actions"/);
  expect(panelSrc).not.toMatch(/api\.post\([^)]*(read|dismiss|resolve)/i);
});
