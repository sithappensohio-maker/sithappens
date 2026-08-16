/**
 * Step 3 — Front Desk register hub tests (spec tests A–J).
 *
 * The hub must answer "is the register open / what cash is expected / does
 * today still need closing" from the backend's AUTHORITATIVE summary, refresh
 * on the register bus after mutations, keep money invisible to non-finance
 * staff, and never turn a failed request into $0.00 / fake CLOSED.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import RegisterHub, { buildRegisterView, buildActivityRows } from "./RegisterHub";
import { emitRegisterChanged } from "../lib/registerBus";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
let statusData, summaryData;

const openStatus = { date: "2026-08-16", status: "OPEN", opened_at: "2026-08-16T08:00:00Z", opened_by: "Owner" };
const summaryWith = (expected, extra = {}) => ({
  totals: { expected_cash: expected, net_incoming_total: expected - 100, opening_cash: 100 },
  register_closed: false,
  activity: [],
  method_labels: { cash: "Cash", venmo: "Venmo", card: "Card", other: "Other" },
  ...extra,
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  statusData = { ...openStatus };
  summaryData = summaryWith(100);
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((path) => {
    if (path === "/admin/register/status") {
      return statusData instanceof Error ? Promise.reject(statusData) : Promise.resolve({ data: statusData });
    }
    if (path === "/admin/register/day") {
      return summaryData instanceof Error ? Promise.reject(summaryData) : Promise.resolve({ data: summaryData });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  useAuth.mockReturnValue({ can: () => true }); // finance by default; overridden per test
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

async function mount(props = {}) {
  root = createRoot(container);
  await act(async () => { root.render(<RegisterHub {...props} />); });
}

const expectedCashEl = () => container.querySelector('[data-testid="register-hub-expected-value"]');
const statusEl = () => container.querySelector('[data-testid="register-hub-status"]');
const closeBtn = () => container.querySelector('[data-testid="register-hub-close-btn"]');

// ── Test A — authorized expected cash ───────────────────────────────────────
test("A: finance user with open register displays the backend's expected cash", async () => {
  summaryData = summaryWith(143.72);
  await mount();
  expect(statusEl().textContent).toContain("Register open — not yet closed");
  expect(expectedCashEl().textContent).toBe("$143.72");
  // The number is the summary's value verbatim — no frontend recalculation.
  expect(api.get).toHaveBeenCalledWith("/admin/register/day");
});

// ── Test B — unauthorized totals ─────────────────────────────────────────────
test("B: non-finance cashier sees operational status but no financial totals", async () => {
  useAuth.mockReturnValue({ can: (k) => k !== "finance_reports" });
  await mount();
  expect(statusEl().textContent).toContain("Register open");
  // The finance summary is never even requested, let alone rendered.
  expect(api.get.mock.calls.map(([p]) => p)).not.toContain("/admin/register/day");
  expect(expectedCashEl()).toBeNull();
  expect(container.querySelector('[data-testid="register-hub-activity-toggle"]')).toBeNull();
  expect(closeBtn()).toBeNull();
});

// ── Test C — live cash sale refresh ─────────────────────────────────────────
test("C: $25 cash sale refreshes expected cash 100 → 125 via the bus, no reload", async () => {
  await mount();
  expect(expectedCashEl().textContent).toBe("$100.00");
  summaryData = summaryWith(125); // backend now says 125 after the sale
  await act(async () => { emitRegisterChanged(); });
  expect(expectedCashEl().textContent).toBe("$125.00");
});

// ── Test D — non-cash sale leaves expected cash alone ───────────────────────
test("D: a card sale refresh keeps expected cash unchanged", async () => {
  summaryData = summaryWith(125);
  await mount();
  expect(expectedCashEl().textContent).toBe("$125.00");
  // Card sale committed: backend expected cash is (correctly) unchanged.
  await act(async () => { emitRegisterChanged(); });
  expect(expectedCashEl().textContent).toBe("$125.00");
});

// ── Test E — split tender raises expected cash by exactly the cash part ─────
test("E: $40 cash / $60 card split refreshes 125 → 165 from the backend value", async () => {
  summaryData = summaryWith(125);
  await mount();
  summaryData = summaryWith(165);
  await act(async () => { emitRegisterChanged(); });
  expect(expectedCashEl().textContent).toBe("$165.00");
});

// ── Test F — void refresh returns to the pre-sale amount ────────────────────
test("F: voiding the split sale refreshes 165 → 125", async () => {
  summaryData = summaryWith(165);
  await mount();
  summaryData = summaryWith(125);
  await act(async () => { emitRegisterChanged(); });
  expect(expectedCashEl().textContent).toBe("$125.00");
});

// ── Test G — prominent closeout routing ─────────────────────────────────────
test("G: authorized user reaches the closeout workflow from the hub button", async () => {
  const onOpenCloseout = jest.fn();
  await mount({ onOpenCloseout });
  expect(closeBtn()).not.toBeNull();
  await act(async () => { closeBtn().click(); });
  expect(onOpenCloseout).toHaveBeenCalledTimes(1);
});

// ── Test H — no accidental close ────────────────────────────────────────────
test("H: the Close Register button performs ZERO mutations — routing only", async () => {
  await mount({ onOpenCloseout: () => {} });
  await act(async () => { closeBtn().click(); });
  expect(api.post).not.toHaveBeenCalled();
  // Status is untouched — the day is still open until the existing
  // count → review → confirm workflow is completed.
  expect(statusEl().textContent).toContain("not yet closed");
});

// ── Test I — closed state ───────────────────────────────────────────────────
test("I: after closeout the hub shows CLOSED and drops the close action", async () => {
  statusData = { date: "2026-08-16", status: "CLOSED" };
  summaryData = summaryWith(0, {
    register_closed: true,
    latest_closeout: { cash_counted: 143.72, created_at: "2026-08-16T21:00:00Z", created_by_name: "Owner" },
  });
  await mount();
  expect(statusEl().textContent).toContain("Register closed for today");
  expect(closeBtn()).toBeNull();
  expect(container.textContent).toContain("Counted $143.72");
});

// ── Test J — error states stay error states ─────────────────────────────────
test("J1: a failed status request shows unavailable + retry, never fake CLOSED", async () => {
  statusData = new Error("network down");
  await mount();
  expect(statusEl().textContent).toContain("Register status unavailable");
  expect(container.querySelector('[data-testid="register-hub-retry"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Register closed for today");
});

test("J2: a failed summary shows expected cash as Unavailable, never $0.00", async () => {
  summaryData = new Error("403 or 500");
  await mount();
  expect(statusEl().textContent).toContain("Register open");
  expect(expectedCashEl().textContent).toBe("Unavailable");
  expect(expectedCashEl().textContent).not.toContain("$0.00");
});

// ── View-model unit coverage (house pure-function style) ────────────────────
test("view model: loading state shows neither money nor close action", () => {
  const v = buildRegisterView({ status: null, summary: null, canFinance: true });
  expect(v.kind).toBe("loading");
  expect(v.expectedCashText).toBeNull();
  expect(v.showCloseButton).toBe(false);
});

test("view model: NOT_OPEN offers quick-open to finance users only", () => {
  const status = { status: "NOT_OPEN" };
  expect(buildRegisterView({ status, summary: null, canFinance: true }).showQuickOpen).toBe(true);
  expect(buildRegisterView({ status, summary: null, canFinance: false }).showQuickOpen).toBe(false);
});

test("activity rows use the backend's decomposed tender label and sort newest first", () => {
  const rows = buildActivityRows({
    method_labels: { cash: "Cash", other: "Other" },
    totals: { opening_cash: 100 },
    activity: [
      { id: "s1", label: "Register sale", amount: 100, payment_method: "other",
        payment_method_label: "Cash $40.00 + Venmo $60.00", created_at: "2026-08-16T10:00:00" },
      { id: "v1", label: "POS void", amount: -100, payment_method: "other",
        payment_method_label: "Void — Cash $40.00 + Venmo $60.00", created_at: "2026-08-16T11:00:00" },
    ],
    drawer_session: { opened_at: "2026-08-16T08:00:00", opened_by_name: "Owner" },
  });
  expect(rows.map((r) => r.id)).toEqual(["act-v1", "act-s1", "register-opened"]);
  // The split shows its REAL composition, not "Other $100".
  expect(rows[1].method).toBe("Cash $40.00 + Venmo $60.00");
  expect(rows[0].method).toContain("Void — Cash $40.00");
});
