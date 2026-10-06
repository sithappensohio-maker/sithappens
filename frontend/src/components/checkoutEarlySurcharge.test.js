/**
 * An early boarding checkout shows the surcharge on the nights it stayed.
 *
 * A dog booked for five nights who leaves after two is charged the early
 * price ($100 for the two nights) and the peak surcharge on those two nights
 * ($50). The screen must show that same $150 total, not the surcharge worked
 * out on the five booked nights. Mounted (same harness as
 * checkoutModalRenders.test.js). Server side: backend/test_early_checkout_surcharge_nights.py.
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

const STAY = {
  id: "bk-b", dog_id: "d-b", dog_name: "Moss", client_id: "c-b", client_name: "Dana",
  service_type: "boarding", service_id: "svc-b", date: "2030-06-08", end_date: "2030-06-13",
  status: "checked_in", checked_in_at: "2030-06-08T13:00:00+00:00",
  estimated_price: 250, unit_price: 50,
};
const SERVICES = [
  { id: "svc-b", name: "Boarding", service_type: "boarding", base_price: 50, active: true, is_default: true },
];
// Two nights stayed at $50 each; the peak season (1.5x) covers both.
const EARLY_QUOTE = {
  applicable: true, actual_end_date: "2030-06-10", original_end_date: "2030-06-13",
  units: 2, unit_price: 50, late_pickup_daycare_fee: 0, base_price: 100,
  pickup_time_used: "10:00", pickup_cutoff_time: "11:00",
};
// The preview: the booked five nights, and the early breakdown for the two stayed.
const MODIFIERS = {
  base_before: 250, seasonal_multiplier: 1.5, seasonal_label: "Peak", seasonal_amount: 125,
  late_pickup_fee: 0, round_to_dollar: false, rounding_adjustment: 0, total_after: 375, modifier_total: 125,
  sales_tax: { enabled: false, rate_pct: 0, applies: false },
  early: {
    base_before: 100, seasonal_multiplier: 1.5, seasonal_label: "Peak", seasonal_amount: 50,
    late_pickup_fee: 0, round_to_dollar: false, rounding_adjustment: 0, total_after: 150, modifier_total: 50,
  },
};

let container, root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [STAY] } });
    if (u.includes("early-checkout-quote")) return Promise.resolve({ data: EARLY_QUOTE });
    if (u.includes("money-modifier-preview")) return Promise.resolve({ data: MODIFIERS });
    if (u.includes("discount-preview")) return Promise.resolve({ data: { eligible: false, preview_base_price: 250, discount: null } });
    if (u.includes("/pos/catalog")) return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

test("an early checkout at the early price shows the surcharge on the two nights stayed", async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={STAY} services={SERVICES} onClose={() => {}} />);
  });
  await flush();
  expect(q("checkout-total").textContent).toBe("$150.00");
  expect(q("checkout-money-modifiers").textContent).toContain("$50.00");
});

test("a household leaving early shows each leaving dog at its early price, not its booked stay", async () => {
  // Two dogs leave together two nights into a five-night stay. The anchor's early
  // price is $100; the other dog's early price is $100 too (booked: $250).
  const OTHER = { ...STAY, id: "bk-c", dog_id: "d-c", dog_name: "Pip", checkout_preview_total: 250, early_checkout_total: 100 };
  const single = api.get.getMockImplementation();
  api.get.mockImplementation((url) => (String(url).includes("checkout-group-preview")
    ? Promise.resolve({ data: { bookings: [STAY, OTHER] } })
    : single(url)));
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={STAY} services={SERVICES} onClose={() => {}} />);
  });
  await flush();
  expect(q("checkout-group-service-total").textContent).toContain("$200.00");
});
