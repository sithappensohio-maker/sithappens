/**
 * Employee Portal — two gaps closed together (2026-10-09):
 *
 * 1. The Roster tab could only check in a dog already on today's schedule;
 *    there was no way for a non-admin staff member to register a true
 *    walk-in at all. The "+ Walk-In" button reuses the exact AdminBookingModal
 *    flow the full admin Front Desk already uses for Quick Check-In, gated
 *    on the same `booking_edit` permission the Cancel action already checks
 *    (and the one `POST /bookings` itself now actually enforces for every
 *    non-admin staff account — see test_booking_create_permission_gap.py).
 *
 * 2. "Register" was only reachable from the full admin app — an employee
 *    with Register-relevant permissions (take_payments / sell_credits /
 *    finance_reports / delete_records) had no way to use them at all. The
 *    new Register tab mounts the SAME RegisterTab component AdminShell's
 *    Front Desk already uses, which self-gates each of its own sub-tabs by
 *    the matching permission — this test only proves the entry point is
 *    correctly gated, not RegisterTab's own internals (covered elsewhere).
 *
 * Mounted, not source-pinned, following careSync.test.js's established
 * EmployeePortal mount pattern.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (x) => String(x || ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, ConfirmProvider: ({ children }) => children }));
jest.mock("../components/AdminBookingModal", () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="mock-admin-booking-modal" data-default-checkin={String(!!props.defaultCheckIn)}>
      <button data-testid="mock-walkin-close" onClick={props.onClose}>close</button>
      <button data-testid="mock-walkin-created" onClick={props.onCreated}>created</button>
    </div>
  ),
}));
jest.mock("./Staff", () => ({ RegisterTab: () => <div data-testid="mock-register-tab">register tools</div> }));

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");
const EmployeePortal = require("./EmployeePortal").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const ROSTER_ROW = {
  booking_id: "b1", dog_id: "d1", dog_name: "Biscuit", client_name: "Sam", service_type: "daycare",
  date: "2026-10-09", end_date: "2026-10-09", checked_in_at: null, checked_out_at: null,
  status: "approved", is_missed_checkout: false, vaccines: {}, feeding_schedule: [], medications: [],
  feeding_log: [], medication_log: [], bathroom_log: { pee: 0, poop: 0 },
};

let container, root;

const mockAuth = (perms) => {
  const grant = new Set(perms);
  useAuth.mockReturnValue({
    user: { name: "Jamie Tran", email: "jamie@example.com", role: "employee" },
    logout: jest.fn(),
    can: (key) => grant.has(key),
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((path) => {
    if (path === "/employee/roster-today") return Promise.resolve({ data: { date: "2026-10-09", roster: [ROSTER_ROW] } });
    if (path === "/services") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const $ = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount() {
  await act(async () => { root.render(<EmployeePortal />); });
  await flush();
}

// ─────────────────────── Walk-In ───────────────────────

test("an employee without booking_edit never sees the Walk-In button", async () => {
  mockAuth([]);
  await mount();
  await act(async () => { $("emp-tab-roster").click(); });
  await flush();
  expect($("roster-walkin")).toBeNull();
});

test("an employee with booking_edit can open and complete a walk-in, which refreshes the roster", async () => {
  mockAuth(["booking_edit"]);
  await mount();
  await act(async () => { $("emp-tab-roster").click(); });
  await flush();
  expect($("roster-walkin")).not.toBeNull();

  await act(async () => { $("roster-walkin").click(); });
  await flush();
  const modal = $("mock-admin-booking-modal");
  expect(modal).not.toBeNull();
  // Same mode the admin Front Desk's own Quick Check-In uses.
  expect(modal.getAttribute("data-default-checkin")).toBe("true");

  const rosterCallsBefore = api.get.mock.calls.filter(([p]) => p === "/employee/roster-today").length;
  await act(async () => { $("mock-walkin-created").click(); });
  await flush();
  expect($("mock-admin-booking-modal")).toBeNull(); // closed itself
  const rosterCallsAfter = api.get.mock.calls.filter(([p]) => p === "/employee/roster-today").length;
  expect(rosterCallsAfter).toBeGreaterThan(rosterCallsBefore);
});

test("closing the walk-in modal without creating anything just closes it", async () => {
  mockAuth(["booking_edit"]);
  await mount();
  await act(async () => { $("emp-tab-roster").click(); });
  await flush();
  await act(async () => { $("roster-walkin").click(); });
  await flush();
  await act(async () => { $("mock-walkin-close").click(); });
  await flush();
  expect($("mock-admin-booking-modal")).toBeNull();
});

// ─────────────────────── Register ───────────────────────

test("an employee with no register-relevant permission never sees the Register tab", async () => {
  mockAuth(["booking_edit", "care_complete"]);
  await mount();
  expect($("emp-tab-register")).toBeNull();
});

test.each(["take_payments", "sell_credits", "finance_reports", "delete_records"])(
  "an employee with %s sees and can open the Register tab",
  async (perm) => {
    mockAuth([perm]);
    await mount();
    expect($("emp-tab-register")).not.toBeNull();
    await act(async () => { $("emp-tab-register").click(); });
    await flush();
    expect($("mock-register-tab")).not.toBeNull();
  },
);

test("a live permission downgrade while sitting on Register bounces back to Clock", async () => {
  mockAuth(["take_payments"]);
  await mount();
  await act(async () => { $("emp-tab-register").click(); });
  await flush();
  expect($("mock-register-tab")).not.toBeNull();

  // Simulate the 60s /me/permissions poll (lib/auth.js) downgrading this
  // account mid-session — re-mount with the narrowed `can`, same render-level
  // guard already proven for clients/incidents/training.
  mockAuth([]);
  await act(async () => { root.render(<EmployeePortal />); });
  await flush();
  expect($("mock-register-tab")).toBeNull();
  expect($("emp-tab-register")).toBeNull();
});
