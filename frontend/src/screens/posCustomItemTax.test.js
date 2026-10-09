/**
 * A custom POS line must say what it is before it's taxed either way — the
 * register never assumes merchandise (taxable) or service (not) on its own.
 * Add to Cart stays off until staff pick one. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Pos from "./Pos";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, usePromptDialog: () => async () => null, ConfirmProvider: ({ children }) => children }));
jest.mock("../lib/posAgent", () => ({ checkPosHealth: jest.fn(), printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("../components/PageHero", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/PendingActionsPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/CheckoutModal", () => ({ CheckoutModal: () => null }));
jest.mock("../components/TakePaymentModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/StripeRefundModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/ItemThumbnail", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/AdminBookingModal", () => ({ __esModule: true, default: () => null }));
jest.mock("./Staff", () => ({ RegisterTab: () => null }));

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");
const posAgent = require("../lib/posAgent");
global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  useAuth.mockReturnValue({ can: () => true });
  posAgent.checkPosHealth.mockImplementation(() => Promise.resolve({ ready: false }));
  if (!window.crypto?.randomUUID) window.crypto = { ...(window.crypto || {}), randomUUID: () => "test-uuid" };
  api.get.mockReset();
  api.get.mockImplementation((path) => {
    const byPath = {
      "/admin/register/status": { date: "2026-08-16", status: "OPEN", opened_at: "2026-08-16T08:00:00Z", opened_by: "Owner" },
      "/admin/register/day": { totals: { expected_cash: 125, net_incoming_total: 25, opening_cash: 100 }, activity: [], register_closed: false, method_labels: {} },
      "/employee/roster-today": { roster: [] }, "/pos/catalog": { items: [] }, "/clients": [], "/services": [], "/pos/sales": [],
      "/admin/shop-orders": { orders: [] }, "/admin/shop-orders/unseen-count": { unseen: 0 },
      "/admin/stripe-online-payments": { payments: [] },
    };
    return Promise.resolve({ data: byPath[path] ?? {} });
  });
  api.post.mockReset();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
  jest.useRealTimers();
});

const customItemButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Custom Item"));
const addToCartButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === "Add to Cart");

async function openCustomForm() {
  await act(async () => { root = createRoot(container); root.render(<Pos />); });
  await act(async () => { jest.advanceTimersByTime(300); });
  await act(async () => { customItemButton().click(); });
  const desc = container.querySelector('input[placeholder="Description"]');
  const amount = container.querySelector('input[placeholder="Amount"]');
  const reason = container.querySelector('input[placeholder="Reason (required)"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setValue.call(desc, "Nail Trim");
    desc.dispatchEvent(new Event("input", { bubbles: true }));
    setValue.call(amount, "15");
    amount.dispatchEvent(new Event("input", { bubbles: true }));
    setValue.call(reason, "Walk-in nail trim");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("neither merchandise nor service is pre-selected, and Add to Cart is off until one is chosen", async () => {
  await openCustomForm();
  expect(container.querySelector('[data-testid="pos-custom-kind-merchandise"]').checked).toBe(false);
  expect(container.querySelector('[data-testid="pos-custom-kind-service"]').checked).toBe(false);
  expect(addToCartButton().disabled).toBe(true);
});

test("picking Service is what goes on the line — nothing is assumed", async () => {
  await openCustomForm();
  await act(async () => { container.querySelector('[data-testid="pos-custom-kind-service"]').click(); });
  expect(addToCartButton().disabled).toBe(false);
  await act(async () => { addToCartButton().click(); });
  expect(container.querySelector('[data-testid="pos-cart"]')?.textContent || container.textContent).toMatch(/Nail Trim/);
});
