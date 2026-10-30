/* Staff → Payroll's payday card: with no schedule it asks for one; with a
 * schedule it says, per staff member, what is owed on the latest payday.
 * Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PaydayCard from "./PaydayCard";
import { ConfirmProvider } from "../lib/useConfirm";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e?.response?.data?.detail || e || ""),
}));
let mockCan = () => true;
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: (k) => mockCan(k) }) }));

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
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
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
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
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
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  expect(byTestId("payday-period").textContent).toContain("came before you changed your schedule");
  expect(byTestId("payday-period").textContent).not.toContain("10/29/2026");
  expect(byTestId("payday-empty").textContent).toBe("Nothing is owed on it. Hours worked since your last payday are paid on Fri 11/13/2026.");
});

test("someone without access to pay amounts sees nothing at all", async () => {
  api.get.mockRejectedValue({ response: { status: 403, data: { detail: "Missing permission: finance_reports" } } });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  expect(byTestId("payday-card")).toBeNull();
});

test("a failed load can be tried again", async () => {
  api.get.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Internal server error" } } })
    .mockResolvedValueOnce({ data: PAYDAY });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  await act(async () => { byTestId("payday-retry").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
  expect(byTestId("payday-total").textContent).toBe("$698.00");
});

test("a pay period with no clocked hours says nobody is owed", async () => {
  api.get.mockResolvedValue({ data: { ...PAYDAY, per_user: [], totals: { gross: 0, estimated_take_home: 0 }, open_shifts: 0, is_today: false } });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  expect(container.textContent).toContain("Last payday");
  expect(byTestId("payday-empty")).not.toBeNull();
  expect(byTestId("payday-open-shifts")).toBeNull();
});

// Owner, 2026-10-30: "nothing to mark her paid".
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const PAID = (over = {}) => ({
  ...PAYDAY, open_shifts: 0,
  per_user: [
    { ...PAYDAY.per_user[0], paid: 410, remaining: 0,
      payments: [{ id: "p1", name: "Sarah Lane", amount: 410, payment_method: "cash", paid_on: "2026-10-30", from_cash_drawer: true }] },
    { ...PAYDAY.per_user[1], paid: 0, remaining: 288, payments: [] },
  ],
  totals: { ...PAYDAY.totals, paid: 410, remaining: 288 },
  ...over,
});

test("Mark paid records what's owed, by the chosen method, and the card shows them paid", async () => {
  api.get.mockResolvedValue({ data: { ...PAYDAY, open_shifts: 0 } });
  api.post.mockResolvedValue({ data: PAID() });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  await click(byTestId("payday-mark-paid-u1"));
  expect(byTestId("payday-pay-amount").value).toBe("410.00");
  await setValue(byTestId("payday-pay-method"), "cash");
  expect(byTestId("payday-pay-drawer")).toBeTruthy();
  await click(byTestId("payday-pay-drawer"));
  await click(byTestId("payday-pay-save"));
  const [url, body] = api.post.mock.calls[0];
  expect(url).toBe("/admin/payroll/payday/2026-10-30/payments");
  expect(body).toMatchObject({ user_id: "u1", amount: 410, payment_method: "cash", from_cash_drawer: true });
  expect(body.request_id).toBeTruthy();
  expect(byTestId("payday-paid-u1").textContent).toContain("Paid");
  expect(byTestId("payday-payment-p1").textContent).toContain("from the register drawer");
  expect(byTestId("payday-total").textContent).toBe("$288.00");
  expect(byTestId("payday-mark-paid-u2")).toBeTruthy();
});

test("the drawer choice is only for cash, and a check is never sent as from the drawer", async () => {
  api.get.mockResolvedValue({ data: { ...PAYDAY, open_shifts: 0 } });
  api.post.mockResolvedValue({ data: PAID() });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  await click(byTestId("payday-mark-paid-u1"));
  await click(byTestId("payday-pay-drawer"));
  await setValue(byTestId("payday-pay-method"), "check");
  expect(byTestId("payday-pay-drawer")).toBeNull();
  await click(byTestId("payday-pay-save"));
  expect(api.post.mock.calls[0][1]).toMatchObject({ payment_method: "check", from_cash_drawer: false });
});

test("sending the same payment again reuses its id; a changed amount is a new payment", async () => {
  const refused = { response: { status: 422, data: { detail: "The date paid can't be in the future." } } };
  api.get.mockResolvedValue({ data: { ...PAYDAY, open_shifts: 0 } });
  api.post.mockRejectedValueOnce(refused).mockRejectedValueOnce(refused).mockResolvedValue({ data: PAID() });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  await click(byTestId("payday-mark-paid-u1"));
  await click(byTestId("payday-pay-save"));
  expect(byTestId("payday-pay-error").textContent).toContain("can't be in the future");
  await click(byTestId("payday-pay-save"));
  await setValue(byTestId("payday-pay-amount"), "400");
  await click(byTestId("payday-pay-save"));
  const ids = api.post.mock.calls.map(([, b]) => b.request_id);
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).not.toBe(ids[0]);
  expect(api.post.mock.calls[2][1].amount).toBe(400);
});

test("part paid shows what's left; Undo asks first, then removes the payment", async () => {
  const partly = PAID({ per_user: [{ ...PAYDAY.per_user[0], paid: 200, remaining: 210,
    payments: [{ id: "p2", name: "Sarah Lane", amount: 200, payment_method: "transfer", paid_on: "2026-10-30" }] }],
    totals: { ...PAYDAY.totals, paid: 200, remaining: 210 } });
  api.get.mockResolvedValue({ data: partly });
  api.delete.mockResolvedValue({ data: { ...PAYDAY, open_shifts: 0 } });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  expect(byTestId("payday-row-u1").textContent).toContain("$410.00 owed, $200.00 paid so far");
  expect(byTestId("payday-row-u1").textContent).toContain("$210.00");
  expect(byTestId("payday-paid-total").textContent).toContain("$200.00 paid so far");
  await click(byTestId("payday-undo-p2"));
  expect(api.delete).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid="confirm-dialog"]').textContent).toContain("$200.00 to Sarah Lane");
  await click(document.querySelector('[data-testid="confirm-yes"]'));
  expect(api.delete).toHaveBeenCalledWith("/admin/payroll/payments/p2");
  expect(byTestId("payday-total").textContent).toBe("$698.00");
});

test("when everyone is paid the card says so", async () => {
  api.get.mockResolvedValue({ data: PAID({ per_user: [PAID().per_user[0]], totals: { gross: 410, paid: 410, remaining: 0 } }) });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  expect(container.textContent).toContain("All paid");
  expect(byTestId("payday-mark-paid-u1")).toBeNull();
});


test("a lost reply is sent again once, then checked: a payment that went through shows as paid", async () => {
  jest.useFakeTimers();
  try {
    const lost = Object.assign(new Error("Network Error"), { request: {} });
    api.get.mockResolvedValueOnce({ data: { ...PAYDAY, open_shifts: 0 } });
    api.post.mockRejectedValue(lost);
    await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byTestId("payday-mark-paid-u1").click(); });
    await act(async () => { byTestId("payday-pay-save").click(); });
    expect(byTestId("payday-mark-paid-u2").disabled).toBe(true);   // nothing else while it sends
    const sentId = api.post.mock.calls[0][1].request_id;
    const saved = PAID();
    saved.per_user[0].payments[0].request_id = sentId;
    api.get.mockResolvedValueOnce({ data: saved });
    await act(async () => { jest.advanceTimersByTime(1600); });
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[1][1].request_id).toBe(sentId);
    expect(api.get).toHaveBeenLastCalledWith("/admin/payroll/payday", { params: { payday: "2026-10-30" } });
    expect(byTestId("payday-paid-u1")).toBeTruthy();
    expect(byTestId("payday-pay-form-u1")).toBeNull();
  } finally { jest.useRealTimers(); }
});

test("a W-2 employee's Mark paid starts at their take-home and records the withholding", async () => {
  const w2 = { ...PAYDAY, open_shifts: 0, per_user: [{ ...PAYDAY.per_user[0], tax_status: "w2", paid: 0, remaining: 410, payments: [] }] };
  api.get.mockResolvedValue({ data: w2 });
  api.post.mockResolvedValue({ data: PAID() });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  await click(byTestId("payday-mark-paid-u1"));
  expect(byTestId("payday-pay-amount").value).toBe("410.00");
  expect(byTestId("payday-pay-withheld").value).toBe("57.40");
  expect(byTestId("payday-pay-handed").textContent).toContain("You hand over $352.60");
  await click(byTestId("payday-pay-save"));
  expect(api.post.mock.calls[0][1]).toMatchObject({ amount: 410, withheld: 57.4 });
});

test("a failed Undo says why, and without the delete permission there is no Undo", async () => {
  api.get.mockResolvedValue({ data: PAID() });
  api.delete.mockRejectedValue({ response: { status: 409, data: { detail: "The register for 2026-10-30 is closed. Reopen the day first." } } });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  await click(byTestId("payday-undo-p1"));
  await click(document.querySelector('[data-testid="confirm-yes"]'));
  expect(byTestId("payday-undo-error-p1").textContent).toContain("Reopen the day first");
  act(() => root.unmount());
  root = createRoot(container);
  mockCan = (k) => k !== "delete_records";
  try {
    await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
    await flush();
    expect(byTestId("payday-payment-p1")).toBeTruthy();
    expect(byTestId("payday-undo-p1")).toBeNull();
  } finally { mockCan = () => true; }
});

test("someone with hours but no pay rate is flagged, never shown as paid", async () => {
  const noRate = { ...PAYDAY, open_shifts: 0, per_user: [{ user_id: "u3", name: "New Hire", hours: 6, gross: 0,
    estimated_take_home: 0, paid: 0, remaining: 0, no_rate: true, payments: [] }], totals: { gross: 0, paid: 0, remaining: 0 } };
  api.get.mockResolvedValue({ data: noRate });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  expect(byTestId("payday-paid-u3")).toBeNull();
  expect(byTestId("payday-row-u3").textContent).toContain("no pay rate set");
  expect(byTestId("payday-mark-paid-u3")).toBeTruthy();
});

test("an earlier payday can be opened, and the latest one again", async () => {
  api.get.mockResolvedValueOnce({ data: { ...PAYDAY, is_latest: true, previous_payday: "2026-10-16" } })
    .mockResolvedValueOnce({ data: { ...PAYDAY, payday: "2026-10-16", is_today: false, is_latest: false, previous_payday: null } })
    .mockResolvedValueOnce({ data: { ...PAYDAY, is_latest: true } });
  await act(async () => { root.render(<ConfirmProvider><PaydayCard /></ConfirmProvider>); });
  await flush();
  await click(byTestId("payday-earlier"));
  expect(api.get).toHaveBeenLastCalledWith("/admin/payroll/payday", { params: { payday: "2026-10-16" } });
  expect(container.textContent).toContain("Earlier payday");
  expect(byTestId("payday-earlier")).toBeNull();
  await click(byTestId("payday-latest"));
  expect(api.get).toHaveBeenLastCalledWith("/admin/payroll/payday");
});
