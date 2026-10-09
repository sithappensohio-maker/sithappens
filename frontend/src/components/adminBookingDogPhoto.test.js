/**
 * Real dog photos in the restyled AdminBookingModal (Option D).
 *
 * GET /dogs/options deliberately omits photo/photos (keeps the search list
 * light — see backend/domains/performance/routes.py). Once a dog is actually
 * on screen, the modal fires a lightweight GET /dogs/{id} follow-up and shows
 * that photo; a dog with no photo (or a failed fetch) must fall back to a
 * colored initial circle — never a broken image icon, never blank space.
 *
 * Mounted, not source-read: a source pin could not tell an <img> that
 * actually renders the right src from a broken one.
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
// GET /dogs/options never carries photo/photos — exactly like production.
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
  // The one-dog lightweight backfill — DogOut's full record. Luna has a real
  // photo on file; Rex (never uploaded one) comes back without one.
  if (url === "/dogs/d-luna") return Promise.resolve({ data: { id: "d-luna", name: "Luna", photo: PHOTO } });
  if (url === "/dogs/d-rex") return Promise.resolve({ data: { id: "d-rex", name: "Rex", photo: "" } });
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
    root.render(<AdminBookingModal defaultCheckIn onClose={() => {}} onCreated={() => {}} />);
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

test("a dog with a real photo on file shows it (not a placeholder) once selected", async () => {
  await mount();
  // Quick Check-in pre-selects the first dog on load — Luna.
  const card = q("ab-dog-selected-card");
  expect(card).toBeTruthy();
  const img = card.querySelector("img");
  expect(img).toBeTruthy();
  expect(img.getAttribute("src")).toBe(PHOTO);
});

test("a dog with no photo on file falls back to an initial circle, never a broken image", async () => {
  await mount();
  await click("ab-dog-change");          // back to search
  await click("ab-dog-result-d-rex");    // Rex has no photo
  const card = q("ab-dog-selected-card");
  expect(card).toBeTruthy();
  expect(card.querySelector("img")).toBeFalsy();
  expect(card.textContent).toContain("R");
});

test("the search results list never shows a broken image either, before any photo has loaded", async () => {
  await mount();
  await click("ab-dog-change");
  const results = q("ab-dog-results");
  expect(results.querySelector("img[src='']")).toBeFalsy();
  // Luna's row, photo not yet fetched for a dog only seen in the list (not
  // selected) — still gets the initial-circle fallback, never nothing.
  expect(q("ab-dog-result-d-rex").textContent).toContain("R");
});
