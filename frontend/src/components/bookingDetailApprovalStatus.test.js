/**
 * Two booking-details bugs reported together: (1) the status chip said
 * "Awaiting approval" even after a booking was approved, because it checked
 * a field (`booking.approved`) that never exists on a booking document —
 * only `booking.status` does; (2) a Meet & Greet showed "Service: Other"
 * with no sign of what the family is actually interested in.
 * Mounted, not source-pinned: a clean build is not a working screen.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import BookingDetailModal from "./BookingDetailModal";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() }, formatErr: (e) => String(e) }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("./CareLogStrip", () => () => null);
jest.mock("./CheckoutModal", () => ({ CancelBookingModal: () => null }));
let mockAuth;
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = { id: "bk-neo", dog_id: "d-neo", dog_name: "Neo", client_id: "c-jess", client_name: "Jessica Lee",
               service_type: "other", date: "2026-10-20", created_at: "2026-10-15T15:41:00Z" };

const respond = (booking) => (url) => {
  if (url === `/bookings/${booking.id}`) return Promise.resolve({ data: booking });
  if (url === "/services") return Promise.resolve({ data: [] });
  if (url === "/dogs/options") return Promise.resolve({ data: [] });
  if (url === "/clients/options") return Promise.resolve({ data: [] });
  return Promise.resolve({ data: null });
};

let container, root;

beforeEach(() => {
  mockAuth = { can: () => true, features: {}, user: { role: "admin" } };
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.post.mockReset(); api.post.mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (booking) => {
  api.get.mockImplementation((url) => respond(booking)(String(url)));
  await act(async () => {
    root = createRoot(container);
    root.render(<BookingDetailModal booking={{ id: booking.id }} onClose={() => {}} onChanged={() => {}} />);
  });
  await flush();
};

test("a pending booking still shows Awaiting approval", async () => {
  await mount({ ...BASE, status: "pending" });
  expect(container.textContent).toContain("Awaiting approval");
  expect(container.textContent).not.toContain("Scheduled");
});

test("an approved booking shows Scheduled, not stuck on Awaiting approval", async () => {
  await mount({ ...BASE, status: "approved", approved_at: "2026-10-16T09:00:00Z", approved_by_name: "Admin" });
  expect(container.textContent).toContain("Scheduled");
  expect(container.textContent).not.toContain("Awaiting approval");
});

test("a Meet & Greet shows what the family is interested in, not just Other", async () => {
  await mount({ ...BASE, status: "pending", is_meet_greet: true, interested_services: ["boarding", "grooming"] });
  expect(container.textContent).toContain("Interested in");
  expect(container.textContent).toContain("Boarding");
  expect(container.textContent).toContain("Grooming");
});
