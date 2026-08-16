/**
 * Front Desk register-area navigation & layout tests.
 *
 * History: the register panels used to mount ~8,000px below the controls
 * (below Action Required + Today's Visits), so the top buttons looked dead.
 * The layout fix moves the ACTIVE register panel directly beneath the
 * register controls — one panel at a time — independent of how long the
 * unrelated lists below grow. These tests pin that DOM placement, the
 * one-active-panel switching, the unchanged role gating, and that the
 * Register Hub (expected cash + Close Register) survives the layout.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Pos from "./Pos";
import { NAV_ITEMS, navItemAllowed } from "../App";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, ConfirmProvider: ({ children }) => children }));
// NOTE: CRA jest runs with resetMocks:true, so implementations given here in
// the factory are wiped before every test — they're re-armed in beforeEach.
jest.mock("../lib/posAgent", () => ({
  checkPosHealth: jest.fn(),
  printReceipt: jest.fn(),
  openDrawer: jest.fn(),
}));
jest.mock("../components/PageHero", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/PendingActionsPanel", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: (props) => React.createElement("section", { "data-testid": props.testid || "pending-actions" }, "action required list"),
  };
});
jest.mock("../components/CheckoutModal", () => ({ CheckoutModal: () => null }));
jest.mock("../components/TakePaymentModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/StripeRefundModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/ItemThumbnail", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/AdminBookingModal", () => ({ __esModule: true, default: () => null }));
jest.mock("./Staff", () => {
  const React = require("react");
  return { RegisterTab: () => React.createElement("div", { "data-testid": "register-tab-mock" }, "register tools content") };
});

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");
const posAgent = require("../lib/posAgent");

global.IS_REACT_ACT_ENVIRONMENT = true;

const scrollSpy = jest.fn();
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = scrollSpy;
  // jsdom in this Jest version lacks crypto.randomUUID (Pos uses it for
  // idempotency keys) — and may lack the crypto global entirely.
  const uuid = () => `test-${Math.random().toString(36).slice(2)}`;
  const cryptoObj = (typeof window.crypto === "object" && window.crypto) || {};
  if (!cryptoObj.randomUUID) {
    try { cryptoObj.randomUUID = uuid; } catch { /* frozen impl */ }
  }
  try { Object.defineProperty(window, "crypto", { value: cryptoObj, configurable: true }); } catch { /* already fine */ }
  if (typeof global.crypto === "undefined") global.crypto = cryptoObj;
});

const FRONT_DESK_PERMS = ["take_payments", "sell_credits", "clients_view", "clients_edit", "dogs_view", "dogs_edit", "booking_edit", "messages"];
const asAdmin = () => useAuth.mockReturnValue({ can: () => true });
const asFrontDesk = () => useAuth.mockReturnValue({ can: (k) => FRONT_DESK_PERMS.includes(k) });

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  scrollSpy.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  posAgent.checkPosHealth.mockImplementation(() => Promise.resolve({ ready: false }));
  posAgent.printReceipt.mockImplementation(() => Promise.resolve({ ok: true }));
  posAgent.openDrawer.mockImplementation(() => Promise.resolve({ ok: true }));
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockImplementation(() => Promise.resolve({ data: {} }));
  api.get.mockImplementation((path) => {
    const byPath = {
      "/admin/register/status": { date: "2026-08-16", status: "OPEN", opened_at: "2026-08-16T08:00:00Z", opened_by: "Owner" },
      "/admin/register/day": { totals: { expected_cash: 125, net_incoming_total: 25, opening_cash: 100 }, activity: [], register_closed: false, method_labels: {} },
      "/employee/roster-today": { roster: [] },
      "/pos/catalog": { items: [] },
      "/clients": [],
      "/services": [],
      "/pos/sales": [],
      "/admin/shop-orders": { orders: [] },
      "/admin/shop-orders/unseen-count": { unseen: 0 },
      "/admin/stripe-online-payments": { payments: [] },
    };
    if (path in byPath) return Promise.resolve({ data: byPath[path] });
    return Promise.resolve({ data: {} });
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
  jest.useRealTimers();
});

async function mountPos() {
  root = createRoot(container);
  await act(async () => { root.render(<Pos />); });
}
const click = async (testid) => {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  expect(el).not.toBeNull();
  await act(async () => { el.click(); });
  await act(async () => { jest.advanceTimersByTime(200); });
};
const q = (testid) => container.querySelector(`[data-testid="${testid}"]`);
// True when a appears before b in document order.
const isBefore = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const pendingActions = () => q("frontdesk-pending-actions");

// 1 — hub renders before the register action controls
test("Register Hub renders above the register action controls", async () => {
  asAdmin();
  await mountPos();
  expect(isBefore(q("register-hub"), q("pos-register-tools-toggle"))).toBe(true);
});

