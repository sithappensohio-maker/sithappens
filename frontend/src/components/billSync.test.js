/**
 * Audit #7 — bills and the account tab kept in step. Mounted, not
 * source-pinned: the Fix dialog, stuck online payments, the portal's Pay
 * Online rule, the correction dialog and the AR write-off target.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockCan = () => true;
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: (k) => mockCan(k) }) }));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : e ? JSON.stringify(e) : ""),
}));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("./ReceiptLogo", () => ({ __esModule: true, default: () => null, fetchReceiptLogoDataUrl: () => Promise.resolve(null) }));

const { api } = require("../lib/api");
const BillFixModal = require("./BillFixModal").default;
const StuckOnlinePayments = require("./StuckOnlinePayments").default;
const PortalInvoices = require("./PortalInvoices").default;
const FinancialCorrectionModal = require("./FinancialCorrectionModal").default;
const AccountsReceivable = require("../screens/AccountsReceivable").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

let container; let root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.post.mockReset(); api.put.mockReset(); api.delete.mockReset();
  mockCan = () => true;
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
};

const PREVIEW = {
  invoice: { id: "inv-1", balance: 60, total: 100, amount_paid: 40 }, invoice_number: "INV1",
  on_tab: true, tab_amount: 50, in_step: false, difference: 10, match_to: 50, can_match: true,
  unexplained: [{ id: "row-1", created_at: "2026-09-20T10:00:00+00:00", amount: -20, type: "payment", notes: "Tab payment" }],
  review_through: "2026-09-20T10:00:00+00:00", can_review: true, online_payment: null,
  refund_activity: false, visits_reopened: false,
};

test("the Fix dialog shows the difference and offers match, link and review", async () => {
  api.get.mockResolvedValue({ data: PREVIEW });
  api.post.mockResolvedValue({ data: { ...PREVIEW, in_step: true, difference: 0, unexplained: [], can_review: false } });
  act(() => root.render(<BillFixModal invoiceId="inv-1" onClose={() => {}} />)); await flush();
  expect(q("bill-fix-match").textContent).toContain("$50.00");
  await click(q("bill-fix-match-btn"));
  expect(api.post).toHaveBeenCalledWith("/invoices/inv-1/reconcile", { action: "match", expected_balance: 60 });
  expect(q("bill-fix-in-step")).not.toBeNull();
});

test("an earlier account entry can be linked to the bill, or the list marked reviewed", async () => {
  api.get.mockResolvedValue({ data: PREVIEW });
  api.post.mockResolvedValue({ data: PREVIEW });
  act(() => root.render(<BillFixModal invoiceId="inv-1" onClose={() => {}} />)); await flush();
  await click(q("bill-fix-attribute-row-1"));
  expect(api.post).toHaveBeenLastCalledWith("/invoices/inv-1/reconcile", { action: "attribute", row_id: "row-1" });
  await click(q("bill-fix-review-btn"));
  expect(api.post).toHaveBeenLastCalledWith("/invoices/inv-1/reconcile", { action: "review", through: PREVIEW.review_through });
});

test("staff without correction rights see the problem but no fix buttons", async () => {
  mockCan = (k) => k !== "delete_records";
  api.get.mockResolvedValue({ data: PREVIEW });
  act(() => root.render(<BillFixModal invoiceId="inv-1" onClose={() => {}} />)); await flush();
  expect(q("bill-fix-match")).not.toBeNull();
  expect(q("bill-fix-match-btn")).toBeNull();
  expect(q("bill-fix-attribute-row-1")).toBeNull();
});

const STUCK = { id: "att-1", invoice_id: "inv-1", amount: 60, client_name: "Dana", invoice_number: "INV1",
  reason: "Ready to record — press Retry.", reason_code: "ready", can_retry: true, can_refund: true };

test("a stuck online payment can be retried or refunded", async () => {
  api.get.mockResolvedValue({ data: { payments: [STUCK, { ...STUCK, id: "att-2", invoice_id: "inv-9" }] } });
  api.post.mockResolvedValue({ data: { ok: true } });
  act(() => root.render(<StuckOnlinePayments invoiceId="inv-1" />)); await flush();
  expect(q("stuck-payment-att-2")).toBeNull();
  await click(q("stuck-payment-retry-att-1"));
  expect(api.post).toHaveBeenCalledWith("/admin/online-payments/stuck/att-1/retry");
  await click(q("stuck-payment-refund-att-1"));
  expect(api.post).toHaveBeenCalledWith("/admin/online-payments/stuck/att-1/refund");
});

test("the portal hides Pay Online and says why when the bill can't take a payment", async () => {
  api.get.mockImplementation((url) => (url === "/portal/invoices" ? Promise.resolve({ data: {
    stripe_online_enabled: true,
    invoices: [
      { id: "i-ok", invoice_number: "OK", balance: 30, total: 30, amount_paid: 0, status: "OPEN", can_pay_online: true },
      { id: "i-no", invoice_number: "NO", balance: 60, total: 100, amount_paid: 40, status: "PARTIALLY_PAID",
        can_pay_online: false, pay_note: "We're updating this bill. Please contact us to pay it." },
      { id: "i-rx", invoice_number: "RX", balance: 60, total: 60, amount_paid: 0, status: "OPEN", can_pay_online: false,
        online_status: "received", pay_note: "We received your online payment and are finishing it up. You won't be charged again." },
    ] } }) : Promise.resolve({ data: {} })));
  act(() => root.render(<PortalInvoices />)); await flush();
  expect(q("portal-pay-online-i-ok")).not.toBeNull();
  expect(q("portal-pay-online-i-no")).toBeNull();
  expect(q("portal-pay-note-i-no").textContent).toContain("contact us");
  expect(q("portal-pay-note-i-rx").textContent).toContain("won't be charged again");
});

test("the correction dialog shows the bill's balance and sends one key per open", async () => {
  api.get.mockResolvedValue({ data: { id: "inv-1", balance: 12.5 } });
  api.post.mockResolvedValue({ data: {} });
  const booking = { id: "b-1", dog_name: "Pep", service_type: "daycare", actual_price: 100, amount_paid: 40, balance_due: 60 };
  act(() => root.render(<FinancialCorrectionModal booking={booking} onClose={() => {}} onSaved={() => {}} />)); await flush();
  expect(container.textContent).toContain("Due $12.50");
  const buttons = [...container.querySelectorAll("button")];
  await click(buttons.find((b) => b.textContent.includes("Discount")));
  expect(q("correction-owed-note").textContent).toContain("$12.50");
  await type(container.querySelector("input[type=number]"), "5");
  await type(container.querySelector("textarea"), "loyal customer");
  const save = [...container.querySelectorAll("button")].find((b) => /save|apply|record/i.test(b.textContent) && !b.disabled);
  await click(save);
  const body = api.post.mock.calls[0][1];
  expect(api.post.mock.calls[0][0]).toBe("/bookings/b-1/financial-adjustment");
  expect(body.idempotency_key).toBeTruthy();
});

test("an AR write-off names the bill it forgives", async () => {
  api.get.mockImplementation((url) => {
    if (url === "/admin/accounts-receivable") return Promise.resolve({ data: {
      clients: [{ id: "c-1", name: "Dana", account_balance: 60 }], count: 1, total_receivable: 60, total_credit_on_file: 0, net: 60 } });
    if (url === "/clients/c-1/open-invoices") return Promise.resolve({ data: { invoices: [{ id: "inv-1", invoice_number: "INV1", balance: 60 }] } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockResolvedValue({ data: { ok: true, balance: 35 } });
  act(() => root.render(<AccountsReceivable />)); await flush();
  await click(q("ar-adjust-c-1"));
  await type(q("ar-adj-amount"), "-25");
  expect(q("ar-adj-target").value).toBe("inv-1");
  await type(q("ar-adj-notes"), "goodwill");
  await click(q("ar-adj-submit"));
  const [url, body] = api.post.mock.calls[0];
  expect(url).toBe("/clients/c-1/adjustment");
  expect(body).toMatchObject({ amount: -25, notes: "goodwill", invoice_id: "inv-1" });
  expect(body.idempotency_key).toBeTruthy();
});


test("the write-off picker only offers bills on the tab, else the general balance", async () => {
  api.get.mockImplementation((url) => {
    if (url === "/admin/accounts-receivable") return Promise.resolve({ data: {
      clients: [{ id: "c-1", name: "Dana", account_balance: 50 }], count: 1, total_receivable: 50, total_credit_on_file: 0, net: 50 } });
    if (url === "/clients/c-1/open-invoices") return Promise.resolve({ data: { invoices: [{ id: "inv-off", invoice_number: "OFF", balance: 40, on_tab: false }] } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockResolvedValue({ data: { ok: true, balance: 0 } });
  act(() => root.render(<AccountsReceivable />)); await flush();
  await click(q("ar-adjust-c-1"));
  await type(q("ar-adj-amount"), "-50");
  expect(q("ar-adj-target")).toBeNull();
  await type(q("ar-adj-notes"), "old pack debt");
  await click(q("ar-adj-submit"));
  expect(api.post.mock.calls[0][1].invoice_id).toBeUndefined();
});

test("a disputed stuck payment offers Close, not Refund or Retry", async () => {
  api.get.mockResolvedValue({ data: { payments: [{ ...STUCK, reason_code: "disputed", can_retry: false, can_refund: false, can_close: true }] } });
  api.post.mockResolvedValue({ data: { ok: true } });
  act(() => root.render(<StuckOnlinePayments />)); await flush();
  expect(q("stuck-payment-retry-att-1")).toBeNull();
  expect(q("stuck-payment-refund-att-1")).toBeNull();
  await click(q("stuck-payment-close-att-1"));
  expect(api.post).toHaveBeenCalledWith("/admin/online-payments/stuck/att-1/close");
});

test("credit on file can be used on the bill from the Fix dialog", async () => {
  api.get.mockResolvedValue({ data: { ...PREVIEW, in_step: true, difference: 0, can_match: false, unexplained: [], can_review: false,
                                      credit_on_file: 50, can_apply_credit: true, invoice: { ...PREVIEW.invoice, balance: 100 } } });
  api.post.mockResolvedValue({ data: PREVIEW });
  act(() => root.render(<BillFixModal invoiceId="inv-1" onClose={() => {}} />)); await flush();
  expect(q("bill-fix-credit").textContent).toContain("$50.00");
  await click(q("bill-fix-credit-btn"));
  expect(api.post).toHaveBeenCalledWith("/invoices/inv-1/reconcile", { action: "apply_credit" });
});
