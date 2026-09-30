/**
 * Audit #37 — fixing a note on a finished visit sends nothing else new.
 *
 * Mounted, not source-read. The server now lets a note through on a visit
 * that is checked out or paid for, so the edit window must not invent
 * anything alongside it: blank times stay blank (no 9-to-5 defaults written
 * onto a finished visit, which a reopened checkout could turn into a late
 * fee), a Kennel Board spot stays put, and a Board & Train stay keeps its own
 * pickup date even if the program's length has changed since.
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

const CLIENTS = [{ id: "c-pat", name: "Pat", client_status: "active" }];
const DOGS = [{ id: "d-luna", name: "Luna", owner_id: "c-pat", vaccines: { rabies: "2030-01-01" } }];
const SERVICES = [
  { id: "svc-d", name: "Daycare", service_type: "daycare", active: true, is_default: true, base_price: 40 },
  { id: "svc-bt", name: "Board & Train", service_type: "training", active: true, package_program_id: "p-bt", base_price: 2100 },
];
const PROGRAMS = [{ id: "p-bt", type: "board_train", format: { count: 3, unit: "weeks" } }];   // now 3 weeks; booked as 2

let container, root;
const respond = (url) => {
  if (url === "/clients/options") return Promise.resolve({ data: CLIENTS });
  if (url === "/dogs/options") return Promise.resolve({ data: DOGS });
  if (url === "/settings") return Promise.resolve({ data: { kennels: [], closed_dates: [], booking_rules: {}, multi_dog_discount_core: {} } });
  if (url === "/services") return Promise.resolve({ data: SERVICES });
  if (url === "/programs") return Promise.resolve({ data: PROGRAMS });
  if (url.endsWith("/service-prices")) return Promise.resolve({ data: { prices: {} } });
  if (url === "/services/addons") return Promise.resolve({ data: [] });
  if (url === "/bookings/conflicts") return Promise.resolve({ data: { conflicts: [] } });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset(); api.post.mockResolvedValue({ data: {} });
  api.patch.mockReset(); api.patch.mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (existing) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminBookingModal existing={existing} onClose={() => {}} onCreated={() => {}} />);
  });
  await flush();
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const typeNote = async (text) => {
  const el = container.querySelector("textarea");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => { setter.call(el, text); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
};
const save = async () => { await act(async () => { q("ab-submit").click(); }); await flush(); };
const sent = () => api.patch.mock.calls[0][1];

test("a note on a finished daycare visit keeps its blank times and its Kennel Board spot", async () => {
  await mount({ id: "b1", dog_id: "d-luna", client_id: "c-pat", service_type: "daycare", service_id: "svc-d",
                date: "2026-09-01", dropoff_time: "", pickup_time: "", kennel: "A3", notes: "Old", status: "completed",
                checked_out_at: "2026-09-01T21:00:00Z" });
  await typeNote("Picked up by grandma");
  await save();
  expect(api.patch).toHaveBeenCalledWith("/bookings/b1", expect.any(Object));
  expect(sent()).toMatchObject({ notes: "Picked up by grandma", date: "2026-09-01", dropoff_time: "", pickup_time: "", kennel: "A3" });
});

test("stored times come back as they were", async () => {
  await mount({ id: "b2", dog_id: "d-luna", client_id: "c-pat", service_type: "daycare", service_id: "svc-d",
                date: "2026-09-01", dropoff_time: "07:30", pickup_time: "18:15", notes: "", status: "completed" });
  await typeNote("x");
  await save();
  expect(sent()).toMatchObject({ dropoff_time: "07:30", pickup_time: "18:15" });
});

test("a Board & Train stay keeps its own pickup date when only the note changes", async () => {
  await mount({ id: "b3", dog_id: "d-luna", client_id: "c-pat", service_type: "training", service_id: "svc-bt",
                date: "2026-08-01", end_date: "2026-08-15", notes: "", status: "completed",
                checked_out_at: "2026-08-15T21:00:00Z" });
  await typeNote("Graduated!");
  await save();
  expect(sent()).toMatchObject({ date: "2026-08-01", end_date: "2026-08-15", notes: "Graduated!" });
});
