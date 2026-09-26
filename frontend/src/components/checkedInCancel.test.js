/**
 * A dog that is checked in leaves by checkout. The staff cancel pop-up says
 * so, and only cancels once staff confirm the check-in was a mistake — which
 * asks the server to take the check-in back (recorded). Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
jest.mock("../lib/api", () => ({
  api: {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { baseURL: "/api" },
  },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn() }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("../lib/posAgent", () => ({ printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(() => Promise.resolve(true)) }));
jest.mock("../lib/theme", () => ({ useTheme: () => ({ branding: {} }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./ReceiptLogo", () => () => null);

const { api } = require("../lib/api");
const { CancelBookingModal } = require("./CheckoutModal");

global.IS_REACT_ACT_ENVIRONMENT = true;

const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", date: "2026-10-01", status: "approved", actual_price: 40,
};

let container; let root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); api.delete.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };

test("a checked-in dog can only be cancelled as a mistaken check-in", async () => {
  const onClose = jest.fn();
  act(() => root.render(<CancelBookingModal booking={{ ...BOOKING, checked_in_at: "2026-10-01T13:00:00+00:00" }} onClose={onClose} />));
  expect(q("cancel-on-site").textContent).toContain("Check out");
  expect(q("cancel-refund").disabled).toBe(true);
  expect(q("cancel-charge").disabled).toBe(true);
  await click(q("cancel-undo-check-in"));
  expect(q("cancel-refund").disabled).toBe(false);
  await click(q("cancel-refund"));
  expect(api.delete).toHaveBeenCalledWith("/bookings/bk-1", { params: { forfeit: "false", undo_check_in: "true" } });
  expect(onClose).toHaveBeenCalled();
});

test("a visit not checked in cancels as before", async () => {
  act(() => root.render(<CancelBookingModal booking={BOOKING} onClose={() => {}} />));
  expect(q("cancel-on-site")).toBeNull();
  await click(q("cancel-refund"));
  expect(api.delete).toHaveBeenCalledWith("/bookings/bk-1", { params: { forfeit: "false" } });
});

test("a checked-out visit is not treated as on site", () => {
  act(() => root.render(<CancelBookingModal booking={{ ...BOOKING, checked_in_at: "x", checked_out_at: "y" }} onClose={() => {}} />));
  expect(q("cancel-on-site")).toBeNull();
});

test("a dog checked in on another screen since the pop-up opened gets the take-back option", async () => {
  api.delete.mockRejectedValueOnce({ response: { data: {
    detail: "Luna is checked in right now. If Luna is going home, use Check out instead.",
    block: { code: "checked_in", action: "undo_check_in" } } } });
  act(() => root.render(<CancelBookingModal booking={BOOKING} onClose={() => {}} />));
  await click(q("cancel-refund"));
  expect(q("cancel-on-site")).not.toBeNull();
  expect(q("cancel-refund").disabled).toBe(true);
  await click(q("cancel-undo-check-in"));
  await click(q("cancel-refund"));
  expect(api.delete).toHaveBeenLastCalledWith("/bookings/bk-1", { params: { forfeit: "false", undo_check_in: "true" } });
});
