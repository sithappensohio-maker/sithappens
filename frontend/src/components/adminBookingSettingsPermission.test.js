/**
 * Found live (2026-10-09) while verifying the Employee Portal's new Walk-In
 * button: AdminBookingModal's initial load fetched GET /settings alongside
 * /clients/options and /dogs/options in one Promise.all — a front-line
 * employee (front_desk, daycare_staff, boarding_staff — even a manager,
 * whose role-base lacks the "settings" key) gets a 403 on /settings (it's
 * gated by the real Settings-page permission), which failed the WHOLE
 * Promise.all, so the dog/client lists never rendered at all, even though
 * those two calls had already succeeded. The modal showed "No dogs on file"
 * and a raw "Missing permission: settings" error for an employee who had
 * every right to be there (booking_edit granted, walk-in button visible).
 *
 * Fix: read GET /settings/public instead — a genuinely public, no-auth
 * endpoint (backend/server.py fetch_public_settings) that already whitelists
 * every field this modal actually reads (kennels, closed_dates, booking_rules,
 * every multi_dog_discount_* field) for exactly this kind of booking-support
 * read, as opposed to the full gated /settings blob meant for the Settings
 * page itself.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import AdminBookingModal from "./AdminBookingModal";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : String(e?.detail || e || "")),
}));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./MultiDatePicker", () => () => null);
// A front-line employee: booking_edit is what gates whether this modal can
// even open (checked by the caller), but NOT "settings" — same shape as the
// real front_desk/daycare_staff/boarding_staff defaults, and even a manager.
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: (k) => k !== "settings", features: {}, user: { role: "employee" } }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENTS = [{ id: "c-pat", name: "Pat", client_status: "active", credits: 3 }];
const DOGS = [{ id: "d-luna", name: "Luna", breed: "Beagle", owner_id: "c-pat", vaccines: { rabies: "2030-01-01" } }];

let container, root;

const respond = (url) => {
  if (url === "/clients/options") return Promise.resolve({ data: CLIENTS });
  if (url === "/dogs/options") return Promise.resolve({ data: DOGS });
  // The gated admin-settings endpoint refuses a front-line employee, exactly
  // like the real require_admin_and_permission("settings") dependency does.
  if (url === "/settings") return Promise.reject({ response: { status: 403, data: { detail: "Missing permission: settings" } } });
  // The genuinely public endpoint this modal must use instead.
  if (url === "/settings/public") return Promise.resolve({ data: { kennels: [], closed_dates: [], booking_rules: {}, multi_dog_discount_core: {} } });
  if (url === "/services") return Promise.resolve({ data: [{ id: "svc-d", name: "Daycare", service_type: "daycare", active: true, is_default: true, base_price: 40 }] });
  if (url === "/programs") return Promise.resolve({ data: [] });
  if (url.endsWith("/service-prices")) return Promise.resolve({ data: { prices: {} } });
  if (url === "/services/addons") return Promise.resolve({ data: [] });
  if (url === "/bookings/conflicts") return Promise.resolve({ data: { conflicts: [] } });
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

test("an employee without the settings permission still sees the real dog/client list, not \"No dogs on file\"", async () => {
  await mount();
  // Quick Check-in pre-selects the first dog on load when the data loaded.
  const card = q("ab-dog-selected-card");
  expect(card).toBeTruthy();
  expect(card.textContent).toContain("Luna");
});

test("GET /settings is never called at all — only the public variant", async () => {
  await mount();
  const urls = api.get.mock.calls.map(([u]) => String(u));
  expect(urls).not.toContain("/settings");
  expect(urls).toContain("/settings/public");
});

test("no raw permission error banner is shown to an authorized employee", async () => {
  await mount();
  expect(container.textContent).not.toMatch(/missing permission/i);
});
