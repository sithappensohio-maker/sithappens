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
// The real picker is a calendar; these tests only need "these days were picked".
jest.mock("./MultiDatePicker", () => ({
  __esModule: true,
  default: ({ onChange }) => (
    <button data-testid="pick-days" onClick={() => onChange(["2031-05-05", "2031-05-06", "2031-05-07"])}>pick</button>
  ),
}));

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

test("credits set aside for other bookings are explained in the offer", async () => {
  payOptions = () => Promise.resolve({ data: { ...SHORT, credits_available: 0, credits_on_account: 2, credits_promised: 2 } });
  const v = await atReview();
  expect(v.q("wiz-pay-now-why").textContent).toMatch(/needs 1 daycare credit\. You have 2 credits, but 2 are already set aside for your other upcoming bookings/);
  await v.cleanup();
});

describe("the price estimate sets aside credits other bookings will use", () => {
  const BookingPriceEstimate = require("./BookingPriceEstimate").default;
  const QUOTE = {
    service_type: "daycare", service_name: "Daycare (per day)", billable_units: 1, unit_label: "day", unit_price: 40,
    estimated_price: 40, first_dog_base_price: 40, add_ons: [], add_on_total: 0, credit_units_required: 1,
  };
  async function estimate(props, quote) {
    api.get.mockImplementation((url) => {
      if (url === "/services") return Promise.resolve({ data: [DAYCARE] });
      if (url === "/portal/me") return Promise.resolve({ data: { client: { credits: 2 } } });
      return Promise.resolve({ data: {} });
    });
    api.post.mockImplementation(() => Promise.resolve({ data: quote }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<BookingPriceEstimate serviceType="daycare" serviceId={DAYCARE.id} date="2027-03-10" {...props} />); });
    await flush();
    return { q: (id) => host.querySelector(`[data-testid="${id}"]`), cleanup: () => act(() => root.unmount()) };
  }

  test("2 credits, both promised: not 'covered', the full price shows, and it says why", async () => {
    const v = await estimate({}, { ...QUOTE, credits_available: 0, credits_on_account: 2, credits_promised: 2,
                                   credits_applied: 0, credit_shortfall: 1, cash_due: 40, covered_by_credits: false });
    expect(v.q("booking-estimate-credit-covered")).toBeNull();
    expect(v.q("booking-estimate-total").textContent).toBe("$40.00");
    expect(v.q("booking-estimate-credits-promised").textContent).toMatch(/2 of your daycare credits are set aside for your other upcoming bookings/);
    await v.cleanup();
  });

  test("no promised credits: no note", async () => {
    const v = await estimate({}, { ...QUOTE, credits_available: 2, credits_on_account: 2, credits_promised: 0,
                                   credits_applied: 1, credits_remaining_after: 1, credit_shortfall: 0, cash_due: 0, covered_by_credits: true });
    expect(v.q("booking-estimate-credit-covered")).toBeTruthy();
    expect(v.q("booking-estimate-credits-promised")).toBeNull();
    await v.cleanup();
  });

  test("several days at once (worked out on the screen) also sets them aside", async () => {
    const v = await estimate({ isMultiDate: true, multiDates: ["2027-03-10", "2027-03-11"] }, { credits_promised: 2 });
    expect(v.q("booking-estimate-credit-covered")).toBeNull();
    expect(v.q("booking-estimate-total").textContent).toBe("$80.00");
    expect(v.q("booking-estimate-credits-promised")).toBeTruthy();
    await v.cleanup();
  });
});

describe("the pack that matches the booking is the one selected", () => {
  const MOLLY = { id: "d-molly", name: "Molly", breed: "Lab" };
  const TWO_DOG = { id: "pk-2d", name: "2 Dogs 1 Day", price: 37.5, qty: 1.5 };
  const forDogs = (n) => (n >= 2
    ? { ...SHORT, credits_needed: 1.5, credits_short: 1.5,
        packs: [{ ...TWO_DOG, covers: true, best_match: true }, { ...FIVE, covers: true }, { ...ONE, covers: false }] }
    : { ...SHORT, packs: [{ ...ONE, best_match: true }, { ...TWO_DOG, covers: true }, FIVE] });

  async function twoDogReview() {
    api.post.mockImplementation((url, body) => {
      if (url === "/portal/booking-pay-options") return Promise.resolve({ data: forDogs(body.dog_count) });
      if (url === "/bookings/group") return Promise.resolve({ data: { group_id: "g-1", bookings: [{ id: "b-1" }, { id: "b-2" }] } });
      if (url === "/shop/checkout") return checkout();
      return Promise.resolve({ data: {} });
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PortalBookWizard dogs={[ROSIE, MOLLY]} seed={{ dog_id: ROSIE.id, service_id: DAYCARE.id }}
                                    onClose={() => {}} onBooked={() => {}} />);
    });
    await flush();
    const q = (id) => host.querySelector(`[data-testid="${id}"]`);
    const click = async (id) => { await act(async () => { q(id).click(); }); await flush(); };
    await click("wiz-step1-next");
    await click("wiz-step2-next");
    return { q, click, cleanup: () => act(() => root.unmount()) };
  }

  test("adding a second dog on Review re-selects the two-dog pack, not the one-dog pack", async () => {
    const v = await twoDogReview();
    expect(v.q("wiz-pay-pack-pk-1").getAttribute("aria-checked")).toBe("true");
    await v.click("wiz-add-dog");
    expect(v.q("wiz-pay-pack-pk-2d").getAttribute("aria-checked")).toBe("true");
    expect(v.q("wiz-pay-pack-pk-1").getAttribute("aria-checked")).toBe("false");
    expect(v.q("wiz-pay-best-pk-2d").textContent).toMatch(/matches this booking/i);
    expect(v.q("wiz-confirm-pay").textContent).toMatch(/\$37\.50/);
    // The other packs are still there to choose, and the choice sticks.
    await v.click("wiz-pay-pack-pk-5");
    expect(v.q("wiz-confirm-pay").textContent).toMatch(/\$150\.00/);
    await v.click("wiz-confirm-pay");
    expect(posts("/shop/checkout")[0][1].items).toEqual([{ kind: "credit_pack", ref_id: "pk-5", quantity: 1 }]);
    await v.cleanup();
  });
});

