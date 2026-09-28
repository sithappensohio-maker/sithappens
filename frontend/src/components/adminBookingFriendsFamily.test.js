/**
 * Booking dogs of different families together — friends & family (owner
 * request 2026-09-28). Mounted, not source-pinned.
 *
 * Only with the server's switch on and the permission; daycare and boarding.
 * Any family's dog can join (never a rejected family's); "Who pays?" picks
 * one of the families on the booking; the estimate is at the paying family's
 * rates with no prepaid credits; and a friend's dog not on file can be added
 * on the spot without changing the family the booking is for.
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
let mockAuth;
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
jest.mock("./WalkInModal", () => ({ friend, onCreated }) => (friend ? (
  <button data-testid="stub-new-friend" onClick={() => onCreated({
    client: { id: "c-new", name: "Nia", client_status: "walk_in" },
    dog: { id: "d-new", name: "Nova", owner_id: "c-new" } })}>make</button>) : null));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENTS = [{ id: "c-pat", name: "Pat", client_status: "active", credits: 9 },
                 { id: "c-sam", name: "Sam", client_status: "prospect" },
                 { id: "c-bad", name: "Bad", client_status: "rejected" }];
const DOGS = [{ id: "d-luna", name: "Luna", owner_id: "c-pat", vaccines: { rabies: "2030-01-01" } },
              { id: "d-rex", name: "Rex", owner_id: "c-sam", vaccines: { rabies: "2030-01-01" } },
              { id: "d-no", name: "Nope", owner_id: "c-bad" }];

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
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  mockAuth = { can: () => true, features: { friends_family: true }, user: { role: "admin" } };
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset();
  api.post.mockImplementation((url) => Promise.resolve({ data: String(url) === "/pricing/quote"
    ? { estimated_price: 30, base_estimated_price: 30, billable_units: 1, unit_price: 30, unit_label: "day", service_name: "Daycare" }
    : { group_id: "g-1", bookings: [] } }));
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminBookingModal presetClientId="c-pat" onClose={() => {}} onCreated={() => {}} />);
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
const choose = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
};
const groupBody = () => (api.post.mock.calls.find(([url]) => url === "/bookings/group") || [])[1];

test("nothing about friends & family shows without the switch or the permission", async () => {
  mockAuth = { ...mockAuth, features: { friends_family: false } };
  await mount();
  expect(q("ab-ff-toggle")).toBeFalsy();
  expect(q("ab-multidog")).toBeFalsy();   // Pat has one dog: the same-family section stays hidden as before
  act(() => root.unmount());
  mockAuth = { can: (k) => k !== "friends_family_bookings", features: { friends_family: true } };
  await mount();
  expect(q("ab-ff-toggle")).toBeFalsy();
});

test("a friend's dog joins; the booking says who pays; a rejected family can't be picked", async () => {
  await mount();
  await click("ab-ff-toggle");
  const nope = [...q("ab-ff-add-dog").options].find((o) => o.value === "d-no");
  expect(nope.disabled).toBe(true);
  await choose("ab-ff-add-dog", "d-rex");
  expect(q("ab-extra-dog-select-0").value).toBe("d-rex");
  expect(q("ab-ff-one-bill").textContent).toContain("One bill to Pat");
  await click("ab-submit");
  const body = groupBody();
  expect(body.dogs.map((d) => d.dog_id)).toEqual(["d-luna", "d-rex"]);
  expect(body.payer_client_id).toBe("c-pat");
});

test("the other family can be the one paying", async () => {
  await mount();
  await click("ab-ff-toggle");
  await choose("ab-ff-add-dog", "d-rex");
  await click("ab-ff-payer-c-sam");
  await click("ab-submit");
  expect(groupBody().payer_client_id).toBe("c-sam");
});

test("the estimate is at the paying family's rates, with no prepaid credits", async () => {
  await mount();
  await click("ab-ff-toggle");
  await choose("ab-ff-add-dog", "d-rex");
  const quotes = api.post.mock.calls.filter(([url]) => url === "/pricing/quote").map(([, b]) => b);
  const last = quotes.slice(-2);
  expect(last.every((b) => b.client_id === "c-pat" && b.dog_id === undefined)).toBe(true);
  expect(q("admin-booking-estimate-credits")).toBeFalsy();
});

test("a friend's dog not on file is added on the spot; the booking stays Pat's", async () => {
  await mount();
  await click("ab-ff-toggle");
  await click("ab-ff-new-friend");
  await click("stub-new-friend");
  expect(q("ab-extra-dog-select-0").value).toBe("d-new");
  expect(q("ab-ff-payer-c-new")).toBeTruthy();
  await click("ab-submit");
  expect(groupBody().dogs.map((d) => d.dog_id)).toEqual(["d-luna", "d-new"]);
  expect(groupBody().payer_client_id).toBe("c-pat");
});

test("a family booking its own dogs together sends no payer", async () => {
  DOGS.push({ id: "d-bo", name: "Bo", owner_id: "c-pat" });
  try {
    await mount();
    await click("ab-add-dog");
    await click("ab-submit");
    expect(groupBody().payer_client_id).toBeUndefined();
  } finally {
    DOGS.pop();
  }
});

// ------------------------------------------------------------- review fixes

test("switching friends & family off takes the friends' dogs off the booking", async () => {
  await mount();
  await click("ab-ff-toggle");
  await choose("ab-ff-add-dog", "d-rex");
  await click("ab-ff-toggle");                        // off again
  expect(q("ab-extra-dog-0")).toBeFalsy();
  await click("ab-submit");
  expect(groupBody()).toBeUndefined();
  expect(api.post.mock.calls.some(([url]) => url === "/bookings")).toBe(true);
});

test("the service prices shown are the paying family's", async () => {
  await mount();
  await click("ab-ff-toggle");
  await choose("ab-ff-add-dog", "d-rex");
  await click("ab-ff-payer-c-sam");
  expect(api.get.mock.calls.some(([url]) => url === "/clients/c-sam/service-prices")).toBe(true);
});

test("the one paying is always a family with a dog on the booking", async () => {
  CLIENTS.push({ id: "c-gran", name: "Gran", client_status: "active" });
  try {
    await mount();
    await click("ab-ff-toggle");
    await choose("ab-ff-add-dog", "d-rex");
    await choose("ab-client", "c-gran");               // a family with no dog here
    await click("ab-submit");
    expect(["c-pat", "c-sam"]).toContain(groupBody().payer_client_id);
  } finally {
    CLIENTS.pop();
  }
});

test("with no friend's dog added it is an ordinary booking: the family's credits are shown", async () => {
  await mount();
  await click("ab-ff-toggle");
  expect(q("admin-booking-estimate-credits")).toBeTruthy();
});

test("a new family can only be added by someone who may create one", async () => {
  mockAuth = { can: (k) => k !== "clients_edit", features: { friends_family: true }, user: { role: "admin" } };
  await mount();
  await click("ab-ff-toggle");
  expect(q("ab-ff-new-friend")).toBeFalsy();
});
