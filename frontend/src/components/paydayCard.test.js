/* Staff → Payroll's payday card: with no schedule it asks for one; with a
 * schedule it says, per staff member, what is owed on the latest payday.
 * Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PaydayCard from "./PaydayCard";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const PAYDAY = {
  configured: true,
  schedule: { cadence: "biweekly", anchor_payday: "2026-10-30", set_on: "2026-10-30" },
  today: "2026-10-30", payday: "2026-10-30", is_today: true, next_payday: "2026-11-13",
  period_start: "2026-10-16", period_end: "2026-10-29",
  per_user: [
    { user_id: "u1", name: "Sarah Lane", hours: 20.5, gross: 410.0, estimated_take_home: 352.6 },
    { user_id: "u2", name: "Mike Ortiz", hours: 18, gross: 288.0, estimated_take_home: 247.68 },
  ],
  totals: { gross: 698.0, estimated_take_home: 600.28 },
  open_shifts: 1,
};

let container; let root;
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const setValue = async (el, value) => {
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  await act(async () => { el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
};

test("on payday it lists what each staff member is owed and the total", async () => {
  api.get.mockResolvedValue({ data: PAYDAY });
  await act(async () => { root.render(<PaydayCard />); });
  await flush();

  expect(api.get).toHaveBeenCalledWith("/admin/payroll/payday");
  expect(container.textContent).toContain("Payday is today");
  expect(byTestId("payday-row-u1").textContent).toContain("Sarah Lane");
  expect(byTestId("payday-row-u1").textContent).toContain("$410.00");
  expect(byTestId("payday-row-u2").textContent).toContain("$288.00");
  expect(byTestId("payday-total").textContent).toBe("$698.00");
  expect(byTestId("payday-period").textContent).toContain("10/16/2026");
  expect(byTestId("payday-period").textContent).toContain("10/29/2026");
  expect(byTestId("payday-open-shifts").textContent).toContain("1 shift in this pay period is still clocked in");
});

test("with no schedule it asks for one, and saving shows what is owed", async () => {
  api.get.mockResolvedValue({ data: { configured: false } });
  api.put.mockResolvedValue({ data: PAYDAY });
  await act(async () => { root.render(<PaydayCard />); });
  await flush();

  expect(byTestId("payday-list")).toBeNull();
  await setValue(byTestId("payday-cadence"), "biweekly");
  await setValue(byTestId("payday-anchor"), "2026-10-30");
  await act(async () => { byTestId("payday-save").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();

  expect(api.put).toHaveBeenCalledWith("/admin/payroll/schedule", { cadence: "biweekly", anchor_payday: "2026-10-30" });
  expect(byTestId("payday-total").textContent).toBe("$698.00");
});

test("a payday from before a schedule change says its hours are on the next payday", async () => {
  api.get.mockResolvedValue({ data: { ...PAYDAY, per_user: [], totals: { gross: 0, estimated_take_home: 0 }, open_shifts: 0,
    period_start: "2026-10-30", period_end: "2026-10-29", before_schedule_change: true } });
  await act(async () => { root.render(<PaydayCard />); });
  await flush();
  expect(byTestId("payday-period").textContent).toContain("came before you changed your schedule");
  expect(byTestId("payday-period").textContent).not.toContain("10/29/2026");
  expect(byTestId("payday-empty").textContent).toBe("Nothing is owed on it. Hours worked since your last payday are paid on Fri 11/13/2026.");
});

test("someone without access to pay amounts sees nothing at all", async () => {
  api.get.mockRejectedValue({ response: { status: 403, data: { detail: "Missing permission: finance_reports" } } });
  await act(async () => { root.render(<PaydayCard />); });
  await flush();
  expect(byTestId("payday-card")).toBeNull();
});

test("a failed load can be tried again", async () => {
  api.get.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Internal server error" } } })
    .mockResolvedValueOnce({ data: PAYDAY });
  await act(async () => { root.render(<PaydayCard />); });
  await flush();
  await act(async () => { byTestId("payday-retry").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
  expect(byTestId("payday-total").textContent).toBe("$698.00");
});

test("a pay period with no clocked hours says nobody is owed", async () => {
  api.get.mockResolvedValue({ data: { ...PAYDAY, per_user: [], totals: { gross: 0, estimated_take_home: 0 }, open_shifts: 0, is_today: false } });
  await act(async () => { root.render(<PaydayCard />); });
  await flush();
  expect(container.textContent).toContain("Last payday");
  expect(byTestId("payday-empty")).not.toBeNull();
  expect(byTestId("payday-open-shifts")).toBeNull();
});