describe("add-ons can be paid for while booking", () => {
  const BATH = { id: "ad-bath", name: "Bath", base_price: 15, is_addon: true, active: true };
  const ADDONS = { total: 15, lines: [{ name: "Bath", count: 1, amount: 15 }] };

  async function reviewWithBath(options) {
    api.get.mockImplementation((url) => {
      if (url === "/services") return Promise.resolve({ data: [DAYCARE] });
      if (url === "/services/addons") return Promise.resolve({ data: [BATH] });
      if (url === "/bookings/availability") return Promise.resolve({ data: OPEN });
      return Promise.resolve({ data: {} });
    });
    api.post.mockImplementation((url, body) => {
      if (url === "/portal/booking-pay-options") return Promise.resolve({ data: body.addon_service_ids.length ? options : { offer: false, packs: [] } });
      if (url === "/bookings") return booking();
      if (url === "/shop/checkout") return checkout();
      return Promise.resolve({ data: {} });
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PortalBookWizard dogs={[ROSIE]} seed={{ dog_id: ROSIE.id, service_id: DAYCARE.id }}
                                    onClose={() => {}} onBooked={() => {}} />);
    });
    await flush();
    const q = (id) => host.querySelector(`[data-testid="${id}"]`);
    const click = async (id) => { await act(async () => { q(id).click(); }); await flush(); };
    await click("wiz-step1-next");
    await click("portal-addon-ad-bath");
    await click("wiz-step2-next");
    return { q, click, cleanup: () => act(() => root.unmount()) };
  }

  test("credits cover the visit: the add-on alone can be paid now", async () => {
    const v = await reviewWithBath({ offer: true, service_type: "daycare", packs: [], addons: ADDONS });
    expect(posts("/portal/booking-pay-options").pop()[1].addon_service_ids).toEqual(["ad-bath"]);
    expect(v.q("wiz-pay-addons-why").textContent).toMatch(/add-ons for this booking come to \$15\.00/);
    expect(v.q("wiz-pay-addons-toggle").getAttribute("aria-checked")).toBe("true");
    expect(v.q("wiz-confirm-pay").textContent).toMatch(/Book & pay \$15\.00 now/);
    await v.click("wiz-confirm-pay");
    expect(posts("/bookings")).toHaveLength(1);
    expect(posts("/shop/checkout")[0][1].items).toEqual([{ kind: "booking_addons", ref_id: "ba:b-1", quantity: 1 }]);
    await v.cleanup();
  });

  test("a pack and the add-on are one card payment; unticking add-ons pays the pack only", async () => {
    const v = await reviewWithBath({ ...SHORT, packs: [{ ...ONE, best_match: true }, FIVE], addons: ADDONS });
    expect(v.q("wiz-confirm-pay").textContent).toMatch(/\$55\.00/);
    await v.click("wiz-pay-addons-toggle");
    expect(v.q("wiz-confirm-pay").textContent).toMatch(/\$40\.00/);
    await v.click("wiz-pay-addons-toggle");
    await v.click("wiz-confirm-pay");
    expect(posts("/shop/checkout")).toHaveLength(1);
    expect(posts("/shop/checkout")[0][1].items).toEqual([
      { kind: "credit_pack", ref_id: "pk-1", quantity: 1 },
      { kind: "booking_addons", ref_id: "ba:b-1", quantity: 1 },
    ]);
    await v.cleanup();
  });

  test("nothing ticked and no pack picked: only the plain Confirm is left", async () => {
    const v = await reviewWithBath({ offer: true, service_type: "daycare", packs: [], addons: ADDONS });
    await v.click("wiz-pay-addons-toggle");
    expect(v.q("wiz-confirm-pay")).toBeNull();
    expect(v.q("wiz-confirm").textContent).toBe("Confirm booking");
    await v.cleanup();
  });
});

