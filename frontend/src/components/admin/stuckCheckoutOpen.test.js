/* "May be stuck": Open opens the stuck-bookings window (audit #44).
 *
 * Open used to go to Today; the only way to the fixer was a second button on
 * the row. Now Open (and tapping the row) opens it for staff who can resolve
 * stuck bookings; others keep the normal Open. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockCan = () => true;
jest.mock("../../lib/auth", () => ({ useAuth: () => (mockCan ? { can: (k) => mockCan(k) } : null) }));
jest.mock("../../lib/api", () => ({
  api: {
    get: jest.fn(() => Promise.resolve({ data: [{ id: "b1", dog_name: "Luna", client_name: "Dana", service_type: "daycare", date: "2026-09-20" }] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
  },
  formatErr: (e) => String(e),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../../lib/api");
const ActionRow = require("./ActionRow").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const STUCK = { id: "stuck-checkout:1", kind: "stuck_checkout", priority: "urgent", title: "1 checked-in booking may be stuck",
  cta: { type: "open_screen", screen: "dashboard" } };

let container; let root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); api.get.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); mockCan = () => true; });

const mount = async (item, onOpen) => { await act(async () => { root.render(<ActionRow item={item} onOpen={onOpen} />); }); };

test("Open on 'may be stuck' opens the stuck-bookings window right there", async () => {
  const onOpen = jest.fn();
  await mount(STUCK, onOpen);
  await act(async () => { q("action-center-open-btn-stuck-checkout:1").click(); });
  await flush();
  expect(q("stuck-checkouts-modal")).not.toBeNull();
  expect(q("stuck-row-b1")).not.toBeNull();
  expect(api.get).toHaveBeenCalledWith("/admin/bookings/stuck-checkouts");
  expect(onOpen).not.toHaveBeenCalled();
  expect(q("stuck-checkout-resolve-btn")).toBeNull();   // one way in, not two buttons doing the same thing
});

test("tapping the row itself opens it too", async () => {
  await mount(STUCK, jest.fn());
  await act(async () => { q("action-center-open-stuck-checkout:1").click(); });
  await flush();
  expect(q("stuck-checkouts-modal")).not.toBeNull();
});

test("staff without booking edits, or outside the signed-in app, get the normal Open", async () => {
  for (const can of [(k) => k !== "booking_edit", null]) {
    mockCan = can;
    const onOpen = jest.fn();
    await mount(STUCK, onOpen);
    await act(async () => { q("action-center-open-btn-stuck-checkout:1").click(); });
    expect(onOpen).toHaveBeenCalled();
    expect(q("stuck-checkouts-modal")).toBeNull();
  }
});

test("every other item keeps its normal Open", async () => {
  const onOpen = jest.fn();
  await mount({ ...STUCK, id: "quote-request:1", kind: "quote_request" }, onOpen);
  await act(async () => { q("action-center-open-btn-quote-request:1").click(); });
  expect(onOpen).toHaveBeenCalled();
  expect(q("stuck-checkouts-modal")).toBeNull();
});
