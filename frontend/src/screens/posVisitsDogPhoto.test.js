/**
 * Front Desk's "Today's Visits" roster shows each dog's real photo once it's
 * actually on screen (not bundled into the bulk roster poll, which stays
 * lean since it's refetched every 45s — see loadRoster/useLiveRefresh in
 * Pos.jsx), falling back to the existing paw-and-initial tile when a dog
 * has no photo on file. Mounted, not source-pinned: a source pin can't tell
 * a real <img> from a broken one, or that the fallback tile still works.
 *
 * Rendered under StrictMode on purpose: a real bug (found live, not in this
 * suite) had the photo fetch's "don't setState after unmount" ref getting
 * stuck true forever after StrictMode's dev-only mount→cleanup→remount
 * dance, silently dropping every photo — every other render in this file
 * ran under a plain, non-StrictMode root and never caught it. StrictMode
 * here is what makes this suite able to catch that class of bug again.
 */
import { act, StrictMode } from "react";
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
const PHOTO = "data:image/png;base64,AAAA";
const ROSTER = [
  { booking_id: "bk-oreo", dog_id: "d-oreo", dog_name: "Oreo", breed: "Mixed", client_id: "c-1", client_name: "Chris",
    service_type: "boarding", date: TODAY, status: "approved", checked_in_at: `${TODAY}T12:00:00Z` },
  { booking_id: "bk-bert", dog_id: "d-bert", dog_name: "Bert", breed: "Elkhound", client_id: "c-2", client_name: "Andrew",
    service_type: "boarding", date: TODAY, status: "approved", checked_in_at: `${TODAY}T07:00:00Z` },
];
const GET = {
  "/admin/register/status": { date: TODAY, status: "OPEN" },
  "/admin/register/day": { totals: {}, activity: [], register_closed: false, method_labels: {} },
  "/employee/roster-today": { roster: ROSTER },
  "/pos/catalog": { items: [] }, "/clients": [], "/services": [], "/pos/sales": [],
  "/admin/shop-orders": { orders: [] }, "/admin/shop-orders/unseen-count": { unseen: 0 },
  "/admin/stripe-online-payments": { payments: [] },
  "/clients/options": [],
  "/dogs/d-oreo": { id: "d-oreo", name: "Oreo", photo: PHOTO },
  "/dogs/d-bert": { id: "d-bert", name: "Bert", photo: "" },
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
  await act(async () => { root.render(<StrictMode><Pos /></StrictMode>); });
  await settle();
  await settle();
  // Both fixture dogs are already checked in (on-site), not merely expected.
  await act(async () => { q("pos-visits-tab-on_site").click(); });
  await settle();
};

test("a dog with a real photo on file shows it in the Today's Visits roster", async () => {
  await mount();
  const row = q("pos-visit-row-bk-oreo");
  expect(row).toBeTruthy();
  const img = row.querySelector("img");
  expect(img).toBeTruthy();
  expect(img.getAttribute("src")).toBe(PHOTO);
});

test("a dog with no photo on file keeps the paw-and-initial fallback tile, never a broken image", async () => {
  await mount();
  const row = q("pos-visit-row-bk-bert");
  expect(row).toBeTruthy();
  expect(row.querySelector("img")).toBeNull();
  expect(row.querySelector(".fa-dog")).toBeTruthy();
  expect(row.textContent).toContain("Bert");
});
