/**
 * One rule for every price at checkout (audit #23, owner's choice A).
 *
 * Only staff with the pricing permission change a price at checkout: the
 * visit price (or, paid from credits, an extra amount on top), the per-night
 * rate for extra nights, or a one-time discount. Everyone else checks out at
 * the normal price, so the screen doesn't offer those boxes to them — and
 * the server refuses a changed price anyway. The server's own early-checkout
 * price is not a change: it is still sent for everyone. Add-ons are charged
 * at the price the screen shows, so the screen reads today's price list when
 * it opens and again just before Complete. Mounted.
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
let mockCan = () => true;
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: (k) => mockCan(k) }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-29";
const DAYCARE = { id: "bk-1", dog_id: "d-1", dog_name: "Bo", client_id: "c-dana", client_name: "Dana", service_type: "daycare",
                  service_id: "svc-d", date: TODAY, status: "approved", checked_in_at: `${TODAY}T08:00:00Z`, estimated_price: 40,
                  pricing_snapshot: { unit_price: 40 } };
const STAY = { ...DAYCARE, id: "bk-2", service_type: "boarding", service_id: "svc-b", date: "2026-09-27", end_date: TODAY,
               estimated_price: 100, pricing_snapshot: { unit_price: 50 } };
const SERVICES = [{ id: "svc-d", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true },
                  { id: "svc-b", name: "Boarding", service_type: "boarding", base_price: 50, active: true, is_default: true },
                  { id: "svc-bath", name: "Bath", service_type: "grooming", base_price: 20, active: true, is_addon: true,
                    addon_for: ["daycare", "boarding"] }];

let container, root, preview, early, boardingCredits, priceList;

const respond = (url) => {
  if (url === "/services") return Promise.resolve({ data: priceList() });
  if (url.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: preview } });
  if (url.includes("early-checkout-quote")) return Promise.resolve({ data: early });
  if (url.startsWith("/clients/")) return Promise.resolve({ data: url.endsWith("credit-lots") ? [] : { credits: 0, boarding_credits: boardingCredits, account_balance: 0 } });
  if (url.includes("money-modifier-preview")) return Promise.resolve({ data: { sales_tax: { enabled: false } } });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  mockCan = () => true;
  early = { applicable: false };
  boardingCredits = 3;
  priceList = () => ({});                    // (no list: the screen keeps the one it was given)
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (booking) => {
  preview = [booking];
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={booking} services={SERVICES} onClose={() => {}} />);
  });
  await flush();
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
  await flush();
};
const checkoutPost = () => api.post.mock.calls.find(([path]) => String(path).includes("/check-out"));
const noPricing = () => { mockCan = (k) => k !== "pricing"; };

test("staff without the pricing permission are offered no price box, and send no price", async () => {
  noPricing();
  await mount(DAYCARE);
  expect(q("checkout-base-price")).toBeFalsy();
  expect(q("checkout-discount-panel")).toBeFalsy();
  expect(q("checkout-price-locked").textContent).toContain("pricing permission");
  await click("confirm-checkout");
  const body = checkoutPost()[1];
  for (const key of ["base_price", "base_price_reason", "additional_cash_charge", "extra_nights_rate", "checkout_discount_amount"]) {
    expect(body[key]).toBeUndefined();
  }
});

test("staff without the pricing permission add extra nights at the normal rate", async () => {
  noPricing();
  await mount(STAY);
  await click("extra-nights-plus");
  const credits = q("extra-nights-use-credits");
  await act(async () => { credits.click(); });
  await flush();
  expect(q("extra-nights-rate")).toBeFalsy();
  await click("confirm-checkout");
  const body = checkoutPost()[1];
  expect(body).toMatchObject({ extra_nights: 1, extra_nights_use_credits: false });
  expect(body.extra_nights_rate).toBeUndefined();
});

test("the server's own early-checkout price is still sent for staff without the pricing permission", async () => {
  noPricing();
  early = { applicable: true, base_price: 75, units: 1 };
  boardingCredits = 0;                     // (paid at the desk)
  const leaving = { ...STAY, end_date: "2026-10-02" };
  await mount(leaving);
  await click("confirm-checkout");
  expect(checkoutPost()[1].base_price).toBe(75);
  expect(checkoutPost()[1].base_price_reason).toBeUndefined();
});

test("staff with the pricing permission keep every price box", async () => {
  await mount(STAY);
  expect(q("checkout-price-locked")).toBeFalsy();
  expect(q("checkout-base-price")).toBeTruthy();
  expect(q("checkout-discount-panel")).toBeTruthy();
  await click("extra-nights-plus");
  await act(async () => { q("extra-nights-use-credits").click(); });
  await flush();
  expect(q("extra-nights-rate")).toBeTruthy();
});


// --------------------------------------------------- today's add-on prices

const withBath = (price, active = true) => () => SERVICES.map((sv) => (sv.id === "svc-bath" ? { ...sv, base_price: price, active } : sv));

test("the checkout reads today's price list when it opens, not the one the screen loaded hours ago", async () => {
  noPricing();
  priceList = withBath(25);                  // the owner raised the bath from $20 since the Register opened
  await mount(DAYCARE);
  expect(q("addon-svc-bath").textContent).toContain("$25.00");
  await click("addon-svc-bath");
  await click("confirm-checkout");
  expect(checkoutPost()[1].add_ons).toEqual([{ service_id: "svc-bath", name: "Bath", price: 25, qty: 1 }]);
});

test("a price changed after the checkout opened is shown before anything is charged", async () => {
  priceList = withBath(20);
  await mount(DAYCARE);
  await click("addon-svc-bath");
  priceList = withBath(25);
  await click("confirm-checkout");
  expect(checkoutPost()).toBeUndefined();
  expect(q("checkout-error").textContent).toBe("The price of Bath is now $25.00. Check the total and press Complete again.");
  expect(q("addon-svc-bath").textContent).toContain("$25.00");
  await click("confirm-checkout");
  expect(checkoutPost()[1].add_ons).toEqual([{ service_id: "svc-bath", name: "Bath", price: 25, qty: 1 }]);
});

test("an add-on no longer offered is taken off before anything is charged", async () => {
  priceList = withBath(20);
  await mount(DAYCARE);
  await click("addon-svc-bath");
  priceList = withBath(20, false);
  await click("confirm-checkout");
  expect(checkoutPost()).toBeUndefined();
  expect(q("checkout-error").textContent).toContain("Bath isn't offered anymore, so it was taken off");
  await click("confirm-checkout");
  expect(checkoutPost()[1].add_ons).toEqual([]);
});

test("both price-list reads ask the server, never the app's one-minute copy", async () => {
  priceList = withBath(20);
  await mount(DAYCARE);
  await click("addon-svc-bath");
  await click("confirm-checkout");
  const reads = api.get.mock.calls.filter(([url]) => url === "/services");
  expect(reads.length).toBe(2);                        // when it opened, and just before Complete
  for (const [, config] of reads) expect(config).toEqual({ sharedCache: "refresh" });
});

test("a price changed between the check and Complete is shown with the refusal, and the next press goes through", async () => {
  noPricing();
  priceList = withBath(20);
  await mount(DAYCARE);
  await click("addon-svc-bath");
  api.post.mockImplementationOnce(() => {
    priceList = withBath(25);                          // the owner changed it a moment ago
    return Promise.reject({ response: { status: 409, data: { detail: "The price of Bath is now $25.00. Check the total and press Complete again." } } });
  });
  await click("confirm-checkout");
  expect(q("checkout-error").textContent).toBe("The price of Bath is now $25.00. Check the total and press Complete again.");
  expect(q("addon-svc-bath").textContent).toContain("$25.00");
  await click("confirm-checkout");
  const posts = api.post.mock.calls.filter(([path]) => String(path).includes("/check-out"));
  expect(posts.length).toBe(2);
  expect(posts[1][1].add_ons).toEqual([{ service_id: "svc-bath", name: "Bath", price: 25, qty: 1 }]);
});
