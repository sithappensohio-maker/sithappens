/**
 * Care Board ⇄ staff roster (audit #2). Mounts the real screens:
 *   - the staff roster lists today's care items (one per dose time) from the
 *     server, shows a Care Board tick as given, flags a missed dose, and a
 *     tap posts the care item id so the Care Board records the same dose;
 *   - the tap carries the day the list was showing (a tap just after
 *     midnight records last night's dose, not tonight's);
 *   - a refused second tick (409) is shown, not swallowed;
 *   - a skipped dose can still be given later, on both screens;
 *   - the Care Board shows the completion time in local 12h time (it used to
 *     print the UTC hour straight out of the timestamp) and who recorded it;
 *   - "Not recorded yesterday" lists yesterday's unticked doses and records
 *     them against yesterday, not today.
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

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");
const { toast } = require("sonner");
const EmployeePortal = require("./EmployeePortal").default;
const CareBoard = require("./CareBoard").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const ROSTER_ROW = {
  booking_id: "b1", dog_id: "d1", dog_name: "Biscuit", client_name: "Sam", service_type: "boarding",
  date: "2026-09-24", end_date: "2026-09-27", checked_in_at: "2026-09-24T10:00:00+00:00", checked_out_at: null,
  status: "approved", is_missed_checkout: false, vaccines: {}, feeding_schedule: [], medications: [],
  feeding_log: [], medication_log: [], bathroom_log: { pee: 0, poop: 0 },
  care_today: [
    { id: "f1", kind: "feeding", time: "07:30", label: "Feeding", amount: "1 cup", food_type: "Kibble",
      status: "completed", derived_status: "completed", completed_at: "2026-09-25T11:40:00+00:00",
      completed_initials: "PW", source: "care_board", day: "2026-09-25" },
    { id: "m1", kind: "medication", time: "08:00", label: "Apoquel", amount: "1 tablet",
      status: "pending", derived_status: "missed", due_minutes_delta: 120, day: "2026-09-25" },
    { id: "m2", kind: "medication", time: "20:00", label: "Apoquel", amount: "1 tablet",
      status: "pending", derived_status: "not_due", day: "2026-09-25" },
    { id: "m3", kind: "medication", time: "12:00", label: "Gabapentin", amount: "100mg",
      status: "skipped", derived_status: "skipped", skip_reason: "Dog refused", completed_initials: "PW",
      source: "care_board", day: "2026-09-25" },
  ],
};

const BOARD = {
  date: "2026-09-25",
  summary: { not_due: 0, due_now: 0, completed: 1, missed: 0, skipped: 0 },
  feedings: [],
  medications: [{
    id: "m1", kind: "medication", time: "08:00", label: "Apoquel", booking_id: "b1", dog_name: "Biscuit",
    status: "completed", derived_status: "completed", completed_at: "2026-09-25T12:05:00+00:00",
    completed_initials: "JT", source: "roster", day: "2026-09-25",
  }, {
    id: "m3", kind: "medication", time: "12:00", label: "Gabapentin", booking_id: "b1", dog_name: "Biscuit",
    status: "skipped", derived_status: "skipped", skip_reason: "Dog refused", completed_initials: "PW",
    source: "care_board", day: "2026-09-25",
  }],
  on_site_count: 1,
  earlier_date: "2026-09-24",
  earlier: [{
    id: "m2", kind: "medication", time: "20:00", label: "Apoquel", amount: "1 tablet", booking_id: "b1",
    dog_name: "Biscuit", client_name: "Sam", status: "pending", derived_status: "missed", day: "2026-09-24",
  }],
};

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset();
  api.post.mockReset();
  toast.error.mockReset();
  useAuth.mockReturnValue({ user: { name: "Jamie Tran", email: "jamie@example.com", role: "employee" }, logout: jest.fn(), can: () => false });
  api.get.mockImplementation((path) => {
    if (path === "/employee/roster-today") return Promise.resolve({ data: { date: "2026-09-25", roster: [ROSTER_ROW] } });
    if (path === "/care/today") return Promise.resolve({ data: BOARD });
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

async function openRoster() {
  await act(async () => { root.render(<EmployeePortal />); });
  await act(async () => { $("emp-tab-roster").click(); });
  await flush();
}

test("roster lists today's doses from the care schedule and shows a Care Board tick as given", async () => {
  await openRoster();
  expect($("roster-care-b1")).not.toBeNull();
  expect($("carepoint-feeding-b1-0").textContent).toContain("Feeding");
  expect($("carepoint-given-feeding-b1-0").textContent).toMatch(/Given .* · PW · Care Board/);
  expect($("carepoint-confirm-feeding-b1-0").disabled).toBe(true);
  // one row per dose time, not one per medication
  expect($("carepoint-medication-b1-0").textContent).toContain("Apoquel");
  expect($("carepoint-medication-b1-1").textContent).toContain("Apoquel");
  expect($("carepoint-medication-b1-0").textContent).toContain("Missed");
  expect($("carepoint-medication-b1-1").textContent).not.toContain("Missed");
});

test("a roster tap records THAT dose on the Care Board (posts the care item id)", async () => {
  api.post.mockResolvedValue({ data: { ok: true } });
  await openRoster();
  await act(async () => { $("carepoint-confirm-medication-b1-0").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/employee/bookings/b1/log-medication", { index: 0, care_item_id: "m1", day: "2026-09-25" });
  expect(api.get.mock.calls.filter(([p]) => p === "/employee/roster-today").length).toBeGreaterThan(1);
});

test("a refused second tick is shown to the staff member, not swallowed", async () => {
  api.post.mockRejectedValue({ response: { status: 409, data: { detail: "Already given today at 8:05 AM by JT. Nothing was changed." } } });
  await openRoster();
  await act(async () => { $("carepoint-confirm-medication-b1-0").click(); });
  await flush();
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Already given today"));
});

test("Care Board shows the completion time in 12-hour local time and who recorded it", async () => {
  await act(async () => { root.render(<CareBoard />); });
  await flush();
  const row = $("care-row-m1").textContent;
  expect(row).toMatch(/JT · \d{1,2}:\d{2} (AM|PM)/);
  expect(row).toContain("staff roster");
});

test("Not recorded yesterday lists yesterday's doses and records them against yesterday", async () => {
  api.post.mockResolvedValue({ data: { ok: true } });
  await act(async () => { root.render(<CareBoard />); });
  await flush();
  expect($("care-earlier").textContent).toContain("Not recorded yesterday");
  expect($("care-earlier-row-m2").textContent).toContain("Biscuit");
  await act(async () => { $("care-earlier-given-m2").click(); });
  const initials = $("care-initials");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(initials, "jt");
    initials.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { $("care-complete-submit").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/bookings/b1/care/m2/complete", { initials: "jt", note: "", day: "2026-09-24" });
});

test("a skipped dose can still be given later — on the roster and on the Care Board", async () => {
  api.post.mockResolvedValue({ data: { ok: true } });
  await openRoster();
  const skipped = $("carepoint-confirm-medication-b1-2");
  expect($("carepoint-medication-b1-2").textContent).toContain("Skipped · Dog refused");
  expect(skipped.disabled).toBe(false);
  await act(async () => { skipped.click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/employee/bookings/b1/log-medication", { index: 2, care_item_id: "m3", day: "2026-09-25" });

  await act(async () => root.render(<CareBoard />));
  await flush();
  expect($("care-complete-m3").textContent).toContain("Given after all");
  expect($("care-skip-m3")).toBeNull();
  expect($("care-complete-m1")).toBeNull();
});

test("the roster refreshes itself every minute", async () => {
  const spy = jest.spyOn(global, "setInterval");
  try {
    await openRoster();
    const refresh = spy.mock.calls.filter(([, ms]) => ms === 60000).pop();
    expect(refresh).toBeTruthy();
    const before = api.get.mock.calls.filter(([p]) => p === "/employee/roster-today").length;
    await act(async () => { refresh[0](); });
    await flush();
    expect(api.get.mock.calls.filter(([p]) => p === "/employee/roster-today").length).toBe(before + 1);
  } finally {
    spy.mockRestore();
  }
});
