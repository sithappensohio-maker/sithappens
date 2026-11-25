/* Pay while booking (owner request): a client whose credits don't cover the
 * booking is offered the packs that do, right on the Review step, and can
 * book and pay in one go. A client with enough credits sees nothing new.
 *
 * Mounted, same harness as bookingBlocks.test.js.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PortalBookWizard from "./PortalBookWizard";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: () => {} }));
jest.mock("../lib/theme", () => ({
  useTheme: () => ({ branding: { payment_options: [], booking_flow_controls: { show_price_estimate: false } } }),
  useFeature: () => true,
}));
jest.mock("../lib/leavePage", () => ({ leaveTo: jest.fn() }));

const { api } = require("../lib/api");
const { leaveTo } = require("../lib/leavePage");

global.IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

const DAYCARE = {
  id: "svc-day", name: "Daycare (per day)", service_type: "daycare", base_price: 40, active: true,
  booking_flow: { instant_book: true, require_approval: false, client_booking_enabled: true },
};
const ROSIE = { id: "d-rosie", name: "Rosie", breed: "Border Collie" };
const OPEN = { open_slots: 30, capacity: 30, vaccine_ok: true, missing_vaccines: [] };
const ONE = { id: "pk-1", name: "Single Day", price: 40, qty: 1, covers: true };
const FIVE = { id: "pk-5", name: "5 Day Pack", price: 150, qty: 5, covers: true };
const SHORT = { offer: true, service_type: "daycare", pool_label: "daycare", credits_needed: 1, credits_available: 0, credits_short: 1, packs: [ONE, FIVE] };

let payOptions, booking, checkout;
const posts = (url) => api.post.mock.calls.filter(c => c[0] === url);

beforeEach(() => {
  payOptions = () => Promise.resolve({ data: SHORT });
  booking = () => Promise.resolve({ data: { id: "b-1", status: "confirmed" } });
  checkout = () => Promise.resolve({ data: { url: "https://checkout.stripe.com/pay/abc", order_id: "o-1" } });
  leaveTo.mockReset();
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/services") return Promise.resolve({ data: [DAYCARE] });
    if (url === "/services/addons") return Promise.resolve({ data: [] });
    if (url === "/bookings/availability") return Promise.resolve({ data: OPEN });
    return Promise.resolve({ data: {} });
  });
  api.post.mockImplementation((url) => {
    if (url === "/portal/booking-pay-options") return payOptions();
    if (url === "/bookings") return booking();
    if (url === "/shop/checkout") return checkout();
    return Promise.resolve({ data: {} });
  });
});

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

async function atReview() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<PortalBookWizard dogs={[ROSIE]} seed={{ dog_id: ROSIE.id, service_id: DAYCARE.id }}
                                  onClose={() => {}} onBooked={() => {}} />);
  });
  await flush();
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const click = async (id) => {
    const el = q(id);
    if (!el) throw new Error(`no [data-testid="${id}"]`);
    await act(async () => { el.click(); });
    await flush();
  };
  await click("wiz-step1-next");
  await click("wiz-step2-next");
  return { q, click, cleanup: () => act(() => root.unmount()) };
}

test("short on credits: Review offers the packs and a Book & pay now button", async () => {
  const v = await atReview();
  expect(posts("/portal/booking-pay-options")[0][1]).toMatchObject({ service_type: "daycare", dog_count: 1, dates: [] });
  expect(v.q("wiz-pay-now-why").textContent).toMatch(/needs 1 daycare credit and you have none/);
  expect(v.q("wiz-pay-pack-pk-1").textContent).toMatch(/Single Day.*covers this booking.*\$40\.00/);
  expect(v.q("wiz-pay-pack-pk-5")).toBeTruthy();
  // The cheapest covering pack is already picked, so paying is one press.
  expect(v.q("wiz-pay-pack-pk-1").getAttribute("aria-checked")).toBe("true");
  expect(v.q("wiz-confirm-pay").textContent).toMatch(/Book & pay \$40\.00 now/);
  expect(v.q("wiz-confirm").textContent).toMatch(/pay later/);
  await v.cleanup();
});

test("enough credits: nothing new on Review", async () => {
  payOptions = () => Promise.resolve({ data: { offer: false, packs: [] } });
  const v = await atReview();
  expect(v.q("wiz-pay-now")).toBeNull();
  expect(v.q("wiz-confirm-pay")).toBeNull();
  expect(v.q("wiz-confirm").textContent).toBe("Confirm booking");
  await v.cleanup();
});

test("Book & pay now saves the booking, then opens the card page for the chosen pack", async () => {
  const v = await atReview();
  await v.click("wiz-pay-pack-pk-5");
  expect(v.q("wiz-confirm-pay").textContent).toMatch(/\$150\.00/);
  await v.click("wiz-confirm-pay");
  expect(posts("/bookings")).toHaveLength(1);
  const sent = posts("/shop/checkout");
  expect(sent).toHaveLength(1);
  expect(sent[0][1].items).toEqual([{ kind: "credit_pack", ref_id: "pk-5", quantity: 1 }]);
  expect(sent[0][1].idempotency_key).toEqual(expect.any(String));
  expect(leaveTo).toHaveBeenCalledWith("https://checkout.stripe.com/pay/abc");
  expect(v.q("wiz-step4-ack")).toBeTruthy();
  expect(v.q("wiz-pay-opening").textContent).toMatch(/booking is saved/i);
  await v.cleanup();
});

test("plain Confirm books without touching payment", async () => {
  const v = await atReview();
  await v.click("wiz-confirm");
  expect(posts("/bookings")).toHaveLength(1);
  expect(posts("/shop/checkout")).toHaveLength(0);
  expect(leaveTo).not.toHaveBeenCalled();
  expect(v.q("wiz-pay-opening")).toBeNull();
  await v.cleanup();
});

test("a refused booking never opens the card page", async () => {
  booking = () => Promise.reject({ response: { status: 400, data: { detail: "Please sign our waiver.", block: { code: "waiver_unsigned", action: "sign_waiver" } } } });
  const v = await atReview();
  await v.click("wiz-confirm-pay");
  expect(v.q("wiz-error").textContent).toMatch(/waiver/i);
  expect(posts("/shop/checkout")).toHaveLength(0);
  expect(leaveTo).not.toHaveBeenCalled();
  await v.cleanup();
});

test("card page won't open: booking is kept, and Try again reuses the same key and does not book twice", async () => {
  checkout = () => Promise.reject({ response: { status: 503, data: { detail: "Could not start the online payment — nothing was charged. Please try again." } } });
  const v = await atReview();
  await v.click("wiz-confirm-pay");
  expect(v.q("wiz-step4-ack")).toBeTruthy();
  expect(v.q("wiz-pay-failed").textContent).toMatch(/booking is saved and nothing was charged/i);
  expect(leaveTo).not.toHaveBeenCalled();
  checkout = () => Promise.resolve({ data: { url: "https://checkout.stripe.com/pay/second", order_id: "o-1" } });
  await v.click("wiz-pay-retry");
  expect(posts("/bookings")).toHaveLength(1);
  const sent = posts("/shop/checkout");
  expect(sent).toHaveLength(2);
  expect(sent[1][1].idempotency_key).toBe(sent[0][1].idempotency_key);
  expect(leaveTo).toHaveBeenCalledWith("https://checkout.stripe.com/pay/second");
  await v.cleanup();
});

test("a double tap on Book & pay now is one booking and one checkout", async () => {
  const v = await atReview();
  const btn = v.q("wiz-confirm-pay");
  await act(async () => { btn.click(); btn.click(); });
  await flush();
  expect(posts("/bookings")).toHaveLength(1);
  expect(posts("/shop/checkout")).toHaveLength(1);
  await v.cleanup();
});

test("the offer failing to load never blocks booking", async () => {
  payOptions = () => Promise.reject(new Error("offline"));
  const v = await atReview();
  expect(v.q("wiz-pay-now")).toBeNull();
  await v.click("wiz-confirm");
  expect(v.q("wiz-step4-ack")).toBeTruthy();
  await v.cleanup();
});
