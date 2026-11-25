/**
 * Front Desk "Take Payment" on a dog that is here (owner request: an easy
 * way to take payment at drop-off, cash or card).
 *
 * The button asks the server which pack covers the visit, picks the client
 * and puts that pack in the register cart. The sale itself is the ordinary
 * register sale. Mounted, same harness as posVisitsDogPhoto.test.js.
 */
import { act } from "react";
import { todayISO } from "../lib/date";
import { createRoot } from "react-dom/client";
import Pos from "./Pos";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const mockConfirm = jest.fn(async () => true);
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => (...a) => mockConfirm(...a), ConfirmProvider: ({ children }) => children }));
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
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = jest.fn(); });

const TODAY = todayISO();
const ROSTER = [
  { booking_id: "bk-rex", dog_id: "d-rex", dog_name: "Rex", breed: "Lab", client_id: "c-1", client_name: "Chris",
    service_type: "daycare", date: TODAY, status: "approved", checked_in_at: `${TODAY}T12:00:00Z` },
  { booking_id: "bk-due", dog_id: "d-due", dog_name: "Juno", breed: "Poodle", client_id: "c-2", client_name: "Dana",
    service_type: "daycare", date: TODAY, status: "approved" },
];
const SINGLE = { kind: "credit_pack", id: "pk-1", name: "Single Day of Daycare", effective_price: 25, list_price: 25, has_price_override: false, qty: 1 };
const OFFER = {
  offer: true, reason: "", client_id: "c-1", client_name: "Chris", dogs: ["Rex"], credits_short: 2,
  packs: [{ id: "pk-1", name: "Single Day of Daycare", price: 25, qty: 1, quantity: 2, total: 50, covers: true, best_match: true }],
};

let offer, dueOffer, catalogCalls;
const DUE_OFFER = {
  offer: true, reason: "", client_id: "c-2", client_name: "Dana", dogs: ["Juno"], credits_short: 1,
  notes: ["A credit covers the whole day. A stay of 5 hours or less is only 50% of the day price when it is paid at pickup instead."],
  packs: [{ id: "pk-1", name: "Single Day of Daycare", price: 25, qty: 1, quantity: 1, total: 25, covers: true, best_match: true }],
};
const GET = () => ({
  "/admin/register/status": { date: TODAY, status: "OPEN" },
  "/admin/register/day": { totals: {}, activity: [], register_closed: false, method_labels: {} },
  "/employee/roster-today": { roster: ROSTER },
  "/clients": [], "/services": [], "/pos/sales": [],
  "/admin/shop-orders": { orders: [] }, "/admin/shop-orders/unseen-count": { unseen: 0 },
  "/admin/stripe-online-payments": { payments: [] }, "/clients/options": [],
  "/clients/c-1": { id: "c-1", name: "Chris", email: "chris@example.com" },
  "/bookings/bk-rex/dropoff-pay-options": offer,
  "/bookings/bk-due/dropoff-pay-options": dueOffer,
  "/clients/c-2": { id: "c-2", name: "Dana", email: "dana@example.com" },
});

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  offer = OFFER;
  dueOffer = DUE_OFFER;
  mockConfirm.mockReset(); mockConfirm.mockImplementation(async () => true);
  catalogCalls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  useAuth.mockReturnValue({ can: () => true });
  toast.success.mockReset(); toast.error.mockReset();
  api.get.mockReset();
  api.get.mockImplementation((path, opts) => {
    if (path === "/pos/catalog") { catalogCalls.push(opts?.params || {}); return Promise.resolve({ data: { items: [SINGLE] } }); }
    const table = GET();
    return Promise.resolve({ data: path in table ? table[path] : {} });
  });
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
const all = (id) => Array.from(container.querySelectorAll(`[data-testid="${id}"]`));
const click = async (id) => {
  if (!q(id)) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { q(id).click(); });
  await settle();
};
const mount = async (tab = "on_site") => {
  root = createRoot(container);
  await act(async () => { root.render(<Pos />); });
  await settle();
  await settle();
  await click(`pos-visits-tab-${tab}`);
};

test("Take Payment on a dog that is here puts the covering pack in the cart for that client", async () => {
  await mount();
  await click("pos-visit-pay-bk-rex");
  await settle();
  // The client's own prices were loaded, the client is on the sale, and the cart holds 2 single days.
  expect(catalogCalls).toContainEqual({ client_id: "c-1" });
  expect(q("pos-cart-client").textContent).toMatch(/Chris/);
  const lines = all("pos-cart-line");
  expect(lines).toHaveLength(1);
  expect(lines[0].textContent).toMatch(/Single Day of Daycare/);
  expect(toast.success.mock.calls.pop()[0]).toMatch(/2 × Single Day of Daycare is in the cart for Rex/);
  expect(q("pos-dropoff-notice").textContent).toMatch(/Drop-off payment · 2 × Single Day of Daycare for Rex/);
  // The register priced exactly that: two of the pack, for this client.
  const preview = api.post.mock.calls.filter(c => c[0] === "/pos/checkout/preview").pop();
  expect(preview[1]).toMatchObject({ client_id: "c-1", lines: [{ kind: "credit_pack", pack_id: "pk-1", qty: 2 }] });
  // Nothing was charged or sold by the button itself.
  expect(api.post.mock.calls.filter(c => ["/pos/checkout", "/pos/sales", "/pos/terminal/charges"].includes(c[0]))).toHaveLength(0);
});

