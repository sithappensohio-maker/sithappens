/**
 * Reopening a checkout (audit #14). Mounted, not source-pinned.
 *
 * - The reopen box asks whether the dog really left at the recorded time; a
 *   checkout done by mistake is priced from the next one instead.
 * - After a reopen, the extra nights the earlier checkout added are already
 *   in the stay's dates: the checkout screen says so, so nobody enters them
 *   a second time.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import FinancialCorrectionModal from "./FinancialCorrectionModal";
import { CheckoutModal } from "./CheckoutModal";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn() }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("../lib/posAgent", () => ({ printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("./ReceiptLogo", () => () => null);
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset();
  api.get.mockResolvedValue({ data: {} });
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });

const VISIT = {
  id: "bk-1", dog_name: "Luna", service_type: "daycare", actual_price: 40, amount_paid: 0,
  payment_method: "cash", checked_out_at: "2026-09-27T13:00:00Z",
};

async function reopen({ tick }) {
  await act(async () => { root.render(<FinancialCorrectionModal booking={VISIT} onClose={() => {}} onSaved={() => {}} />); });
  await flush();
  const reopenBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Reopen checkout"));
  await act(async () => { reopenBtn.click(); });
  expect(q("reopen-not-left")).toBeTruthy();
  if (tick) await act(async () => { q("reopen-not-left").click(); });
  const box = container.querySelector("textarea");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => { setter.call(box, "wrong dog checked out"); box.dispatchEvent(new Event("input", { bubbles: true })); });
  const save = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Reopen safely"));
  await act(async () => { save.click(); });
  await flush();
  const call = api.post.mock.calls.find(([path]) => String(path).includes("/reopen-checkout"));
  expect(call).toBeTruthy();
  return call[1];
}

test("a reopen keeps the real departure time by default", async () => {
  const body = await reopen({ tick: false });
  expect(body).toEqual({ reason: "wrong dog checked out", departure_stands: true });
});

test("a checkout done by mistake is marked so the next one prices from its own time", async () => {
  const body = await reopen({ tick: true });
  expect(body.departure_stands).toBe(false);
  expect(q("reopen-not-left-label").textContent).toContain("when you check the dog out again");
});

const STAY = {
  id: "bk-2", dog_id: "d-1", dog_name: "Moss", client_id: "c-1", client_name: "Dana",
  service_type: "boarding", service_id: "svc-b", date: "2026-09-23", end_date: "2026-09-27",
  status: "approved", estimated_price: 100, unit_price: 50, pricing_snapshot: { unit_price: 50 },
};
const SERVICES = [{ id: "svc-b", name: "Boarding", service_type: "boarding", base_price: 50, active: true, is_default: true }];

async function mountCheckout(booking) {
  await act(async () => { root.render(<CheckoutModal booking={booking} services={SERVICES} onClose={() => {}} />); });
  await flush();
}

test("the checkout screen says the extra nights from before are already in the stay", async () => {
  await mountCheckout({ ...STAY, extra_nights: { count: 2, charge: 100, in_stay: true, original_end_date: "2026-09-25" } });
  expect(q("checkout-modal")).toBeTruthy();
  const note = q("checkout-extra-nights-in-stay");
  expect(note).toBeTruthy();
  expect(note.textContent).toContain("2 extra nights");
  expect(note.textContent).toContain("2026-09-27");
  expect(q("checkout-extra-nights-panel").textContent).toContain("Stay ends: 2026-09-27");
});

test("an ordinary boarding checkout shows no such note", async () => {
  await mountCheckout(STAY);
  expect(q("checkout-modal")).toBeTruthy();
  expect(q("checkout-extra-nights-in-stay")).toBeFalsy();
  expect(q("checkout-extra-nights-panel").textContent).toContain("Original end: 2026-09-27");
});

test("the reopen box names the departure pricing really uses, not the redo", async () => {
  const kept = "2026-09-27T13:00:00Z";
  await act(async () => {
    root.render(<FinancialCorrectionModal booking={{ ...VISIT, checked_out_at: "2026-09-27T21:30:00Z", reopen_departure_at: kept }}
                                          onClose={() => {}} onSaved={() => {}} />);
  });
  await flush();
  const reopenBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Reopen checkout"));
  await act(async () => { reopenBtn.click(); });
  const shown = new Date(kept).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  expect(q("reopen-not-left-label").textContent).toContain(`(${shown})`);
});

// ── after the checkout: a bill still waiting for another reopened dog, and
// a second bill rebuilt by the same checkout ──
const DAYCARE = {
  id: "bk-3", dog_id: "d-3", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-d", date: "2026-09-27", status: "checked_in", estimated_price: 40, unit_price: 40,
};
const DAYCARE_SERVICES = [{ id: "svc-d", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true }];

async function checkOutWith(response) {
  api.post.mockImplementation((path) => Promise.resolve({ data: String(path).includes("/check-out") ? response : {} }));
  await act(async () => { root.render(<CheckoutModal booking={DAYCARE} services={DAYCARE_SERVICES} onClose={() => {}} />); });
  await flush();
  await act(async () => { q("confirm-checkout").click(); });
  await flush();
}

test("a bill still waiting for another reopened dog offers no receipt yet", async () => {
  await checkOutWith({ pos_invoice_id: "inv-1", pos_receipt_waiting: true });
  expect(q("checkout-hw-status")).toBeTruthy();
  expect(q("checkout-receipt-waiting")).toBeTruthy();
  expect(q("hw-reprint")).toBeFalsy();
  expect(q("checkout-view-receipt")).toBeFalsy();
  expect(q("checkout-email-receipt")).toBeFalsy();
});

test("an ordinary checkout still offers print, view and email", async () => {
  await checkOutWith({ pos_invoice_id: "inv-1" });
  expect(q("checkout-receipt-waiting")).toBeFalsy();
  expect(q("hw-reprint")).toBeTruthy();
  expect(q("checkout-view-receipt")).toBeTruthy();
  expect(q("checkout-email-receipt")).toBeTruthy();
  expect(q("checkout-extra-bill-0")).toBeFalsy();
});

test("a second bill rebuilt by the same checkout gets its own receipt buttons", async () => {
  await checkOutWith({ pos_invoice_id: "inv-1", pos_extra_invoice_ids: ["abcdef12-rest"], pos_extra_print_receipt_tokens: [] });
  expect(q("checkout-extra-bill-0").textContent).toContain("#ABCDEF12");
  api.get.mockClear();
  await act(async () => { q("checkout-extra-view-0").click(); });
  await flush();
  expect(api.get.mock.calls.map(([u]) => u)).toContain("/receipts/invoice/abcdef12-rest");
  await act(async () => { q("checkout-extra-email-0").click(); });
  await flush();
  expect(api.post.mock.calls.map(([u]) => u)).toContain("/receipts/invoice/abcdef12-rest/email");
});
