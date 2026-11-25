/* Stage 1 follow-up — which dog a booking is for is never guessed.
 *
 * Mounted rather than source-read, because the bug being pinned is
 * behavioural: `dogs[0]` — whichever dog happened to sort first
 * alphabetically — was silently pre-selected, so a customer who skims lands
 * on the review screen having booked for a dog they never chose.
 *
 * Follows the same createRoot/act harness as shopScreensMount.test.js; this
 * project does not use @testing-library.
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
// The wizard reads branding + feature flags from context; outside the app
// shell those providers are absent, so stub them rather than mounting the
// whole portal just to exercise one dropdown.
jest.mock("../lib/theme", () => ({
  useTheme: () => ({ branding: { payment_options: [] } }),
  useFeature: () => true,
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const DAYCARE = {
  id: "svc-day", name: "Daycare (per day)", service_type: "daycare", base_price: 40, active: true,
  books_as: "approved",
  booking_flow: { instant_book: true, require_approval: false, client_booking_enabled: true },
};

const ROSIE = { id: "d-rosie", name: "Rosie", breed: "Border Collie" };
const TUCKER = { id: "d-tucker", name: "Tucker", breed: "Boxer" };

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/services") return Promise.resolve({ data: [DAYCARE] });
    if (url === "/services/addons") return Promise.resolve({ data: [] });
    if (url === "/bookings/time-slots") return Promise.resolve({ data: { slots: [] } });
    if (url === "/bookings/availability") return Promise.resolve({ data: { open_slots: 30, capacity: 30, vaccine_ok: true } });
    return Promise.resolve({ data: {} });
  });
});

async function mount(props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<PortalBookWizard dogs={[]} onClose={() => {}} onBooked={() => {}} {...props} />);
  });
  await act(async () => { await Promise.resolve(); });
  return {
    host,
    q: (testId) => host.querySelector(`[data-testid="${testId}"]`),
    text: () => host.textContent || "",
    cleanup: () => act(() => root.unmount()),
  };
}

describe("which dog a booking is for is never guessed", () => {
  test("one dog: selected automatically, and named on screen", async () => {
    const v = await mount({ dogs: [ROSIE] });
    expect(v.q("wiz-dog-only")).toBeTruthy();
    expect(v.q("wiz-dog-only").textContent).toMatch(/Rosie/);
    // Nothing to choose, so no chooser.
    expect(v.q("wiz-dog-picker")).toBeNull();
    // ...and the dog is not what is holding Next back.
    expect(v.q("wiz-step1-hint")?.textContent || "").not.toMatch(/choose a dog/i);
    await v.cleanup();
  });

  test("two dogs: nothing is pre-selected", async () => {
    const v = await mount({ dogs: [ROSIE, TUCKER] });
    const tiles = [ROSIE, TUCKER].map((d) => v.q(`wiz-dog-tile-${d.id}`));
    expect(tiles.every(Boolean)).toBe(true);
    // The regression: this used to be d-rosie purely because R < T.
    expect(tiles.map((t) => t.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(v.q("wiz-dog-count")).toBeNull();
    expect(v.text()).toMatch(/who is this booking for\?/i);
    // How to bring more than one dog is said out loud, on the first step.
    expect(v.q("wiz-dog-help").textContent).toMatch(/tap every dog that is coming\. you can pick more than one/i);
    await v.cleanup();
  });

  test("two dogs: Next is blocked and the reason is spoken", async () => {
    const v = await mount({ dogs: [ROSIE, TUCKER] });
    expect(v.q("wiz-step1-next").disabled).toBe(true);
    // A disabled control that explains nothing reads as a broken one.
    expect(v.q("wiz-step1-hint").textContent).toMatch(/choose a dog to continue/i);
    await v.cleanup();
  });

  test("two dogs: choosing, then switching, is honoured", async () => {
    const v = await mount({ dogs: [ROSIE, TUCKER] });
    const tap = (dog) => act(async () => { v.q(`wiz-dog-tile-${dog.id}`).click(); });
    const pressed = () => [ROSIE, TUCKER].map((d) => v.q(`wiz-dog-tile-${d.id}`).getAttribute("aria-pressed"));
    await tap(TUCKER);
    expect(pressed()).toEqual(["false", "true"]);
    expect(v.q("wiz-dog-count").textContent).toMatch(/Booking for Tucker/);
    // Both dogs on one booking, picked right here.
    await tap(ROSIE);
    expect(pressed()).toEqual(["true", "true"]);
    expect(v.q("wiz-dog-count").textContent).toMatch(/Booking for 2 dogs: Tucker & Rosie/);
    // Tapping a picked dog takes it off again — switching is not a one-way door.
    await tap(TUCKER);
    expect(pressed()).toEqual(["true", "false"]);
    expect(v.q("wiz-dog-count").textContent).toMatch(/Booking for Rosie/);
    await tap(ROSIE);
    expect(pressed()).toEqual(["false", "false"]);
    expect(v.q("wiz-step1-hint").textContent).toMatch(/choose a dog to continue/i);
    await v.cleanup();
  });

  test("a seeded dog (rebook, or the photography deep link) still wins", async () => {
    const v = await mount({ dogs: [ROSIE, TUCKER], seed: { dog_id: TUCKER.id } });
    expect(v.q(`wiz-dog-tile-${TUCKER.id}`).getAttribute("aria-pressed")).toBe("true");
    expect(v.q(`wiz-dog-tile-${ROSIE.id}`).getAttribute("aria-pressed")).toBe("false");
    await v.cleanup();
  });
});
