/**
 * Checking a dog out with the Stripe Terminal card reader (owner,
 * 2026-10-18: "checking out a dog doesnt offer our card reader").
 *
 * Mounted — source-pinned text tests cannot execute the charge-and-poll
 * state machine this adds, and that state machine (not the markup around
 * it) is where a real bug would hide. Mirrors posMoneyPath.test.js's own
 * Stripe Terminal coverage for the Register, with the twist this screen
 * needs and the Register doesn't: a checkout can owe money for the stay
 * AND for merchandise bought at pickup in the same request, and those are
 * two separate real charges (server backing: backend/test_checkout_card_
 * reader.py).
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
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));

const { api } = require("../lib/api");
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const cryptoObj = (typeof window.crypto === "object" && window.crypto) || {};
  if (!cryptoObj.randomUUID) {
    try { cryptoObj.randomUUID = () => `test-${Math.random().toString(36).slice(2)}`; } catch { /* frozen */ }
  }
  try { Object.defineProperty(window, "crypto", { value: cryptoObj, configurable: true }); } catch { /* fine */ }
  if (typeof global.crypto === "undefined") global.crypto = cryptoObj;
});

// A plain $40 daycare pickup, no credits — the simplest case that still
// owes real money, so the reader option actually has something to charge.
const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-1", date: "2026-09-19",
  status: "checked_in", estimated_price: 40, unit_price: 40,
};
const SERVICES = [
  { id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true },
];
const LEASH = { kind: "product", id: "p-leash", name: "Leash", effective_price: 20.00, list_price: 20.00,
                in_stock: true, taxable: true, track_inventory: false };

let container, root, posted;

const GET = (extraProducts = []) => (url) => {
  const u = String(url);
  if (u.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [BOOKING] } });
  if (u.includes("/pos/catalog")) return Promise.resolve({ data: { items: [LEASH, ...extraProducts] } });
  // Sales tax disabled — this file is about the card-reader flow, not tax math.
  if (u.includes("money-modifier-preview")) return Promise.resolve({ data: { sales_tax: { enabled: false, rate_pct: 0, applies: false } } });
  if (u.includes("discount-preview")) return Promise.resolve({ data: { eligible: false, preview_base_price: 40, discount: null } });
  if (u.includes("/clients/")) return Promise.resolve({ data: { credits: 0, account_balance: 0 } });
  return Promise.resolve({ data: {} });
};

const mockTerminal = (piId = "pi_test123") => {
  api.post.mockImplementation((path, body) => {
    posted.push({ path, body });
    if (String(path) === "/pos/terminal/charges") return Promise.resolve({ data: { payment_intent_id: piId, status: "processing" } });
    if (String(path) === `/pos/terminal/charges/${piId}/cancel`) return Promise.resolve({ data: { ok: true } });
    if (String(path).includes("/check-out")) return Promise.resolve({ data: { ok: true, id: BOOKING.id } });
    return Promise.resolve({ data: {} });
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  posted = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation(GET());
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  toast.mockClear?.();
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  jest.useRealTimers();
});

const mount = async (bookingOverride) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={bookingOverride || BOOKING} services={SERVICES} onClose={() => {}} />);
  });
  await settle();
};
const settle = async () => { await act(async () => { jest.advanceTimersByTime(50); }); };
const pollTick = async () => { await act(async () => { jest.advanceTimersByTime(1600); }); await settle(); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
  await settle();
};
const setSelect = async (id, value) => {
  const el = q(id);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
};
const checkoutBody = () => (posted.find((p) => String(p.path).includes("/check-out")) || {}).body;

test("the reader is offered, charges the full amount, and gates Complete until it succeeds", async () => {
  mockTerminal();
  await mount();
  await setSelect("checkout-pay-method", "stripe_terminal");

  expect(q("checkout-terminal-charge-stay")).toBeTruthy();
  expect(q("checkout-terminal-charge-stay").textContent).toContain("40.00");
  expect(q("confirm-checkout").disabled).toBe(true);

  await click("checkout-terminal-charge-stay");
  expect(posted.some((p) => p.path === "/pos/terminal/charges" && p.body.amount === 40)).toBe(true);
  expect(q("checkout-terminal-status-stay")).toBeTruthy();
  expect(q("confirm-checkout").disabled).toBe(true); // still waiting on the reader

  await pollTick(); // the mocked /pos/terminal/charges/:id GET below resolves "succeeded"
  api.get.mockImplementation((url) =>
    String(url) === "/pos/terminal/charges/pi_test123"
      ? Promise.resolve({ data: { payment_intent_id: "pi_test123", status: "succeeded" } })
      : GET()(url));
  await pollTick();

  expect(q("checkout-terminal-status-stay").textContent).toContain("40.00");
  expect(q("confirm-checkout").disabled).toBe(false);

  await click("confirm-checkout");
  expect(checkoutBody().payment_method).toBe("stripe_terminal");
  expect(checkoutBody().payment_provider_ref).toBe("pi_test123");
});

