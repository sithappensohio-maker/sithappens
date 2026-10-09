/**
 * The checkout screen actually renders.
 *
 * This exists because it did not. A `const` read a few lines above its own
 * declaration — legal to Babel, legal to Vite, invisible to every
 * source-pinned test in this folder — and the whole screen died on mount with
 * "Cannot access '$t' before initialization". Checking a dog out was
 * impossible until it was found by hand.
 *
 * So: mount the thing. A build that compiles is not a screen that works, and
 * this is the most money-critical modal in the app. The assertions here are
 * deliberately thin — the point is that mounting throws nothing, in the
 * states the front desk actually sees.
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
// Signed in as someone who may change prices (the one-time discount below needs it).
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-1", date: "2026-09-19",
  status: "checked_in", estimated_price: 40, unit_price: 40,
};
const SERVICES = [
  { id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true },
  { id: "svc-2", name: "Nail Trim", service_type: "grooming", base_price: 15, active: true, is_addon: true },
];
const PRODUCTS = {
  items: [
    { kind: "product", id: "p-1", name: "Bag of food", effective_price: 20, list_price: 20,
      in_stock: true, taxable: true, track_inventory: false },
    { kind: "product", id: "p-2", name: "Gift card", effective_price: 25, list_price: 25,
      in_stock: true, taxable: false, track_inventory: false },
    { kind: "credit_pack", id: "cp-1", name: "10 days", effective_price: 300, in_stock: true },
  ],
};

let container, root, previewRows;

const GIFT_CARD = { id: "gc-1", code_display: "ABCD-EFGH-JKMN", balance: 80.00,
                    initial_amount: 100.00, status: "active" };

const respond = (url) => {
  if (url.includes("/gift-cards/lookup/")) {
    return url.includes("SMALL")
      ? Promise.resolve({ data: { ...GIFT_CARD, balance: 5.00 } })
      : Promise.resolve({ data: GIFT_CARD });
  }
  if (url.includes("/pos/catalog")) return Promise.resolve({ data: PRODUCTS });
  if (url.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: previewRows || [BOOKING] } });
  if (url.includes("money-modifier-preview")) {
    return Promise.resolve({ data: { sales_tax: { enabled: true, rate_pct: 6.75, label: "Sales Tax", applies: false } } });
  }
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  previewRows = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const mount = async (props = {}) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={BOOKING} services={SERVICES} onClose={() => {}} {...props} />);
  });
};

test("it mounts without throwing", async () => {
  await mount();
  expect(container.querySelector('[data-testid="checkout-modal"]')).toBeTruthy();
  expect(container.textContent).toContain("Luna");
});

test("the merchandise section appears once the catalog has products", async () => {
  await mount();
  expect(container.querySelector('[data-testid="checkout-shop"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="checkout-shop-toggle"]')).toBeTruthy();
});

test("a Board & Train stay renders the same screen", async () => {
  // The crash was reported on Board & Train; nothing about that path is
  // special, but it is the one that was actually being used.
  await mount({ booking: { ...BOOKING, service_type: "training", dog_name: "Rex" } });
  expect(container.querySelector('[data-testid="checkout-modal"]')).toBeTruthy();
  expect(container.textContent).toContain("Rex");
});

test("it survives a catalog that fails to load", async () => {
  api.get.mockImplementation((url) =>
    String(url).includes("/pos/catalog") ? Promise.reject(new Error("nope")) : respond(String(url)));
  await mount();
  expect(container.querySelector('[data-testid="checkout-modal"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="checkout-shop"]')).toBeFalsy();
});

test("it renders with sales tax switched off", async () => {
  api.get.mockImplementation((url) =>
    String(url).includes("money-modifier-preview")
      ? Promise.resolve({ data: { sales_tax: { enabled: false, rate_pct: 0 } } })
      : respond(String(url)));
  await mount();
  expect(container.querySelector('[data-testid="checkout-modal"]')).toBeTruthy();
});

test("the total is a real number, not NaN", async () => {
  // A missing rate or a missing price must not turn the amount due into
  // "$NaN" on the one screen where the customer is handing money over.
  await mount();
  const total = container.querySelector('[data-testid="checkout-total"]');
  expect(total).toBeTruthy();
  expect(total.textContent).toMatch(/^\$\d+\.\d{2}$/);
});

test("the main form is organized as numbered steps with a live summary panel", async () => {
  // Restyle (Oct 2026): the conditional sections read as numbered steps, and
  // the running total lives in a summary panel bound to the SAME dueToday —
  // never a second, re-derived total.
  await mount();
  const step1 = container.querySelector('[data-testid="checkout-step-1"]');
  expect(step1).toBeTruthy();
  expect(step1.textContent).toBe("1");
  const panel = container.querySelector('[data-testid="checkout-summary-panel"]');
  expect(panel).toBeTruthy();
  const panelTotal = panel.querySelector('[data-testid="checkout-total"]');
  expect(panelTotal).toBeTruthy();
  expect(panelTotal.textContent).toBe(container.querySelector('[data-testid="checkout-total"]').textContent);
});

// ─────────────────────────────────────────────────────── the money path
// Mounting proves it does not crash. These prove it charges the right amount
// and asks the server for the right thing.

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
};
const posts = () => api.post.mock.calls.map(([path, body]) => ({ path, body }));
const checkoutBody = () =>
  (posts().find((p) => String(p.path).includes("/check-out")) || {}).body;

test("the merchandise shelf is folded away until it is opened", async () => {
  await mount();
  expect(q("checkout-shop-toggle")).toBeTruthy();
  expect(q("checkout-product-p-1")).toBeFalsy();
  await click("checkout-shop-toggle");
  expect(q("checkout-product-p-1")).toBeTruthy();
});

test("adding a product raises the amount due by price plus tax", async () => {
  await mount();
  const before = q("checkout-total").textContent;
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-1");          // $20.00 taxable @ 6.75%
  const after = q("checkout-total").textContent;
  expect(after).not.toBe(before);
  // the stay is untaxed, the goods are not: 20.00 + 1.35
  expect(q("checkout-shop-total").textContent).toContain("20.00");
  expect(q("checkout-shop-tax").textContent).toContain("1.35");
  expect(q("checkout-total-split").textContent).toMatch(/shop \$21\.35/);
});

test("an exempt product adds no tax", async () => {
  await mount();
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-2");          // gift card, taxable: false
  expect(q("checkout-shop-total").textContent).toContain("25.00");
  expect(q("checkout-shop-tax")).toBeFalsy();
  expect(q("checkout-total-split").textContent).toMatch(/shop \$25\.00/);
});

test("the goods travel as retail lines with an idempotency key, never as add-ons", async () => {
  await mount();
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-1");
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body).toBeTruthy();
  expect(body.retail_lines).toEqual([{ kind: "retail", product_id: "p-1", qty: 1 }]);
  expect(body.retail_idempotency_key).toBeTruthy();
  expect(body.payment_method).toBeTruthy();
  // a product must never be smuggled onto the booking as a service add-on
  expect(JSON.stringify(body.add_ons || [])).not.toContain("p-1");
});

test("a checkout with nothing bought sends no retail lines at all", async () => {
  await mount();
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body).toBeTruthy();
  expect(body.retail_lines).toBeUndefined();
  expect(body.retail_idempotency_key).toBeUndefined();
});

test("a refused checkout surfaces the reason instead of looking like it worked", async () => {
  api.post.mockRejectedValue({ response: { data: { detail: "Open the register before taking cash payments." } } });
  await mount();
  await click("confirm-checkout");
  expect(container.textContent).toContain("Open the register");
});

// ------------------------------------------------------ paying by gift card

const setSelect = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const typeIn = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("the code box only appears when paying by gift card", async () => {
  await mount();
  expect(q("checkout-gift-tender")).toBeFalsy();
  await setSelect("checkout-pay-method", "gift_card");
  expect(q("checkout-gift-tender")).toBeTruthy();
});

test("the balance is shown before the money is taken", async () => {
  await mount();
  await setSelect("checkout-pay-method", "gift_card");
  await typeIn("checkout-gift-code", "ABCD-EFGH-JKMN");
  await click("checkout-gift-lookup");
  expect(q("checkout-gift-balance").textContent).toContain("80.00");
});

test("a card that cannot cover the pickup says so plainly", async () => {
  await mount();
  await setSelect("checkout-pay-method", "gift_card");
  await typeIn("checkout-gift-code", "SMALL-CARD");
  await click("checkout-gift-lookup");
  expect(q("checkout-gift-balance").textContent).toMatch(/not enough/);
});

test("the code travels with the checkout", async () => {
  await mount();
  await setSelect("checkout-pay-method", "gift_card");
  await typeIn("checkout-gift-code", "ABCD-EFGH-JKMN");
  await click("checkout-gift-lookup");
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body.payment_method).toBe("gift_card");
  expect(body.gift_card_code).toBe("ABCD-EFGH-JKMN");
});

test("an unchecked card cannot be used to pay", async () => {
  await mount();
  await setSelect("checkout-pay-method", "gift_card");
  await typeIn("checkout-gift-code", "ABCD-EFGH-JKMN");
  await click("confirm-checkout");          // never pressed Check
  expect(checkoutBody()).toBeUndefined();
  expect(container.textContent).toMatch(/Check the gift card/);
});

// ------------------------- paying for goods when credits cover the visit (audit #24)

const CREDITED = { ...BOOKING, credit_value: 40, credits_deducted: 1, credit_service_type: "daycare" };

test("when credits cover the visit, the shop items are recorded the way they were paid", async () => {
  previewRows = [CREDITED];
  await mount({ booking: CREDITED });
  expect(q("checkout-pay-method")).toBeFalsy();                 // nothing to pay yet: nothing to ask
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-1");
  expect(q("checkout-pay-for-shop-note").textContent).toContain("Credits cover the visit");
  await setSelect("checkout-pay-method", "card");
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body.use_credits).toBe(true);
  expect(body.retail_lines).toEqual([{ kind: "retail", product_id: "p-1", qty: 1 }]);
  // the goods' tender travels on its own: never the tender of the stay
  expect(body.retail_payment_method).toBe("card");
  expect(body.payment_method).toBeUndefined();
});

test("a gift card can pay for the shop items when credits cover the visit", async () => {
  previewRows = [CREDITED];
  await mount({ booking: CREDITED });
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-1");
  await setSelect("checkout-pay-method", "gift_card");
  await typeIn("checkout-gift-code", "ABCD-EFGH-JKMN");
  await click("checkout-gift-lookup");
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body.retail_payment_method).toBe("gift_card");
  expect(body.payment_method).toBeUndefined();         // (so the stay can never be charged to the card)
  expect(body.gift_card_code).toBe("ABCD-EFGH-JKMN");
});

test("a stay that takes money still sends one tender for the stay and the goods", async () => {
  await mount();                                             // (no credits: the stay is paid today)
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-1");
  expect(q("checkout-pay-for-shop-note")).toBeFalsy();
  await setSelect("checkout-pay-method", "card");
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body.payment_method).toBe("card");
  expect(body.retail_payment_method).toBeUndefined();
});

test("taking the goods back off after choosing a gift card leaves nothing to pay and nothing to check", async () => {
  previewRows = [CREDITED];
  await mount({ booking: CREDITED });
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-1");
  await setSelect("checkout-pay-method", "gift_card");
  expect(q("checkout-gift-tender")).toBeTruthy();
  await click("checkout-product-minus-p-1");
  expect(q("checkout-pay-method")).toBeFalsy();
  expect(q("checkout-gift-tender")).toBeFalsy();
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body).toBeTruthy();
  expect(body.gift_card_code).toBeUndefined();
  expect(body.payment_method).toBeUndefined();
  expect(body.retail_payment_method).toBeUndefined();
});

test("a discount that leaves only the goods to pay never sends the goods' tender for the stay", async () => {
  // Credits cover the visit; the bath already on it ($15) is taken off with a
  // one-time discount, so only the food is paid today, by gift card.
  const withBath = { ...CREDITED, add_ons: [{ service_id: "svc-2", name: "Nail Trim", price: 15, qty: 1 }] };
  previewRows = [withBath];
  await mount({ booking: withBath });
  await typeIn("checkout-discount-amount", "15");
  await typeIn("checkout-discount-reason", "comp trim");
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-1");
  expect(q("checkout-pay-for-shop-note")).toBeTruthy();
  await setSelect("checkout-pay-method", "gift_card");
  await typeIn("checkout-gift-code", "ABCD-EFGH-JKMN");
  await click("checkout-gift-lookup");
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body.retail_payment_method).toBe("gift_card");
  expect(body.payment_method).toBeUndefined();
  expect(body.payment_status).toBeUndefined();
});

// ---------------------------------------- "Other" (Zelle, Cash App…) needs its note

test("paying by Other asks for a note, and a checkout without one is never sent", async () => {
  await mount();
  expect(q("checkout-other-note")).toBeFalsy();
  await setSelect("checkout-pay-method", "other");
  expect(q("checkout-other-note")).toBeTruthy();
  await click("confirm-checkout");
  expect(checkoutBody()).toBeUndefined();
  expect(container.textContent).toContain("A note is required when the payment method is Other.");
  await typeIn("checkout-other-note", "  Zelle  ");
  await click("confirm-checkout");
  expect(checkoutBody()).toMatchObject({ payment_method: "other", payment_notes: "Zelle" });
});

test("a note typed under Other is not sent once another way of paying is chosen", async () => {
  await mount();
  await setSelect("checkout-pay-method", "other");
  await typeIn("checkout-other-note", "Zelle");
  await setSelect("checkout-pay-method", "card");
  expect(q("checkout-other-note")).toBeFalsy();
  await click("confirm-checkout");
  expect(checkoutBody().payment_method).toBe("card");
  expect(checkoutBody().payment_notes).toBeUndefined();
});

test("shop items paid by Other when credits cover the visit carry the note", async () => {
  previewRows = [CREDITED];
  await mount({ booking: CREDITED });
  await click("checkout-shop-toggle");
  await click("checkout-product-add-p-1");
  await setSelect("checkout-pay-method", "other");
  await typeIn("checkout-other-note", "Cash App");
  await click("confirm-checkout");
  expect(checkoutBody()).toMatchObject({ retail_payment_method: "other", payment_notes: "Cash App" });
  expect(checkoutBody().payment_method).toBeUndefined();
});

test("no way of paying is sent when nothing is paid today", async () => {
  // Credits cover the visit and a discount takes off the add-on on it: the
  // picker is hidden, so whatever it last said (maybe Other, with no note
  // box) is never sent.
  const withTrim = { ...CREDITED, add_ons: [{ service_id: "svc-2", name: "Nail Trim", price: 15, qty: 1 }] };
  previewRows = [withTrim];
  await mount({ booking: withTrim });
  await setSelect("checkout-pay-method", "other");
  await typeIn("checkout-discount-amount", "15");
  await typeIn("checkout-discount-reason", "comp trim");
  expect(q("checkout-pay-method")).toBeFalsy();
  await click("confirm-checkout");
  const body = checkoutBody();
  expect(body.payment_method).toBeUndefined();
  expect(body.payment_notes).toBeUndefined();
});

