/* Finance → Bills: the list of recurring bills, marking one paid (which logs
 * an expense server-side), adding and editing a bill, and undoing the last
 * payment. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import BillsTab, { dueText, parseAmount } from "./BillsTab";
import { todayISO } from "../lib/date";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => e?.response?.data?.detail || String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
const mockConfirm = jest.fn(async () => true);
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => mockConfirm }));
const mockCan = jest.fn(() => true);
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: mockCan }) }));

const { api } = require("../lib/api");
const { toast } = require("sonner");
global.IS_REACT_ACT_ENVIRONMENT = true;

const RENT = { id: "b1", name: "Rent", payee: "Landlord LLC", amount: 1200, category: "Rent / facility", payment_method: "transfer",
  frequency: "monthly", next_due: "2026-11-01", days_until_due: 2, status: "due_soon", last_payment: null, can_undo: false };
const POWER = { id: "b2", name: "Electric", payee: "Ohio Edison", amount: 180, category: "Utilities", payment_method: "card",
  frequency: "monthly", next_due: "2026-10-28", days_until_due: -2, status: "overdue",
  last_payment: { id: "e9", date: "2026-09-28", amount: 172.5, bill_due_date: "2026-09-28" }, can_undo: true };

let container; let root; let bills;
beforeEach(() => {
  jest.clearAllMocks();
  mockCan.mockImplementation(() => true);
  bills = [POWER, RENT];
  api.get.mockImplementation(async (path) => (path === "/admin/bills"
    ? { data: { bills, due_soon_days: 3, due_next_30: 1200 } }
    : { data: { categories: ["Rent / facility", "Utilities", "Insurance"] } }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const setValue = async (el, value) => {
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  await act(async () => { el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
};
const changed = jest.fn();
const mount = async () => { await act(async () => { root.render(<BillsTab onExpensesChanged={changed} />); }); await flush(); };
const conflict = (detail) => ({ response: { status: 409, data: { detail } } });

test("each bill shows when it is due, and the list sums what is coming up", async () => {
  await mount();
  expect(byTestId("bill-status-b2").textContent).toBe("Overdue 2 days");
  expect(byTestId("bill-status-b1").textContent).toBe("Due in 2 days");
  expect(byTestId("bill-last-paid-b2").textContent).toContain("$172.50");
  expect(byTestId("bills-summary").textContent).toContain("1 overdue ($180.00)");
  expect(byTestId("bills-summary").textContent).toContain("$1,200.00 due in the next 30 days");
  expect(byTestId("bill-undo-b2")).not.toBeNull();
  expect(byTestId("bill-undo-b1")).toBeNull();
  expect(dueText({ days_until_due: 0 })).toBe("Due today");
  expect(dueText({ days_until_due: 1 })).toBe("Due tomorrow");
  expect(dueText({ days_until_due: -1 })).toBe("Overdue 1 day");
});

test("amounts accept commas and a dollar sign, and refuse anything else", () => {
  expect(parseAmount("1,215.50")).toBe(1215.5);
  expect(parseAmount("$1,200")).toBe(1200);
  expect(parseAmount(" 80 ")).toBe(80);
  expect(parseAmount(".5")).toBe(0.5);
  expect(parseAmount("1,234,567.89")).toBe(1234567.89);
  // A decimal comma or a stray comma is refused, never read as 100 times the amount.
  for (const bad of ["", "12o0", "1e3", "0x10", "-5", "1.234", "1.2.3", "89,99", "12,50", "1,2,3", "$$1,,2", "1 50", "1,2345"]) {
    expect(parseAmount(bad)).toBeNull();
  }
});

test("mark paid sends the due date it pays, the amount actually paid and today's date", async () => {
  api.post.mockResolvedValue({ data: { bill: { ...RENT, next_due: "2026-12-01" }, expense: { id: "e1" } } });
  await mount();
  await click(byTestId("bill-pay-b1"));
  expect(byTestId("bill-pay-amount").value).toBe("1200");
  await setValue(byTestId("bill-pay-amount"), "1,215.50");
  expect(byTestId("bill-pay-save").textContent).toBe("Log $1,215.50 payment");
  await click(byTestId("bill-pay-save"));

  expect(api.post).toHaveBeenCalledWith("/admin/bills/b1/pay", {
    due_date: "2026-11-01", amount: 1215.5, paid_date: todayISO(), payment_method: "transfer",
    from_cash_drawer: false, notes: "",
  });
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Logged $1,215.50 for Rent"));
  expect(byTestId("bill-pay-form")).toBeNull();
  expect(changed).toHaveBeenCalledTimes(1);   // Finance re-reads its expense list and totals
});

test("an amount that isn't a number says so and can't be logged", async () => {
  await mount();
  await click(byTestId("bill-pay-b1"));
  await setValue(byTestId("bill-pay-amount"), "12o0");
  expect(byTestId("bill-pay-save").disabled).toBe(true);
  expect(byTestId("bill-pay-save").textContent).toBe("Log payment");
  expect(byTestId("bill-pay-amount-hint")).not.toBeNull();
});

test("paying in cash can say it came out of the register drawer", async () => {
  api.post.mockResolvedValue({ data: { bill: RENT, expense: { id: "e1" } } });
  await mount();
  await click(byTestId("bill-pay-b1"));
  expect(byTestId("bill-pay-from-drawer")).toBeNull();   // only offered for cash
  await setValue(byTestId("bill-pay-method"), "cash");
  await click(byTestId("bill-pay-from-drawer"));
  await click(byTestId("bill-pay-save"));
  expect(api.post).toHaveBeenCalledWith("/admin/bills/b1/pay", expect.objectContaining({ payment_method: "cash", from_cash_drawer: true }));
});

test("a payment refused because the bill changed elsewhere reloads the list and closes the form", async () => {
  api.post.mockRejectedValue(conflict("Rent is no longer due 2026-11-01: it was already marked paid."));
  await mount();
  const loadsBefore = api.get.mock.calls.filter(([p]) => p === "/admin/bills").length;
  await click(byTestId("bill-pay-b1"));
  await click(byTestId("bill-pay-save"));
  expect(toast.error).toHaveBeenCalledWith("Rent is no longer due 2026-11-01: it was already marked paid.");
  expect(api.get.mock.calls.filter(([p]) => p === "/admin/bills").length).toBe(loadsBefore + 1);
  expect(byTestId("bill-pay-form")).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

test("a payment finishing doesn't close the form opened for another bill meanwhile", async () => {
  let finish;
  api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  await click(byTestId("bill-pay-b2"));
  await click(byTestId("bill-pay-save"));          // Electric's payment is in flight…
  await click(byTestId("bill-pay-b1"));            // …while the owner opens Rent's form
  await act(async () => { finish({ data: { bill: { ...POWER, next_due: "2026-11-28" }, expense: { id: "e2" } } }); });
  await flush();
  expect(byTestId("bill-pay-form")).not.toBeNull();
  expect(byTestId("bill-row-b1").contains(byTestId("bill-pay-form"))).toBe(true);
});

test("a closed register day keeps the form open and says why", async () => {
  api.post.mockRejectedValue({ response: { status: 400, data: { detail: "The register for 2026-10-30 is closed." } } });
  await mount();
  await click(byTestId("bill-pay-b1"));
  await click(byTestId("bill-pay-save"));
  expect(byTestId("bills-error").textContent).toContain("is closed");
  expect(byTestId("bill-pay-form")).not.toBeNull();
});

test("adding a bill posts what was typed", async () => {
  api.post.mockResolvedValue({ data: {} });
  await mount();
  await click(byTestId("bills-add"));
  await setValue(byTestId("bill-form-name"), "Insurance");
  await setValue(byTestId("bill-form-payee"), "Acme Mutual");
  await setValue(byTestId("bill-form-amount"), "$310");
  await setValue(byTestId("bill-form-frequency"), "quarterly");
  await setValue(byTestId("bill-form-next-due"), "2026-11-20");
  await setValue(byTestId("bill-form-category"), "Insurance");
  await click(byTestId("bill-form-save"));
  expect(api.post).toHaveBeenCalledWith("/admin/bills", {
    name: "Insurance", payee: "Acme Mutual", amount: 310, category: "Insurance", payment_method: "card",
    frequency: "quarterly", next_due: "2026-11-20", notes: "",
  });
  expect(byTestId("bill-form")).toBeNull();
});

test("an edit says which due date it opened with, so a stale form can't write it back", async () => {
  api.put.mockResolvedValue({ data: {} });
  await mount();
  await click(byTestId("bill-edit-b1"));
  await setValue(byTestId("bill-form-amount"), "1250");
  await click(byTestId("bill-form-save"));
  expect(api.put).toHaveBeenCalledWith("/admin/bills/b1", expect.objectContaining({ amount: 1250, next_due: "2026-11-01", expected_next_due: "2026-11-01" }));
});

test("undo asks first, names the payment it undoes, and closes that bill's open edit form", async () => {
  api.post.mockResolvedValue({ data: {} });
  await mount();
  await click(byTestId("bill-edit-b2"));
  expect(byTestId("bill-form")).not.toBeNull();
  await click(byTestId("bill-undo-b2"));
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: "Undo payment" }));
  expect(api.post).toHaveBeenCalledWith("/admin/bills/b2/undo-payment", { expense_id: "e9" });
  expect(byTestId("bill-form")).toBeNull();
  expect(changed).toHaveBeenCalledTimes(1);
});

test("staff who can't delete records don't get Undo or Delete", async () => {
  mockCan.mockImplementation((perm) => perm !== "delete_records");
  await mount();
  expect(byTestId("bill-undo-b2")).toBeNull();
  expect(byTestId("bill-delete-b2")).toBeNull();
  expect(byTestId("bill-pay-b2")).not.toBeNull();
});

test("no bills yet explains what to add", async () => {
  bills = [];
  await mount();
  expect(byTestId("bills-empty").textContent).toContain("rent, utilities, insurance");
});