describe("several of one pack, and several dogs on several days", () => {
  const MOLLY = { id: "d-molly", name: "Molly", breed: "Lab" };
  const THREE_SINGLES = { ...ONE, price: 25, quantity: 3, total: 75, credits: 3, covers: true, best_match: true };
  const TEN = { id: "pk-10", name: "10 Days of Daycare", price: 220, qty: 10, quantity: 1, total: 220, credits: 10, covers: true };

  async function threeDays(dogs) {
    api.post.mockImplementation((url, body) => {
      if (url === "/portal/booking-pay-options") return Promise.resolve({ data: { ...SHORT, credits_needed: 3, credits_short: 3, packs: [THREE_SINGLES, TEN] } });
      if (url === "/bookings/multi-dates") return Promise.resolve({ data: { created: [{ id: "b-1" }, { id: "b-2" }, { id: "b-3" }], skipped: [] } });
      if (url === "/bookings/group") {
        if (body.date === "2031-05-06") return Promise.reject({ response: { status: 409, data: { detail: "That day is full." } } });
        return Promise.resolve({ data: { group_id: `g-${body.date}`, bookings: body.dogs.map(d => ({ id: `${body.date}_${d.dog_id}` })) } });
      }
      if (url === "/shop/checkout") return checkout();
      return Promise.resolve({ data: {} });
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<PortalBookWizard dogs={dogs} seed={{ dog_id: ROSIE.id, service_id: DAYCARE.id }}
                                    onClose={() => {}} onBooked={() => {}} />);
    });
    await flush();
    const q = (id) => host.querySelector(`[data-testid="${id}"]`);
    const click = async (id) => {
      if (!q(id)) throw new Error(`no [data-testid="${id}"]`);
      await act(async () => { q(id).click(); });
      await flush();
    };
    await click("wiz-step1-next");
    await click("wiz-multidate-toggle");
    await click("pick-days");
    await click("wiz-step2-next");
    return { q, click, cleanup: () => act(() => root.unmount()) };
  }

  test("three single days are offered and bought as quantity 3", async () => {
    const v = await threeDays([ROSIE]);
    expect(posts("/portal/booking-pay-options").pop()[1].dates).toHaveLength(3);
    expect(v.q("wiz-pay-pack-pk-1").textContent).toMatch(/3 × Single Day.*3 credits in all · \$25\.00 each.*\$75\.00/);
    expect(v.q("wiz-pay-pack-pk-1").getAttribute("aria-checked")).toBe("true");
    expect(v.q("wiz-confirm-pay").textContent).toMatch(/Book & pay \$75\.00 now/);
    await v.click("wiz-confirm-pay");
    expect(posts("/bookings/multi-dates")).toHaveLength(1);
    expect(posts("/shop/checkout")[0][1].items).toEqual([{ kind: "credit_pack", ref_id: "pk-1", quantity: 3 }]);
    await v.cleanup();
  });

  test("a second dog can be added when booking several days; each day is booked for both, a full day is skipped", async () => {
    const v = await threeDays([ROSIE, MOLLY]);
    expect(v.q("wiz-multidog")).toBeTruthy();
    await v.click("wiz-add-dog");
    expect(posts("/portal/booking-pay-options").pop()[1]).toMatchObject({ dog_count: 2 });
    expect(v.q("wiz-confirm").textContent).toMatch(/Submit 3 days · 2 dogs/);
    await v.click("wiz-confirm");
    const days = posts("/bookings/group");
    expect(days.map(c => c[1].date)).toEqual(["2031-05-05", "2031-05-06", "2031-05-07"]);
    expect(days[0][1].dogs.map(d => d.dog_id)).toEqual([ROSIE.id, MOLLY.id]);
    expect(posts("/bookings/multi-dates")).toHaveLength(0);
    expect(v.q("wiz-step4-ack").textContent).toMatch(/2 days booked for 2 dogs/);
    expect(v.q("wiz-ack-skipped").textContent).toMatch(/That day is full/);
    await v.cleanup();
  });
});

test("only the pack that covers the booking is shown, with nothing else to choose between", async () => {
  payOptions = () => Promise.resolve({ data: { ...SHORT, packs: [{ ...ONE, quantity: 1, total: 40, best_match: true }] } });
  const v = await atReview();
  expect(document.querySelectorAll('[data-testid^="wiz-pay-pack-"]')).toHaveLength(1);
  expect(v.q("wiz-pay-pack-pk-1").getAttribute("aria-checked")).toBe("true");
  expect(v.q("wiz-pay-best-pk-1")).toBeNull();
  expect(v.q("wiz-confirm-pay").textContent).toMatch(/Book & pay \$40\.00 now/);
  await v.cleanup();
});
