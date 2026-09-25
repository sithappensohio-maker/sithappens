/* Checking out a daycare dog still checked in from an earlier day: the
 * screen asks "forgotten checkout or stayed the night?" before pricing
 * anything, and never picks an answer itself. Mounted (same harness as
 * checkoutModalRenders.test.js). Server side: backend/test_late_day_checkout.py.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
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

const LATE = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-1", date: "2026-09-01", end_date: "2026-09-01",
  status: "approved", checked_in_at: "2026-09-01T12:00:00+00:00", estimated_price: 40, unit_price: 40,
};
const CONVERTED = { ...LATE, service_type: "boarding", end_date: "2026-09-02", estimated_price: 60,
                    late_day_resolution: "stayed_overnight" };
const QUESTION = {
  applies: true, code: "late_day_checkout_resolution_required",
  message: "Luna was checked in for daycare on Tue, Sep 1, 2026 and never checked out.",
  nights: 1, stayed_overnight: { available: true, total: 60 },
};
const RESOLVED = { applies: false, resolved: "stayed_overnight", can_undo: true, record: { booking_date: "2026-09-01" } };

let container, root, lateState;
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (id) => { await act(async () => { q(id).click(); }); await flush(); };
const gets = () => api.get.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  lateState = QUESTION;
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (String(url).endsWith("/late-day-checkout")) return Promise.resolve({ data: lateState });
    return Promise.resolve({ data: {} });
  });
  api.post.mockReset();
  api.post.mockImplementation((url, body) => {
    if (String(url).endsWith("/late-day-checkout")) {
      lateState = body.resolution === "undo" ? QUESTION : RESOLVED;
      return Promise.resolve({ data: { booking: body.resolution === "undo" ? LATE : CONVERTED } });
    }
    return Promise.resolve({ data: {} });
  });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const mount = async (booking = LATE) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={booking} services={[]} onClose={() => {}} />);
  });
  await flush();
};

test("a late daycare checkout asks first and prices nothing until answered", async () => {
  await mount();
  expect(q("checkout-late-day")).toBeTruthy();
  expect(q("checkout-late-day-message").textContent).toMatch(/never checked out/);
  expect(q("checkout-late-day-stayed").textContent).toMatch(/1 night · \$60\.00/);
  expect(q("checkout-modal")).toBeNull();
  // No price preview has been requested yet.
  expect(gets().some((u) => u.includes("money-modifier-preview") || u.includes("discount-preview"))).toBe(false);
  expect(api.post).not.toHaveBeenCalled();
});

test("Stayed the night saves the answer, then the checkout opens as boarding with an Undo", async () => {
  await mount();
  await click("checkout-late-day-stayed");
  expect(api.post).toHaveBeenCalledWith("/bookings/bk-1/late-day-checkout", { resolution: "stayed_overnight" });
  expect(q("checkout-modal")).toBeTruthy();
  expect(q("checkout-modal").textContent).toMatch(/boarding/);
  expect(q("checkout-late-day-banner").textContent).toMatch(/Stayed the night/);
  await click("checkout-late-day-change");
  expect(api.post).toHaveBeenLastCalledWith("/bookings/bk-1/late-day-checkout", { resolution: "undo" });
  expect(q("checkout-late-day")).toBeTruthy();
});

test("Forgotten checkout is always available, even when the night can't be charged", async () => {
  lateState = { ...QUESTION, stayed_overnight: { available: false, reason: "There's no single Boarding service to price the night with." } };
  await mount();
  expect(q("checkout-late-day-stayed").disabled).toBe(true);
  expect(q("checkout-late-day-stayed-unavailable").textContent).toMatch(/Boarding service/);
  await click("checkout-late-day-forgotten");
  expect(api.post).toHaveBeenCalledWith("/bookings/bk-1/late-day-checkout", { resolution: "forgotten" });
});

test("a same-day checkout opens straight away with no extra request", async () => {
  await mount({ ...LATE, date: "2999-01-01", end_date: "2999-01-01" });
  expect(q("checkout-modal")).toBeTruthy();
  expect(gets().some((u) => u.endsWith("/late-day-checkout"))).toBe(false);
});

test("if the server refuses an unanswered checkout, the question comes back instead of an error", async () => {
  lateState = {};  // e.g. the check failed or the clocks disagreed
  await mount();
  expect(q("checkout-modal")).toBeTruthy();
  api.post.mockRejectedValueOnce({ response: { status: 409, data: {
    detail: QUESTION.message, detail_object: { code: "late_day_checkout_resolution_required" } } } });
  lateState = QUESTION;
  await click("confirm-checkout");
  expect(q("checkout-late-day")).toBeTruthy();
  expect(q("checkout-error")).toBeNull();
});

// ── review follow-ups ─────────────────────────────────────────────────────

test("a screen opened with a stale daycare row prices the booking the server returns", async () => {
  // Another screen already answered "Stayed the night"; this caller's list
  // still holds the daycare row.
  lateState = { ...RESOLVED, booking: CONVERTED };
  await mount(LATE);
  expect(q("checkout-modal").textContent).toMatch(/boarding/);
  expect(q("checkout-late-day-banner")).toBeTruthy();
});

test("a refused checkout shows its own question even when the check can't answer", async () => {
  lateState = {};
  await mount();
  const refusal = { code: "late_day_checkout_resolution_required", message: "Luna was checked in for daycare on Tue, Sep 1 and never checked out.",
                    booking_ids: ["bk-1"], nights: 1 };
  api.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: refusal.message, detail_object: refusal } } });
  await click("confirm-checkout");  // the check still says nothing — must not loop back to a fresh form
  expect(q("checkout-late-day")).toBeTruthy();
  expect(q("checkout-late-day-message").textContent).toMatch(/never checked out/);
});

test("Change answer is hidden while the checkout is being submitted", async () => {
  lateState = { ...RESOLVED, booking: CONVERTED };
  let release;
  await mount(CONVERTED);
  expect(q("checkout-late-day-change")).toBeTruthy();
  api.post.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  await click("confirm-checkout");
  expect(q("checkout-late-day-change")).toBeNull();
  await act(async () => { release({ data: {} }); });
});

test("paying the nights with boarding credits still shows the cash pickup-day fee as due", async () => {
  lateState = { ...RESOLVED, booking: { ...CONVERTED, credit_units_required: 1 }, late_pickup_cash: 40 };
  api.get.mockImplementation((url) => {
    const u = String(url);
    if (u.endsWith("/late-day-checkout")) return Promise.resolve({ data: lateState });
    if (u.endsWith("/clients/c-1")) return Promise.resolve({ data: { credits: 0, boarding_credits: 5, training_credits: 0, account_balance: 0 } });
    return Promise.resolve({ data: {} });
  });
  await mount(CONVERTED);
  // Credits cover the one night; the $40 pickup-day daycare fee is cash.
  expect(q("checkout-total").textContent).toBe("$40.00");
});

test("the question says when the price includes the late-pickup day", async () => {
  lateState = { ...QUESTION, stayed_overnight: { available: true, total: 100, rows: [{ booking_id: "bk-1", late_pickup_cash: 40 }] } };
  await mount();
  expect(q("checkout-late-day-pickup-fee").textContent).toMatch(/Includes \$40\.00/);
});

test("a converted stay doesn't offer extra nights (it already runs to today)", async () => {
  lateState = { ...RESOLVED, booking: CONVERTED };
  await mount(CONVERTED);
  expect(q("checkout-modal")).toBeTruthy();
  expect(q("extra-nights-input")).toBeNull();
});
