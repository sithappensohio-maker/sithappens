/**
 * The same-day sibling discount is taken off a dog's total exactly once.
 *
 * The group preview (checkout-group-preview) already takes the discount off a
 * second same-day dog's total (checkout_preview_total). The modal used to
 * build its base from that discounted figure and then take the discount off
 * again through the discount-preview line, so the second dog checked out at
 * half off twice. Mounted (same harness as checkoutModalRenders.test.js).
 * Server side: backend/test_checkout_second_dog_discount_once.py.
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

// A daycare dog at $40 that is checked in today. Its same-day sibling discount
// is 50% of the $40 base, i.e. $20.
const DOG = {
  id: "bk-2", dog_id: "d-2", dog_name: "Milo", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-1", date: "2026-10-05",
  status: "checked_in", checked_in_at: "2026-10-05T13:00:00+00:00",
  estimated_price: 40, unit_price: 40,
};
const SERVICES = [
  { id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true },
];
const SIBLING_DISCOUNT = { mode: "percent", value: 50, label: "Additional dog discount" };

let container, root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

// The preview rows the server would return for this dog's household.
const setup = ({ previewRow, discountPreview }) => {
  api.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [previewRow] } });
    if (u.includes("discount-preview")) return Promise.resolve({ data: discountPreview });
    if (u.includes("money-modifier-preview")) {
      return Promise.resolve({ data: { sales_tax: { enabled: false, rate_pct: 0, applies: false } } });
    }
    return Promise.resolve({ data: {} });
  });
};

const mount = async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={DOG} services={SERVICES} onClose={() => {}} />);
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

test("a second dog whose first sibling already left pays the discount once", async () => {
  // The first dog checked out earlier today at full price, so this dog is the
  // extra one. The preview total is already $20 (the discount is in it).
  setup({
    previewRow: { ...DOG, checkout_preview_total: 20, checkout_preview_discount: 20 },
    discountPreview: {
      eligible: true, preview_base_price: 40,
      discount: { ...SIBLING_DISCOUNT, amount: 20 },
    },
  });
  await mount();
  expect(q("checkout-total").textContent).toBe("$20.00");
  expect(q("checkout-total").textContent).not.toBe("$10.00");
});

test("a dog the group preview already discounted, with no discount-preview line, keeps its discounted total", async () => {
  setup({
    previewRow: { ...DOG, checkout_preview_total: 20, checkout_preview_discount: 20 },
    discountPreview: { eligible: false, preview_base_price: 40, discount: null },
  });
  await mount();
  expect(q("checkout-total").textContent).toBe("$20.00");
});

test("a dog with no preview discount still takes the sibling discount from discount-preview", async () => {
  setup({
    previewRow: { ...DOG },
    discountPreview: {
      eligible: true, preview_base_price: 40,
      discount: { ...SIBLING_DISCOUNT, amount: 20 },
    },
  });
  await mount();
  expect(q("checkout-total").textContent).toBe("$20.00");
});
