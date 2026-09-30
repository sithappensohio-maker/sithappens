/**
 * Front Desk and friends & family bookings (owner request 2026-09-28).
 * Mounted, not source-pinned.
 *
 * Today's list says who pays for a friend's dog; picking the paying family
 * shows the friends' dogs it pays for alongside its own, to check in and out.
 */
import { act } from "react";
import { todayISO } from "../lib/date";
import { createRoot } from "react-dom/client";
import Pos from "./Pos";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, ConfirmProvider: ({ children }) => children }));
jest.mock("../lib/posAgent", () => ({ checkPosHealth: jest.fn(() => Promise.resolve({ ready: false })), printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("../components/PageHero", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/PendingActionsPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/CheckoutModal", () => ({ CheckoutModal: () => null }));
jest.mock("../components/TakePaymentModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/StripeRefundModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/ShopRefundModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/ItemThumbnail", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/AdminBookingModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../lib/printGiftCard", () => ({ printGiftCard: jest.fn(() => true) }));
jest.mock("./Staff", () => ({ RegisterTab: () => null }));

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = jest.fn(); });

const TODAY = todayISO();
const FF = { service_type: "daycare", date: TODAY, status: "approved", group_id: "g-1",
             bill_to_client_id: "c-pat", bill_to_client_name: "Pat", group_kind: "friends_family" };
const ROSTER = [
  { ...FF, booking_id: "bk-luna", dog_name: "Luna", client_id: "c-pat", client_name: "Pat" },
  { ...FF, booking_id: "bk-rex", dog_name: "Rex", client_id: "c-sam", client_name: "Sam" },
  { booking_id: "bk-bo", dog_name: "Bo", client_id: "c-kim", client_name: "Kim", service_type: "daycare", date: TODAY, status: "approved" },
];
const GET = {
  "/admin/register/status": { date: TODAY, status: "OPEN" },
  "/admin/register/day": { totals: {}, activity: [], register_closed: false, method_labels: {} },
  "/employee/roster-today": { roster: ROSTER },
  "/pos/catalog": { items: [] }, "/clients": [], "/services": [], "/pos/sales": [],
  "/admin/shop-orders": { orders: [] }, "/admin/shop-orders/unseen-count": { unseen: 0 },
  "/admin/stripe-online-payments": { payments: [] },
  "/clients/options": [{ id: "c-pat", name: "Pat", email: "pat@example.com" }],
};

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  useAuth.mockReturnValue({ can: () => true });
  api.get.mockReset();
  api.get.mockImplementation((path) => Promise.resolve({ data: path in GET ? GET[path] : {} }));
  api.post.mockReset(); api.post.mockResolvedValue({ data: {} });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
  jest.useRealTimers();
});

const settle = async () => { await act(async () => { jest.advanceTimersByTime(600); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const mount = async () => {
  root = createRoot(container);
  await act(async () => { root.render(<Pos />); });
  await settle();
};

test("today's list says who pays for a friend's dog", async () => {
  await mount();
  expect(q("pos-visit-paid-by-bk-rex").textContent).toContain("Paid by Pat");
  expect(q("pos-visit-paid-by-bk-luna")).toBeNull();
  expect(q("pos-visit-paid-by-bk-bo")).toBeNull();
});

test("picking the paying family shows the friends' dogs it pays for, named as someone else's", async () => {
  await mount();
  const search = q("pos-client-search");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(search, "Pat"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  await settle();
  const pat = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("pat@example.com"));
  await act(async () => { pat.click(); });
  await settle();
  expect(q("pos-client-checkin-bk-luna").textContent).toContain("Check In Luna (daycare)");
  expect(q("pos-client-checkin-bk-rex").textContent).toContain("Rex · Sam's dog");
  expect(q("pos-client-checkin-bk-bo")).toBeNull();
});
