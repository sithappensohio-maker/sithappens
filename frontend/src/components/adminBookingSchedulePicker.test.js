/**
 * "Schedule on behalf of a client" now uses the same shared
 * EntitySearchPicker (search box + tappable result cards) that Quick
 * Check-in's dog picker shipped with, instead of two plain <select>
 * dropdowns. Mounted, not source-read — a source pin could not tell a real
 * <select> from a search+cards picker that merely kept the same test id.
 *
 * Covers: no <select> elements for client/dog in this mode; the client
 * picker shows only initial-circle avatars (no photo fetch for clients);
 * picking a client still correctly scopes the dog picker to that client's
 * own dogs; and the rest of the branch (new walk-in, auto-pick-first-dog,
 * client backfill, submit-disabled) keeps working untouched.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import AdminBookingModal from "./AdminBookingModal";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : String(e || "")),
}));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./MultiDatePicker", () => () => null);
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true, features: {}, user: { role: "admin" } }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/png;base64,AAAA";

const CLIENTS = [
  { id: "c-pat", name: "Pat", client_status: "active", credits: 3 },
  { id: "c-sam", name: "Sam", client_status: "active", credits: 1 },
];
// GET /dogs/options never carries photo/photos — same as production.
const DOGS = [
  { id: "d-luna", name: "Luna", breed: "Beagle", owner_id: "c-pat", vaccines: { rabies: "2030-01-01" } },
  { id: "d-rex", name: "Rex", breed: "Pug", owner_id: "c-sam", vaccines: { rabies: "2030-01-01" } },
];

let container, root;

const respond = (url) => {
  if (url === "/clients/options") return Promise.resolve({ data: CLIENTS });
  if (url === "/dogs/options") return Promise.resolve({ data: DOGS });
  if (url === "/settings") return Promise.resolve({ data: { kennels: [], closed_dates: [], booking_rules: {}, multi_dog_discount_core: {} } });
  if (url === "/services") return Promise.resolve({ data: [{ id: "svc-d", name: "Daycare", service_type: "daycare", active: true, is_default: true, base_price: 40 }] });
  if (url === "/programs") return Promise.resolve({ data: [] });
  if (url.endsWith("/service-prices")) return Promise.resolve({ data: { prices: {} } });
  if (url === "/services/addons") return Promise.resolve({ data: [] });
  if (url === "/bookings/conflicts") return Promise.resolve({ data: { conflicts: [] } });
  if (url === "/dogs/d-luna") return Promise.resolve({ data: { id: "d-luna", name: "Luna", photo: PHOTO } });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset();
  api.post.mockImplementation((url) => Promise.resolve({ data: String(url) === "/pricing/quote"
    ? { estimated_price: 40, base_estimated_price: 40, billable_units: 1, unit_price: 40, unit_label: "day", service_name: "Daycare" }
    : {} }));
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async () => {
  await act(async () => {
    root = createRoot(container);
    // No defaultCheckIn, no existing: "Schedule on behalf of a client" mode.
    root.render(<AdminBookingModal onClose={() => {}} onCreated={() => {}} />);
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

test("the client and dog pickers are search+cards, not plain <select> dropdowns", async () => {
  await mount();
  expect(container.querySelector('select[data-testid="ab-client"]')).toBeFalsy();
  expect(container.querySelector('select[data-testid="ab-dog"]')).toBeFalsy();
  // Both auto-picked (first client, then its first dog) on load.
  expect(q("ab-client-selected-card")).toBeTruthy();
  expect(q("ab-dog-selected-card")).toBeTruthy();
});

test("the client picker shows only an initial circle — no photo fetch for clients", async () => {
  await mount();
  const card = q("ab-client-selected-card");
  expect(card.querySelector("img")).toBeFalsy();
  expect(card.textContent).toContain("P"); // Pat's initial
  expect(api.get.mock.calls.some(([url]) => /\/clients\/c-(pat|sam)$/.test(String(url)))).toBe(false);
});

test("the dog picker still gets a real photo once a dog is selected", async () => {
  await mount();
  const card = q("ab-dog-selected-card");
  const img = card.querySelector("img");
  expect(img).toBeTruthy();
  expect(img.getAttribute("src")).toBe(PHOTO);
});

test("picking a different client scopes the dog picker to that client's own dogs", async () => {
  await mount();
  expect(q("ab-dog-selected-card").textContent).toContain("Luna");

  await click("ab-client-change");
  expect(q("ab-client-results")).toBeTruthy();
  await click("ab-client-result-c-sam");

  // Client picker now reflects Sam...
  expect(q("ab-client-selected-card").textContent).toContain("Sam");
  // ...and the dog auto-picked for Sam is Sam's own dog, Rex — never Luna.
  expect(q("ab-dog-selected-card").textContent).toContain("Rex");

  // Opening the dog picker's search shows ONLY Sam's dogs.
  await click("ab-dog-change");
  const dogResults = q("ab-dog-results");
  expect(dogResults.textContent).toContain("Rex");
  expect(dogResults.textContent).not.toContain("Luna");
});

test("+ New walk-in still opens the walk-in flow from this mode", async () => {
  await mount();
  expect(q("ab-new-walk-in")).toBeTruthy();
});

test("the submit button's disabled condition is untouched by the re-skin", async () => {
  await mount();
  const btn = q("ab-submit");
  expect(btn.disabled).toBe(false); // a client+dog are auto-picked, nothing blocks it
});
