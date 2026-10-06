/**
 * A credit-paying boarding dog that leaves early is shown, and charged, the credits for
 * the nights it stayed, not the booked span.
 *
 * The screen takes the server's early quote (credit_units = the nights stayed). With
 * the early price in use and the client paying from credits, the credit line and the
 * request both use those units, and "Full booked stay" puts the booked credits back.
 * Mounted (same harness as checkoutEarlySurcharge.test.js). Server side:
 * backend/test_early_credit_checkout.py.
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
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

// Five nights booked; the dog leaves after two.
const STAY = {
  id: "bk-b", dog_id: "d-b", dog_name: "Moss", client_id: "c-b", client_name: "Dana",
  service_type: "boarding", service_id: "svc-b", date: "2030-06-08", end_date: "2030-06-13",
  status: "checked_in", checked_in_at: "2030-06-08T13:00:00+00:00",
  estimated_price: 250, unit_price: 50,
};
const SERVICES = [
  { id: "svc-b", name: "Boarding", service_type: "boarding", base_price: 50, active: true, is_default: true },
];
const EARLY_QUOTE = {
  applicable: true, actual_end_date: "2030-06-10", original_end_date: "2030-06-13",
  units: 2, unit_price: 50, late_pickup_daycare_fee: 0, late_pickup_cash: 0, credit_units: 2,
  base_price: 100, pickup_time_used: "10:00", pickup_cutoff_time: "11:00",
};

let container, root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
};
const posts = () => api.post.mock.calls.map(([path, body]) => ({ path, body }));
const checkoutBody = () => (posts().find((p) => String(p.path).includes("/check-out")) || {}).body;

// The client has `balance` boarding credits.
const respondWith = (balance) => (url) => {
  const u = String(url);
  if (u.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [STAY] } });
  if (u.includes("early-checkout-quote")) return Promise.resolve({ data: EARLY_QUOTE });
  if (u.includes("credit-lots")) return Promise.resolve({ data: [] });
  if (u.includes("/clients/")) return Promise.resolve({ data: { credits: 0, boarding_credits: balance, account_balance: 0 } });
  if (u.includes("money-modifier-preview")) return Promise.resolve({ data: {} });
  if (u.includes("discount-preview")) return Promise.resolve({ data: { eligible: false, preview_base_price: 250, discount: null } });
  if (u.includes("/pos/catalog")) return Promise.resolve({ data: { items: [] } });
  return Promise.resolve({ data: {} });
};

const mountWithCredits = async (balance) => {
  api.get.mockImplementation((url) => respondWith(balance)(url));
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={STAY} services={SERVICES} onClose={() => {}} />);
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

test("a credit-paying dog leaving early is charged the credits for the two nights stayed", async () => {
  await mountWithCredits(5);
  expect(container.textContent).toContain("Deduct 2 boarding credits now");
  expect(container.textContent).not.toContain("Deduct 5 boarding credits now");
});

test("the early panel shows the nights stayed in credits, not the booked five", async () => {
  await mountWithCredits(5);
  const panel = q("checkout-early-panel");
  expect(panel).toBeTruthy();
  expect(panel.textContent).toContain("nights stayed");
  expect(panel.textContent).toContain("2 credits");
});

test("the early credit checkout asks the server to take the nights stayed", async () => {
  await mountWithCredits(5);
  await click("confirm-checkout");
  await flush();
  expect(checkoutBody()).toBeTruthy();
  expect(checkoutBody().use_credits).toBe(true);
  expect(checkoutBody().early_checkout_credit).toBe(true);
});

test("a full booked stay on credits still takes the five booked credits", async () => {
  await mountWithCredits(5);
  await click("early-use-full");
  await flush();
  expect(container.textContent).toContain("Deduct 5 boarding credits now");
  await click("confirm-checkout");
  await flush();
  expect(checkoutBody().early_checkout_credit).toBeFalsy();
});

test("a client short of credits sees the shortfall for the nights stayed only", async () => {
  await mountWithCredits(1);
  // Two nights needed, one credit on the account: one credit taken, one night in cash.
  expect(container.textContent).toContain("Use partial 1 boarding credit now");
  expect(container.textContent).toContain("1 credit shortfall will be charged");
});
