/**
 * Front Desk top-navigation regression tests.
 *
 * The Step 3 layout left the toggled panels (Recent Sales, Register Tools,
 * Online Orders, …) mounted BELOW the Action Required panel and roster —
 * thousands of pixels down on a busy database — so the buttons looked dead.
 * These tests pin the fixed behavior: every visible top button must open its
 * panel AND scroll it into view; buttons the role can't use are hidden, not
 * dead; the Register Hub survives view switching; Finance nav gating is
 * asserted against the real nav registry.
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
jest.mock("../components/PendingActionsPanel", () => ({ __esModule: true, default: () => null }));
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

// jsdom has no scrollIntoView — the mock doubles as our "panel was revealed"
// assertion hook.
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
  await act(async () => { jest.advanceTimersByTime(200); }); // flush the reveal timeout
};
const q = (testid) => container.querySelector(`[data-testid="${testid}"]`);

// 1 — Recent Sales opens its view (and reveals it)
test("Recent Sales button opens the Recent Sales panel and scrolls to it", async () => {
  asAdmin();
  await mountPos();
  expect(q("pos-recent-sales-panel")).toBeNull();
  await click("pos-recent-sales-toggle");
  expect(q("pos-recent-sales-panel")).not.toBeNull();
  expect(q("pos-recent-sales-panel").textContent).toContain("No sales yet today");
  expect(scrollSpy).toHaveBeenCalled();
});

// 2 — Register Tools opens for Admin
test("Register Tools button shows Register Tools for admin", async () => {
  asAdmin();
  await mountPos();
  await click("pos-register-tools-toggle");
  expect(q("register-tab-mock")).not.toBeNull();
  expect(scrollSpy).toHaveBeenCalled();
});

// 3 — Front Desk Register Tools opens too (its allowed subset is covered by
// the real-RegisterTab test file alongside this one)
test("Register Tools opens for the front_desk role as well", async () => {
  asFrontDesk();
  await mountPos();
  await click("pos-register-tools-toggle");
  expect(q("register-tab-mock")).not.toBeNull();
});

// 4 — Online Orders reaches its view when permitted (front_desk has take_payments)
test("Online Orders button opens the orders panel for front_desk", async () => {
  asFrontDesk();
  await mountPos();
  await click("pos-online-orders-toggle");
  expect(q("pos-online-orders-panel")).not.toBeNull();
  expect(scrollSpy).toHaveBeenCalled();
});

// 5 — inaccessible controls are hidden, never dead
test("finance-only tools are hidden for front_desk instead of rendering dead", async () => {
  asFrontDesk();
  await mountPos();
  expect(q("pos-open-drawer-toggle")).toBeNull();
  expect(q("pos-online-payments-toggle")).toBeNull();
  expect(q("pos-manage-products-toggle")).toBeNull();
  // The three visible ones must all be functional (asserted in tests 1–4).
  expect(q("pos-recent-sales-toggle")).not.toBeNull();
  expect(q("pos-register-tools-toggle")).not.toBeNull();
  expect(q("pos-online-orders-toggle")).not.toBeNull();
});

// 6 — Admin Finance visibility preserved (real nav registry + real gate rule)
test("Finance nav item exists and is allowed for a finance_reports account", () => {
  const finance = NAV_ITEMS.find((n) => n.label === "Finance");
  expect(finance).toBeTruthy();
  expect(finance.perm).toBe("finance_reports");
  expect(navItemAllowed(finance, () => true)).toBe(true);
});

// 7 — Front Desk Finance restriction preserved
test("Finance nav item stays hidden for a role without finance_reports", () => {
  const finance = NAV_ITEMS.find((n) => n.label === "Finance");
  expect(navItemAllowed(finance, (k) => FRONT_DESK_PERMS.includes(k))).toBe(false);
  // …while Front Desk itself stays reachable for that same role.
  const pos = NAV_ITEMS.find((n) => n.id === "pos");
  expect(navItemAllowed(pos, (k) => FRONT_DESK_PERMS.includes(k))).toBe(true);
});

// 8 — Register Hub survives switching between the views
test("Register Hub keeps rendering expected cash after view switches", async () => {
  asAdmin();
  await mountPos();
  await click("pos-register-tools-toggle");
  await click("pos-recent-sales-toggle");
  await click("pos-online-orders-toggle");
  expect(q("register-hub")).not.toBeNull();
  expect(q("register-hub-expected-value").textContent).toBe("$125.00");
});

// 9 — returning to the main register view works
test("toggling a panel closed returns to the main register view", async () => {
  asAdmin();
  await mountPos();
  await click("pos-recent-sales-toggle");
  expect(q("pos-recent-sales-panel")).not.toBeNull();
  await click("pos-recent-sales-toggle");
  expect(q("pos-recent-sales-panel")).toBeNull();
  expect(q("pos-screen")).not.toBeNull();
  expect(q("register-hub")).not.toBeNull();
});
