/* Checking out a BOARDING dog still checked in after its last day: the
 * screen asks "stayed extra nights, or a missed check out?" before pricing
 * anything, pre-fills the nights for "Stayed", and sends the answer with the
 * checkout. Mounted (same harness as lateDayCheckout.test.js). Server side:
 * backend/test_late_stay_checkout.py.
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

const STAY = {
  id: "bk-9", dog_id: "d-9", dog_name: "Mick", client_id: "c-9", client_name: "Pat",
  service_type: "boarding", service_id: "svc-b", date: "2026-09-01", end_date: "2026-09-03",
  status: "approved", checked_in_at: "2026-09-01T14:00:00+00:00", estimated_price: 100, unit_price: 50,
  pricing_snapshot: { unit_price: 50 },
};
const QUESTION = {
  applies: true, code: "late_stay_checkout_resolution_required",
  message: "Mick was due to go home on Thu, Sep 3, 2026 and is still checked in. Did the dog stay 3 extra nights, or was this a missed check out?",
  nights: 3, original_end_date: "2026-09-03", booking_ids: ["bk-9"],
};

let container, root, stayState;
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (id) => { await act(async () => { q(id).click(); }); await flush(); };
const gets = () => api.get.mock.calls.map((c) => String(c[0]));
const checkoutBody = () => api.post.mock.calls.find((c) => String(c[0]).endsWith("/check-out"))[1];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  stayState = QUESTION;
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (String(url).endsWith("/late-stay-checkout")) return Promise.resolve({ data: stayState });
    return Promise.resolve({ data: {} });
  });
  api.post.mockReset();
  api.post.mockImplementation(() => Promise.resolve({ data: {} }));
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const mount = async (booking = STAY) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={booking} services={[]} onClose={() => {}} />);
  });
  await flush();
};

test("a late boarding checkout asks first and prices nothing until answered", async () => {
  await mount();
  expect(q("checkout-late-stay")).toBeTruthy();
  expect(q("checkout-late-stay-message").textContent).toMatch(/still checked in/);
  expect(q("checkout-late-stay-stayed").textContent).toMatch(/Stayed 3 extra nights/);
  expect(q("checkout-late-stay-missed").textContent).toMatch(/Missed check out/);
  expect(q("checkout-modal")).toBeNull();
  expect(gets().some((u) => u.includes("money-modifier-preview") || u.includes("discount-preview"))).toBe(false);
  expect(api.post).not.toHaveBeenCalled();
});

test("Stayed opens the checkout with the nights already added, and sends the answer", async () => {
  await mount();
  await click("checkout-late-stay-stayed");
  expect(q("checkout-modal")).toBeTruthy();
  expect(q("extra-nights-input").value).toBe("3");
  expect(q("checkout-late-stay-banner").textContent).toMatch(/3 extra nights added/);
  await click("confirm-checkout");
  expect(checkoutBody()).toMatchObject({ late_stay_resolution: "stayed", extra_nights: 3 });
});

test("Stayed lets staff correct the nights but never down to none", async () => {
  await mount();
  await click("checkout-late-stay-stayed");
  await click("extra-nights-minus");
  await click("extra-nights-minus");
  await click("extra-nights-minus");
  expect(q("extra-nights-input").value).toBe("1");
  await click("confirm-checkout");
  expect(checkoutBody()).toMatchObject({ late_stay_resolution: "stayed", extra_nights: 1 });
});

test("Missed check out hides the nights counter and sends no extra nights", async () => {
  await mount();
  await click("checkout-late-stay-missed");
  expect(q("checkout-modal")).toBeTruthy();
  expect(q("extra-nights-input")).toBeNull();
  expect(q("checkout-late-stay-banner").textContent).toMatch(/Missed check out/);
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body.late_stay_resolution).toBe("missed_checkout");
  expect(body.extra_nights).toBeUndefined();
});

test("Change answer goes back to the question", async () => {
  await mount();
  await click("checkout-late-stay-missed");
  await click("checkout-late-stay-change");
  expect(q("checkout-late-stay")).toBeTruthy();
  await click("checkout-late-stay-stayed");
  expect(q("checkout-late-stay")).toBeNull();
  expect(q("extra-nights-input").value).toBe("3");
  await click("confirm-checkout");
  expect(checkoutBody()).toMatchObject({ late_stay_resolution: "stayed", extra_nights: 3 });
});

test("changing the answer keeps the form that was already filled in", async () => {
  // The form used to be rebuilt from scratch, losing the cart, the tip and a
  // card already charged on the reader.
  await mount();
  await click("checkout-late-stay-stayed");
  const form = q("checkout-modal");
  await click("checkout-late-stay-change");
  expect(q("checkout-modal")).toBe(form);
  await click("checkout-late-stay-missed");
  expect(q("checkout-modal")).toBe(form);
  expect(q("extra-nights-input")).toBeNull();
  await click("confirm-checkout");
  expect(checkoutBody().extra_nights).toBeUndefined();
});

test("the banner follows the number of nights staff correct it to", async () => {
  await mount();
  await click("checkout-late-stay-stayed");
  await click("extra-nights-minus");
  expect(q("checkout-late-stay-banner").textContent).toMatch(/2 extra nights added/);
});

test("the nights box can be cleared and retyped, and never stays empty", async () => {
  await mount();
  await click("checkout-late-stay-stayed");
  const input = q("extra-nights-input");
  const type = async (v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => { set.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  await type("");
  expect(input.value).toBe("");
  await type("2");
  expect(input.value).toBe("2");
  await type("");
  await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  expect(input.value).toBe("1");
});

test("a friends & family dog is not promised boarding credits", async () => {
  await mount({ ...STAY, bill_to_client_id: "c-payer", group_id: "g-1" });
  expect(q("checkout-late-stay-stayed").textContent).toMatch(/paying family's bill/);
  expect(q("checkout-late-stay-stayed").textContent).not.toMatch(/credits are used first/);
});

test("a stay that ends today or later opens straight away with no extra request", async () => {
  await mount({ ...STAY, date: "2999-01-01", end_date: "2999-01-03" });
  expect(q("checkout-modal")).toBeTruthy();
  expect(gets().some((u) => u.endsWith("/late-stay-checkout"))).toBe(false);
  expect(q("extra-nights-input").value).toBe("0");
  expect(q("checkout-late-stay-banner")).toBeNull();
});

test("when the server says it doesn't apply, the checkout opens as before", async () => {
  stayState = { applies: false };
  await mount();
  expect(q("checkout-modal")).toBeTruthy();
  expect(q("extra-nights-input").value).toBe("0");
  await click("confirm-checkout");
  expect(checkoutBody().late_stay_resolution).toBeUndefined();
});

test("if the check fails, the server's refusal brings the question back instead of an error", async () => {
  api.get.mockImplementation((url) => (String(url).endsWith("/late-stay-checkout")
    ? Promise.reject(new Error("network")) : Promise.resolve({ data: {} })));
  await mount();
  expect(q("checkout-modal")).toBeTruthy();
  api.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: QUESTION.message, detail_object: QUESTION } } });
  await click("confirm-checkout");
  expect(q("checkout-late-stay")).toBeTruthy();
  expect(q("checkout-late-stay-stayed").textContent).toMatch(/Stayed 3 extra nights/);
  expect(q("checkout-error")).toBeNull();
});

test("a daycare visit converted to a stay is not asked the boarding question", async () => {
  await mount({ ...STAY, late_day_resolution: "stayed_overnight" });
  expect(gets().some((u) => u.endsWith("/late-stay-checkout"))).toBe(false);
});