test("canceling a waiting reader charge tells the backend and leaves Complete disabled", async () => {
  mockTerminal();
  await mount();
  await setSelect("checkout-pay-method", "stripe_terminal");
  await click("checkout-terminal-charge-stay");
  expect(q("checkout-terminal-status-stay")).toBeTruthy();

  await click("checkout-terminal-cancel-stay");
  expect(posted.some((p) => p.path === "/pos/terminal/charges/pi_test123/cancel")).toBe(true);
  expect(q("checkout-terminal-charge-stay")).toBeTruthy(); // back to the idle "Charge" button
  expect(q("confirm-checkout").disabled).toBe(true);
});

test("a declined card shows why and offers Try again", async () => {
  mockTerminal();
  await mount();
  api.get.mockImplementation((url) =>
    String(url) === "/pos/terminal/charges/pi_test123"
      ? Promise.resolve({ data: { payment_intent_id: "pi_test123", status: "requires_payment_method", last_payment_error: "Your card was declined." } })
      : GET()(url));
  await setSelect("checkout-pay-method", "stripe_terminal");
  await click("checkout-terminal-charge-stay");
  await pollTick();

  expect(q("checkout-terminal-status-stay").textContent).toContain("declined");
  expect(q("checkout-terminal-retry-stay")).toBeTruthy();
  expect(q("confirm-checkout").disabled).toBe(true);
});

test("stay AND merchandise together need two separate reader charges, each with its own PaymentIntent", async () => {
  api.post.mockImplementation((path, body) => {
    posted.push({ path, body });
    if (String(path) === "/pos/terminal/charges") {
      // A fresh PaymentIntent id per call — amount tells the two charges apart.
      const piId = body.amount === 40 ? "pi_stay" : "pi_goods";
      return Promise.resolve({ data: { payment_intent_id: piId, status: "processing" } });
    }
    if (String(path).includes("/check-out")) return Promise.resolve({ data: { ok: true } });
    return Promise.resolve({ data: {} });
  });
  await mount();
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-leash");
  await setSelect("checkout-pay-method", "stripe_terminal");

  expect(q("checkout-terminal-charge-stay").textContent).toContain("40.00");
  expect(q("checkout-terminal-charge-goods").textContent).toContain("20.00");

  await click("checkout-terminal-charge-stay");
  await click("checkout-terminal-charge-goods");
  expect(q("confirm-checkout").disabled).toBe(true); // neither has actually succeeded yet

  api.get.mockImplementation((url) => {
    const u = String(url);
    if (u === "/pos/terminal/charges/pi_stay") return Promise.resolve({ data: { payment_intent_id: "pi_stay", status: "succeeded" } });
    if (u === "/pos/terminal/charges/pi_goods") return Promise.resolve({ data: { payment_intent_id: "pi_goods", status: "succeeded" } });
    return GET()(u);
  });
  await pollTick();

  expect(q("confirm-checkout").disabled).toBe(false);
  await click("confirm-checkout");
  // Two distinct real charges, kept on two distinct fields — the stay never
  // claims the goods' PaymentIntent, or vice versa.
  expect(checkoutBody().payment_method).toBe("stripe_terminal");
  expect(checkoutBody().payment_provider_ref).toBe("pi_stay");
  expect(checkoutBody().retail_payment_method).toBe("stripe_terminal");
  expect(checkoutBody().retail_payment_provider_ref).toBe("pi_goods");
});

test("the reader is never offered while paying partial/on a tab, and choosing partial drops an in-progress charge", async () => {
  mockTerminal();
  await mount();
  await setSelect("checkout-pay-method", "stripe_terminal");
  await click("checkout-terminal-charge-stay");
  expect(q("checkout-terminal-status-stay")).toBeTruthy();

  await click("checkout-pay-mode-partial");
  // Switching to partial silently falls back off the reader — there's no
  // tender screen left to show, since payMethod was reset to "cash".
  expect(q("checkout-terminal-tender")).toBeFalsy();
  expect(q("checkout-pay-method").value).toBe("cash");
});
