/**
 * The booking details screen and a booking's dogs (friends & family, owner
 * request 2026-09-28). Mounted, not source-pinned: a clean build is not a
 * working screen.
 *
 * Each dog shows its own family and where it is; a friend's dog says who pays;
 * prices are the ones the server stored (the configured multi-dog discount at
 * the paying family's rates — never a built-in 50%), and cancelled dogs are
 * not counted. Staff can add a dog (only with the switch on and the
 * permission), take one out, and close the group's one bill.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import BookingDetailModal from "./BookingDetailModal";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() }, formatErr: (e) => String(e) }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("./CareLogStrip", () => () => null);
jest.mock("./CheckoutModal", () => ({
  CancelBookingModal: ({ booking, onClose }) => (
    <button data-testid="stub-cancel" data-booking={booking.id} onClick={onClose}>cancel</button>),
}));
let mockAuth;
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const FF = { group_id: "g-1", bill_to_client_id: "c-pat", bill_to_client_name: "Pat", group_kind: "friends_family",
             service_type: "daycare", date: "2026-09-28", status: "approved" };
const LUNA = { ...FF, id: "bk-luna", dog_id: "d-luna", dog_name: "Luna", client_id: "c-pat", client_name: "Pat",
               estimated_price: 30, pricing_snapshot: { group_dog_index: 0, group_dog_count: 2 }, created_at: "2026-09-20T10:00:00Z" };
const REX = { ...FF, id: "bk-rex", dog_id: "d-rex", dog_name: "Rex", client_id: "c-sam", client_name: "Sam",
              estimated_price: 24, multi_dog_discount: { pre_applied: true, amount: 6, label: "Buddy discount" },
              pricing_snapshot: { group_dog_index: 1, group_dog_count: 2 }, created_at: "2026-09-19T10:00:00Z" };
const GONE = { ...FF, id: "bk-gone", dog_id: "d-gone", dog_name: "Milo", client_id: "c-pat", client_name: "Pat",
               status: "cancelled", estimated_price: 15, pricing_snapshot: { group_dog_index: 2 } };
// The catalog says $40 — a built-in 50% would show $60 for the two; the server stored $30 + $24.
const SERVICES = [{ id: "s-1", service_type: "daycare", base_price: 40, active: true }];

let container, root, groupRows, onChanged;

const respond = (url) => {
  if (url === "/bookings/bk-rex") return Promise.resolve({ data: REX });
  if (url === "/bookings/bk-lone") return Promise.resolve({ data: { ...LUNA, id: "bk-lone", group_id: null, bill_to_client_id: null,
                                                                  bill_to_client_name: null, group_kind: null } });
  if (url === "/bookings/group/g-1") return Promise.resolve({ data: { group_id: "g-1", bookings: groupRows } });
  if (url === "/services") return Promise.resolve({ data: SERVICES });
  if (url === "/dogs/options") return Promise.resolve({ data: [
    { id: "d-luna", name: "Luna", owner_id: "c-pat" }, { id: "d-rex", name: "Rex", owner_id: "c-sam" },
    { id: "d-bo", name: "Bo", owner_id: "c-kim" }, { id: "d-no", name: "Nope", owner_id: "c-bad" }] });
  if (url === "/clients/options") return Promise.resolve({ data: [
    { id: "c-pat", name: "Pat" }, { id: "c-sam", name: "Sam" }, { id: "c-kim", name: "Kim" },
    { id: "c-bad", name: "Bad", client_status: "rejected" }] });
  return Promise.resolve({ data: null });
};

beforeEach(() => {
  mockAuth = { can: () => true, features: { friends_family: true }, user: { role: "admin" } };
  groupRows = [REX, LUNA, GONE];
  onChanged = jest.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset(); api.post.mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (id = "bk-rex") => {
  await act(async () => {
    root = createRoot(container);
    root.render(<BookingDetailModal booking={{ id }} onClose={() => {}} onChanged={onChanged} />);
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

test("each dog shows its own family; the friend's dog says who pays", async () => {
  await mount();
  expect(q("booking-detail-paid-by").textContent).toContain("Paid by Pat");
  expect(q("booking-detail-dog-bk-rex").textContent).toMatch(/Rex.*Sam.*Friend's dog/);
  expect(q("booking-detail-dog-bk-luna").textContent).toContain("Pat");
  expect(q("booking-detail-dog-bk-gone")).toBeFalsy();
  expect(q("booking-detail-one-bill").textContent).toContain("Paid by Pat");
});

test("the prices are the ones the server stored, not a built-in 50%; cancelled dogs don't count", async () => {
  await mount();
  expect(container.textContent).toContain("Group of 2 dogs");
  expect(q("booking-detail-service-total").textContent).toContain("$54.00");
  expect(q("booking-detail-group-md-discount").textContent).toMatch(/Buddy discount.*\$6\.00/);
  // the dog paying the first-dog price is listed first, whatever was booked first
  const order = [...q("booking-detail-group-breakdown").querySelectorAll("[data-testid^='booking-detail-group-member-']")]
    .map((el) => el.getAttribute("data-testid"));
  expect(order).toEqual(["booking-detail-group-member-bk-luna", "booking-detail-group-member-bk-rex"]);
});

test("a dog can be added — any family's, never a rejected family's", async () => {
  api.post.mockResolvedValue({ data: { booking: { id: "bk-bo" }, group_id: "g-1", dog_count: 3 } });
  await mount();
  await click("booking-detail-add-dog");
  expect(q("group-dog-add-option-d-rex")).toBeFalsy();             // already on the booking
  expect(q("group-dog-add-option-d-no").disabled).toBe(true);      // family marked rejected
  await click("group-dog-add-option-d-bo");
  await click("group-dog-add-save");
  expect(api.post).toHaveBeenCalledWith("/bookings/bk-rex/group-dogs", { dog_id: "d-bo", addon_service_ids: [], override_vaccines: false });
  expect(onChanged).toHaveBeenCalled();
  expect(q("group-dog-add")).toBeFalsy();
});

test("a vaccine refusal offers the override, and only then sends it", async () => {
  api.post
    .mockRejectedValueOnce({ response: { data: { detail: "Bo's rabies vaccine has expired.", block: { code: "vaccine_expired", dog_id: "d-bo" } } } })
    .mockResolvedValueOnce({ data: { dog_count: 3 } });
  await mount();
  await click("booking-detail-add-dog");
  await click("group-dog-add-option-d-bo");
  await click("group-dog-add-save");
  expect(q("group-dog-add-error").textContent).toContain("rabies");
  await click("group-dog-add-override");
  expect(api.post.mock.calls[1][1]).toMatchObject({ dog_id: "d-bo", override_vaccines: true });
});

test("no adding without the switch, without the permission, or once a dog has gone home", async () => {
  mockAuth = { ...mockAuth, features: { friends_family: false } };
  await mount();
  expect(q("booking-detail-add-dog")).toBeFalsy();
  act(() => root.unmount());
  mockAuth = { can: (k) => k !== "friends_family_bookings", features: { friends_family: true }, user: { role: "admin" } };
  await mount();
  expect(q("booking-detail-add-dog")).toBeFalsy();
  act(() => root.unmount());
  mockAuth = { can: () => true, features: { friends_family: true }, user: { role: "admin" } };
  groupRows = [REX, { ...LUNA, status: "completed", checked_out_at: "2026-09-28T15:00:00Z" }];
  await mount();
  expect(q("booking-detail-add-dog")).toBeFalsy();
});

test("a lone booking can take a dog (it becomes a group)", async () => {
  await mount("bk-lone");
  expect(q("booking-detail-add-dog")).toBeTruthy();
});

test("taking a dog out is the normal cancel of that dog's visit, then the screen reloads", async () => {
  await mount();
  await click("booking-detail-remove-bk-rex");
  const stub = document.body.querySelector('[data-testid="stub-cancel"]');   // (on the page, above the details)
  expect(stub.getAttribute("data-booking")).toBe("bk-rex");
  await act(async () => { stub.click(); });
  await flush();
  expect(onChanged).toHaveBeenCalled();
});

test("the one bill can be closed now — after a warning — when a dog is waiting for it", async () => {
  groupRows = [REX, { ...LUNA, status: "completed", checked_out_at: "2026-09-28T15:00:00Z", group_bill_pending: true }];
  api.post.mockResolvedValue({ data: { id: "inv-1", client_name: "Pat", total: 30 } });
  await mount();
  expect(q("booking-detail-dog-bk-luna").textContent).toContain("waiting for the one bill");
  await click("booking-detail-close-bill");
  expect(q("booking-detail-close-bill-warning")).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  await click("booking-detail-close-bill");
  expect(api.post).toHaveBeenCalledWith("/bookings/group/g-1/close-bill");
  expect(q("booking-detail-bill-msg").textContent).toContain("$30.00");
});

// ------------------------------------------------------------- review fixes

test("the take-out dialog sits on the page, not inside the scrolling details", async () => {
  await mount();
  await click("booking-detail-remove-bk-rex");
  const stub = document.body.querySelector('[data-testid="stub-cancel"]');
  expect(stub.parentElement).toBe(document.body);
});

test("the first dog still booked pays the first-dog price once the full-price dog is taken out", async () => {
  const MILO = { ...REX, id: "bk-milo", dog_id: "d-milo", dog_name: "Milo", pricing_snapshot: { group_dog_index: 2 } };
  groupRows = [{ ...LUNA, status: "cancelled" }, REX, MILO];
  await mount();
  // Rex is promoted (server's group_rank.settle): $30 full + Milo $24 discounted
  expect(q("booking-detail-service-total").textContent).toContain("$54.00");
  expect(q("booking-detail-group-md-discount").textContent).toContain("$6.00");
});

test("an extra added after booking is on top of the stored price; a dog gone home shows what it was charged", async () => {
  const later = "2026-09-25T10:00:00Z";
  groupRows = [
    { ...LUNA, status: "completed", checked_out_at: "2026-09-28T15:00:00Z", actual_price: 42 },
    { ...REX, add_ons: [{ name: "Bath", price: 20, qty: 1, added_at: later }] },
  ];
  await mount();
  // Luna charged $42; Rex $24 stored + $20 bath added at check-in
  expect(q("booking-detail-service-total").textContent).toContain("$86.00");
});

test("adding a dog needs the booking and client permissions the server checks; a new family needs clients_edit", async () => {
  mockAuth = { can: (k) => k !== "booking_edit", features: { friends_family: true }, user: { role: "admin" } };
  await mount();
  expect(q("booking-detail-add-dog")).toBeFalsy();
  act(() => root.unmount());
  mockAuth = { can: (k) => k !== "clients_edit", features: { friends_family: true }, user: { role: "admin" } };
  await mount();
  await click("booking-detail-add-dog");
  expect(q("group-dog-add-new-friend")).toBeFalsy();
});

test("a refused 'close the bill' still reloads the booking", async () => {
  groupRows = [REX, { ...LUNA, status: "completed", checked_out_at: "2026-09-28T15:00:00Z", group_bill_pending: true }];
  api.post.mockRejectedValue({ response: { data: { detail: "No dog of this group is waiting to be billed." } } });
  await mount();
  const before = api.get.mock.calls.filter(([url]) => url === "/bookings/group/g-1").length;
  await click("booking-detail-close-bill");
  await click("booking-detail-close-bill");
  expect(q("booking-detail-bill-msg").textContent).toContain("No dog of this group");
  expect(api.get.mock.calls.filter(([url]) => url === "/bookings/group/g-1").length).toBe(before + 1);
});
