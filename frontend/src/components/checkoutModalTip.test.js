/**
 * Tips, added on the spot at checkout (owner, 2026-10-18: "allow tips as
 * an add on on the spot").
 *
 * Mounted — same reasoning as checkoutModalRenders.test.js: a source-pinned
 * test cannot execute the preset-percentage math or prove the tip actually
 * reaches the checkout body. Server-side coverage: backend/
 * test_checkout_tips.py.
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
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-1", date: "2026-09-19",
  status: "checked_in", estimated_price: 40, unit_price: 40,
};
const SERVICES = [
  { id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true },
];

let container, root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
  await flush();
};
const posts = () => api.post.mock.calls.map(([path, body]) => ({ path, body }));
const checkoutBody = () => (posts().find((p) => String(p.path).includes("/check-out")) || {}).body;

const TIPPING_ON = { enabled: true, presets_pct: [15, 18, 20], allow_custom: true };

const respondWith = (tipping) => (url) => {
  const u = String(url);
  if (u.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [BOOKING] } });
  if (u.includes("money-modifier-preview")) {
    return Promise.resolve({ data: { sales_tax: { enabled: false }, tipping } });
  }
  if (u.includes("/pos/catalog")) return Promise.resolve({ data: { items: [] } });
  if (u.includes("discount-preview")) return Promise.resolve({ data: { eligible: false, preview_base_price: 40, discount: null } });
  return Promise.resolve({ data: {} });
};

const mountWith = async (tipping) => {
  api.get.mockImplementation((url) => respondWith(tipping)(url));
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={BOOKING} services={SERVICES} onClose={() => {}} />);
  });
  await flush();
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

test("the tip panel is hidden entirely when tipping is off", async () => {
  await mountWith({ enabled: false, presets_pct: [15, 18, 20], allow_custom: true });
  expect(q("checkout-tip-panel")).toBeFalsy();
});

test("preset buttons compute the right dollar amount off the stay price, and clicking one sets the total", async () => {
  await mountWith(TIPPING_ON);
  expect(q("checkout-tip-panel")).toBeTruthy();
  // $40 stay, no tax configured.
  expect(q("checkout-tip-preset-15").textContent).toContain("6.00");
  expect(q("checkout-tip-preset-18").textContent).toContain("7.20");
  expect(q("checkout-tip-preset-20").textContent).toContain("8.00");

  const before = Number(q("checkout-total").textContent.replace(/[^0-9.]/g, ""));
  await click("checkout-tip-preset-18");
  const after = Number(q("checkout-total").textContent.replace(/[^0-9.]/g, ""));
  expect(Math.round((after - before) * 100) / 100).toBe(7.2);
  expect(q("checkout-tip-included").textContent).toContain("7.20");
});

test("a custom tip amount is accepted and reaches the checkout body", async () => {
  await mountWith(TIPPING_ON);
  const input = q("checkout-tip-custom");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, "12.50");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
  expect(q("checkout-total").textContent).toContain("52.50"); // $40 stay + $12.50 tip

  await click("confirm-checkout");
  expect(checkoutBody().tip_amount).toBe(12.5);
});

test("no custom input when the owner has turned custom amounts off", async () => {
  await mountWith({ enabled: true, presets_pct: [15, 18, 20], allow_custom: false });
  expect(q("checkout-tip-custom")).toBeFalsy();
  expect(q("checkout-tip-preset-15")).toBeTruthy();
});

test("No tip clears a chosen preset back to nothing", async () => {
  await mountWith(TIPPING_ON);
  await click("checkout-tip-preset-20");
  expect(q("checkout-tip-clear")).toBeTruthy();
  await click("checkout-tip-clear");
  expect(q("checkout-tip-included")).toBeFalsy();
});

test("a tip with nothing chosen never reaches the checkout body", async () => {
  await mountWith(TIPPING_ON);
  await click("confirm-checkout");
  expect(checkoutBody().tip_amount).toBeUndefined();
});