// 2+3 — Recent Sales opens in the register section, before Action Required
test("Recent Sales opens directly in the register section, above Action Required", async () => {
  asAdmin();
  await mountPos();
  expect(q("pos-recent-sales-panel")).toBeNull();
  await click("pos-recent-sales-toggle");
  const panel = q("pos-recent-sales-panel");
  expect(panel).not.toBeNull();
  expect(panel.textContent).toContain("No sales yet today");
  expect(isBefore(q("pos-recent-sales-toggle"), panel)).toBe(true);
  expect(isBefore(panel, pendingActions())).toBe(true);
  // Any scroll from a plain toggle must be the minimal mobile "nearest"
  // nudge — never the old block:"start" page jump.
  for (const call of scrollSpy.mock.calls) {
    expect(call[0]?.block).toBe("nearest");
  }
});

// 4 — Register Tools opens in that area
test("Register Tools opens in the register section for admin", async () => {
  asAdmin();
  await mountPos();
  await click("pos-register-tools-toggle");
  expect(q("register-tab-mock")).not.toBeNull();
  expect(isBefore(q("register-tab-mock"), pendingActions())).toBe(true);
});

test("Register Tools opens for the front_desk role as well", async () => {
  asFrontDesk();
  await mountPos();
  await click("pos-register-tools-toggle");
  expect(q("register-tab-mock")).not.toBeNull();
  expect(isBefore(q("register-tab-mock"), pendingActions())).toBe(true);
});

// 5 — Online Orders opens in that area (front_desk has take_payments)
test("Online Orders opens in the register section for front_desk", async () => {
  asFrontDesk();
  await mountPos();
  await click("pos-online-orders-toggle");
  expect(q("pos-online-orders-panel")).not.toBeNull();
  expect(isBefore(q("pos-online-orders-panel"), pendingActions())).toBe(true);
});

// 6 — one active panel at a time; switching replaces it
test("switching register controls replaces the active panel instead of stacking", async () => {
  asAdmin();
  await mountPos();
  await click("pos-recent-sales-toggle");
  expect(q("pos-recent-sales-panel")).not.toBeNull();
  await click("pos-register-tools-toggle");
  expect(q("register-tab-mock")).not.toBeNull();
  expect(q("pos-recent-sales-panel")).toBeNull(); // replaced, not stacked
  await click("pos-online-orders-toggle");
  expect(q("pos-online-orders-panel")).not.toBeNull();
  expect(q("register-tab-mock")).toBeNull();
  // Clicking the active control again closes it → back to collapsed area.
  await click("pos-online-orders-toggle");
  expect(q("pos-online-orders-panel")).toBeNull();
  expect(q("pos-screen")).not.toBeNull();
});

// 7 — Action Required stays below the register section
test("Action Required renders below the whole register section", async () => {
  asAdmin();
  await mountPos();
  expect(isBefore(q("register-hub"), pendingActions())).toBe(true);
  expect(isBefore(q("pos-register-tools-toggle"), pendingActions())).toBe(true);
  await click("pos-open-drawer-toggle"); // even with a panel open
  expect(isBefore(q("pos-register-tools-toggle"), pendingActions())).toBe(true);
});

// 8 — front_desk subset unchanged: hidden, never dead
test("finance-only tools stay hidden for front_desk instead of rendering dead", async () => {
  asFrontDesk();
  await mountPos();
  expect(q("pos-open-drawer-toggle")).toBeNull();
  expect(q("pos-online-payments-toggle")).toBeNull();
  expect(q("pos-manage-products-toggle")).toBeNull();
  expect(q("pos-recent-sales-toggle")).not.toBeNull();
  expect(q("pos-register-tools-toggle")).not.toBeNull();
  expect(q("pos-online-orders-toggle")).not.toBeNull();
});

// 9 — admin set unchanged
test("admin keeps every register control", async () => {
  asAdmin();
  await mountPos();
  for (const id of ["pos-open-drawer-toggle", "pos-recent-sales-toggle", "pos-manage-products-toggle",
                    "pos-register-tools-toggle", "pos-online-payments-toggle", "pos-online-orders-toggle"]) {
    expect(q(id)).not.toBeNull();
  }
});

// Finance nav gating — unchanged (real nav registry + real gate rule)
test("Finance nav stays finance_reports-gated: allowed for finance, hidden for front_desk", () => {
  const finance = NAV_ITEMS.find((n) => n.label === "Finance");
  expect(finance).toBeTruthy();
  expect(finance.perm).toBe("finance_reports");
  expect(navItemAllowed(finance, () => true)).toBe(true);
  expect(navItemAllowed(finance, (k) => FRONT_DESK_PERMS.includes(k))).toBe(false);
  const pos = NAV_ITEMS.find((n) => n.id === "pos");
  expect(navItemAllowed(pos, (k) => FRONT_DESK_PERMS.includes(k))).toBe(true);
});

// 10 — expected cash + Close Register survive the layout move
test("expected cash and Close Register survive the layout move", async () => {
  asAdmin();
  await mountPos();
  expect(q("register-hub-expected-value").textContent).toBe("$125.00");
  await click("register-hub-close-btn");
  // Routes into the register section's tools panel — never a mutation.
  expect(q("register-tab-mock")).not.toBeNull();
  expect(isBefore(q("register-tab-mock"), pendingActions())).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
  // Hub still live after switching around.
  await click("pos-recent-sales-toggle");
  expect(q("register-hub-expected-value").textContent).toBe("$125.00");
});