test("pressing it twice still leaves the quantity that covers the visit, not double", async () => {
  await mount();
  await click("pos-visit-pay-bk-rex");
  await settle();
  await click("pos-visit-pay-bk-rex");
  await settle();
  expect(all("pos-cart-line")).toHaveLength(1);
  const preview = api.post.mock.calls.filter(c => c[0] === "/pos/checkout/preview").pop();
  expect(preview[1].lines).toEqual([{ kind: "credit_pack", pack_id: "pk-1", qty: 2 }]);
});

test("what the credits do not cover stays on screen by the cart, with no blanket promise", async () => {
  offer = { ...OFFER, dogs: ["Rex", "Pip"], still_due_at_pickup: 15,
            notes: ["Add-ons ($15.00) are still paid at pickup.", "A credit covers the whole day. A stay of 5 hours or less is only 50% of the day price when it is paid at pickup instead."] };
  await mount();
  await click("pos-visit-pay-bk-rex");
  await settle();
  const notice = q("pos-dropoff-notice").textContent;
  expect(notice).toMatch(/for Rex & Pip/);
  expect(notice).toMatch(/Add-ons \(\$15\.00\) are still paid at pickup/);
  expect(notice).toMatch(/5 hours or less/);
  expect(notice).not.toMatch(/nothing to collect/i);
  expect(toast.success.mock.calls.pop()[0]).not.toMatch(/nothing to collect/i);
});

test("a visit already covered by credits says so and adds nothing", async () => {
  offer = { offer: false, covered: true, packs: [], reason: "Rex's visit is already covered by credits on the account — nothing to collect now." };
  await mount();
  await click("pos-visit-pay-bk-rex");
  expect(all("pos-cart-line")).toHaveLength(0);
  expect(toast.success.mock.calls.pop()[0]).toMatch(/already covered by credits/);
});

test("a visit credits can't pay for says why and adds nothing", async () => {
  offer = { offer: false, packs: [], reason: "Grooming is paid in dollars at pickup, so there are no credits to sell for it." };
  await mount();
  await click("pos-visit-pay-bk-rex");
  expect(all("pos-cart-line")).toHaveLength(0);
  expect(toast.error.mock.calls.pop()[0]).toMatch(/paid in dollars at pickup/);
});

test("a dog that has not arrived yet has no Take Payment button", async () => {
  await mount("expected");
  expect(q("pos-visit-checkin-bk-due")).toBeTruthy();
  expect(q("pos-visit-pay-bk-due")).toBeNull();
});

describe("right after Check In, staff are asked whether to take payment", () => {
  test("Take payment loads the pack for the dog that just arrived", async () => {
    await mount("expected");
    await click("pos-visit-checkin-bk-due");
    await settle();
    expect(api.post.mock.calls.some(c => c[0] === "/bookings/bk-due/check-in")).toBe(true);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const asked = mockConfirm.mock.calls[0][0];
    expect(asked.title).toBe("Take payment now for Juno?");
    expect(asked.body).toMatch(/Single Day of Daycare — \$25\.00 covers this visit/);
    expect(asked.body).toMatch(/5 hours or less/);
    expect(asked).toMatchObject({ confirmText: "Take payment", cancelText: "Not now" });
    expect(q("pos-cart-client").textContent).toMatch(/Dana/);
    expect(all("pos-cart-line")).toHaveLength(1);
    expect(q("pos-dropoff-notice").textContent).toMatch(/Single Day of Daycare for Juno/);
  });

  test("Not now leaves the cart alone; the dog is still checked in", async () => {
    mockConfirm.mockImplementation(async () => false);
    await mount("expected");
    await click("pos-visit-checkin-bk-due");
    await settle();
    expect(api.post.mock.calls.some(c => c[0] === "/bookings/bk-due/check-in")).toBe(true);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(all("pos-cart-line")).toHaveLength(0);
    expect(q("pos-dropoff-notice")).toBeNull();
  });

  test("nothing is asked when credits already cover the visit, or the question can't be answered", async () => {
    dueOffer = { offer: false, covered: true, packs: [], reason: "Juno's visit is already covered by credits on the account." };
    await mount("expected");
    await click("pos-visit-checkin-bk-due");
    await settle();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(all("pos-cart-line")).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
