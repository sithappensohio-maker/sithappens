/* A refused booking must say WHAT is stopping the client and HOW to fix it.
 *
 * Mounted (not source-read): the failures being pinned are behavioural —
 * an error rendered off-screen, a disabled Review button with no reason, a
 * vaccine pre-check that always said "Rabies", a full date silently turned
 * into a waitlist entry. Same createRoot/act harness as
 * stage1BookingChoices.test.js.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PortalBookWizard from "./PortalBookWizard";
import { bookingFailure, groupSkips } from "../lib/bookingBlocks";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: () => {} }));
jest.mock("../lib/theme", () => ({
  useTheme: () => ({ branding: { payment_options: [] } }),
  useFeature: () => true,
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

const DAYCARE = {
  id: "svc-day", name: "Daycare (per day)", service_type: "daycare", base_price: 40, active: true,
  booking_flow: { instant_book: true, require_approval: false, client_booking_enabled: true },
};
const ROSIE = { id: "d-rosie", name: "Rosie", breed: "Border Collie" };
const OPEN = { open_slots: 30, capacity: 30, vaccine_ok: true, missing_vaccines: [] };

let availability;
beforeEach(() => {
  availability = () => Promise.resolve({ data: OPEN });
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/services") return Promise.resolve({ data: [DAYCARE] });
    if (url === "/services/addons") return Promise.resolve({ data: [] });
    if (url === "/bookings/availability") return availability();
    return Promise.resolve({ data: {} });
  });
});

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

async function mount(props = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<PortalBookWizard dogs={[ROSIE]} seed={{ dog_id: ROSIE.id, service_id: DAYCARE.id }}
                                  onClose={() => {}} onBooked={() => {}} {...props} />);
  });
  await flush();
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const click = async (id) => {
    const el = q(id);
    if (!el) throw new Error(`no [data-testid="${id}"]`);
    await act(async () => { el.click(); });
    await flush();
  };
  return { q, click, text: () => host.textContent || "", cleanup: () => act(() => root.unmount()) };
}

const refusal = (status, data) => Promise.reject({ response: { status, data } });

describe("bookingFailure()", () => {
  test("network and server failures still say what to do", () => {
    expect(bookingFailure({}).message).toMatch(/internet connection/i);
    expect(bookingFailure({ response: { status: 502, data: "<html>" } }).message).toMatch(/nothing was booked/i);
  });
  test("a structured refusal keeps its sentence and its fix", () => {
    const f = bookingFailure({ response: { status: 400, data: { detail: "Please sign our waiver.", block: { code: "waiver_unsigned", action: "sign_waiver" } } } });
    expect(f).toEqual({ message: "Please sign our waiver.", block: { code: "waiver_unsigned", action: "sign_waiver" } });
  });
  test("capacity refusals become a pick-another-date fix", () => {
    const f = bookingFailure({ response: { status: 409, data: { detail: "Full.", capacity: { code: "capacity_full", display_message: "Full.", action: "pick_date", waitlist_allowed: true } } } });
    expect(f.block).toMatchObject({ code: "capacity_full", action: "pick_date", waitlist_allowed: true });
  });
  test("skipped days group by reason", () => {
    const g = groupSkips([{ date: "2026-10-07", reason: "Closed." }, { date: "2026-10-14", reason: "Closed." }, { date: "2026-10-21", reason: { display_message: "Full." } }]);
    expect(g.map(x => [x.reason, x.dates.length])).toEqual([["Closed.", 2], ["Full.", 1]]);
  });
});

describe("the portal booking wizard explains every block", () => {
  test("daycare vaccine pre-check names the real problem and offers the upload", async () => {
    availability = () => Promise.resolve({ data: {
      ...OPEN, vaccine_ok: false, missing_vaccines: ["bordetella"],
      vaccine_problem: { message: "Rosie's Bordetella vaccine expired on Tue, Sep 1, 2026. Upload a current Bordetella certificate, then book again.",
                         block: { code: "vaccine_expired", action: "upload_vaccines", dog_id: ROSIE.id, vaccine: "bordetella" } },
    } });
    const onFixBlock = jest.fn();
    const v = await mount({ onFixBlock, fixActions: ["upload_vaccines"] });
    await v.click("wiz-step1-next");
    expect(v.q("wiz-daycare-vaccine").textContent).toMatch(/Bordetella vaccine expired/);
    expect(v.text()).not.toMatch(/Rabies missing/i);
    expect(v.q("wiz-step2-next").disabled).toBe(true);
    expect(v.q("wiz-step2-hint").textContent).toMatch(/vaccine/i);
    await v.click("wiz-daycare-vaccine-fix");
    expect(onFixBlock).toHaveBeenCalledWith("upload_vaccines", expect.objectContaining({ dog_id: ROSIE.id, vaccine: "bordetella" }));
    await v.cleanup();
  });

  test("availability that fails to load is said out loud, with a retry", async () => {
    availability = () => Promise.reject(new Error("offline"));
    const v = await mount();
    await v.click("wiz-step1-next");
    expect(v.q("wiz-daycare-avail-failed")).toBeTruthy();
    expect(v.q("wiz-step2-hint").textContent).toMatch(/couldn't check availability/i);
    availability = () => Promise.resolve({ data: OPEN });
    await v.click("wiz-daycare-avail-retry");
    expect(v.q("wiz-step2-next").disabled).toBe(false);
    await v.cleanup();
  });

  test("a refusal at Confirm sits by the button and offers its fix", async () => {
    api.post.mockImplementation(() => refusal(400, {
      detail: "Please sign our waiver before booking. It only takes a minute, then come back and book.",
      block: { code: "waiver_unsigned", action: "sign_waiver" },
    }));
    const onFixBlock = jest.fn();
    const v = await mount({ onFixBlock, fixActions: ["sign_waiver"] });
    await v.click("wiz-step1-next");
    await v.click("wiz-step2-next");
    await v.click("wiz-confirm");
    const notice = v.q("wiz-error");
    expect(notice.textContent).toMatch(/sign our waiver/i);
    expect(notice.getAttribute("data-block-code")).toBe("waiver_unsigned");
    // It is scrolled into view — the Confirm tap is not a silent no-op.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    await v.click("wiz-error-fix");
    expect(onFixBlock).toHaveBeenCalledWith("sign_waiver", expect.objectContaining({ code: "waiver_unsigned" }));
    await v.cleanup();
  });

  test("a fix the host can't perform shows no button, just the sentence", async () => {
    api.post.mockImplementation(() => refusal(409, {
      detail: "New bookings are paused while your account has an unpaid balance of $80.00.",
      block: { code: "balance_over_limit", action: "pay_balance" },
    }));
    const v = await mount({ onFixBlock: jest.fn(), fixActions: [] });
    await v.click("wiz-step1-next");
    await v.click("wiz-step2-next");
    await v.click("wiz-confirm");
    expect(v.q("wiz-error").textContent).toMatch(/\$80\.00/);
    expect(v.q("wiz-error-fix")).toBeNull();
    await v.cleanup();
  });

  test("full at Confirm: the waitlist is offered, never joined silently", async () => {
    api.post.mockImplementation((url) => (url === "/waitlist"
      ? Promise.resolve({ data: { id: "w1" } })
      : refusal(409, { detail: "Full.", capacity: { code: "capacity_full", display_message: "Daycare is full on Wed, Oct 7. Please pick another date.", action: "pick_date", waitlist_allowed: true } })));
    const v = await mount();
    await v.click("wiz-step1-next");
    await v.click("wiz-step2-next");
    await v.click("wiz-confirm");
    expect(api.post).not.toHaveBeenCalledWith("/waitlist", expect.anything());
    expect(v.q("wiz-error").textContent).toMatch(/Daycare is full/);
    expect(v.q("wiz-join-waitlist")).toBeTruthy();
    // "Choose another date" steps back to the date picker, error cleared.
    await v.click("wiz-error-fix");
    expect(v.q("wiz-step2-next")).toBeTruthy();
    expect(v.q("wiz-error")).toBeNull();
    // Or they choose the waitlist themselves.
    await v.click("wiz-step2-next");
    await v.click("wiz-confirm");
    await v.click("wiz-join-waitlist");
    expect(api.post).toHaveBeenCalledWith("/waitlist", expect.objectContaining({ dog_id: ROSIE.id }));
    expect(v.q("wiz-step4-ack")).toBeTruthy();
    await v.cleanup();
  });

  test("Book Again with a service that was switched off says so", async () => {
    const v = await mount({ seed: { dog_id: ROSIE.id, service_id: "svc-retired" } });
    expect(v.q("wiz-seed-unavailable").textContent).toMatch(/can't be booked online anymore/i);
    expect(v.q("wiz-step1-next").disabled).toBe(true);
    await v.cleanup();
  });
});
