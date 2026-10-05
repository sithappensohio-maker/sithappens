/**
 * The Online Payments panel can search every online payment, not only the newest
 * rows, so an older Shop order can be found and refunded (audit #32). Mounted.
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

const q = (testid) => container.querySelector(`[data-testid="${testid}"]`);

test("typing in the Online Payments search asks the server for matching payments, across all of them", async () => {
  await act(async () => { root = createRoot(container); root.render(<Pos />); });
  await act(async () => { q("pos-online-payments-toggle").click(); });
  await act(async () => { jest.advanceTimersByTime(300); });

  const input = q("pos-online-search");
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setValue.call(input, "zedold");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { jest.advanceTimersByTime(400); });

  const calls = api.get.mock.calls.filter(([path]) => path === "/admin/stripe-online-payments");
  expect(calls[calls.length - 1][1].params.q).toBe("zedold");
});
