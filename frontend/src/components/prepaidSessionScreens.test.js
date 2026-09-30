/**
 * Audit #38 — a prepaid program session on the screens. Mounted.
 *
 * Checkout says plainly that the session was paid at the program sale, uses a
 * program credit and charges nothing (no "how to pay" choices); the cancel
 * window speaks of the program, not of refunds; the portal never says "Pay at
 * pickup" on a session that is already paid.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
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
const { CheckoutModal, CancelBookingModal } = require("./CheckoutModal");
const { upcomingPaymentNote } = require("../screens/Portal");

global.IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = {
  id: "bk-p", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana", service_type: "training",
  date: "2026-10-01", time: "10:00", status: "approved", actual_price: 0, payment_status: "paid", payment_method: "credits",
  is_prepaid_program_session: true, program_id: "p-1", credit_lot_id: "lot-1", checked_in_at: "2026-10-01T14:00:00Z",
};
const SERVICES = [{ id: "svc-t", name: "Private Lesson", service_type: "training", base_price: 90, active: true, is_default: true }];

let container, root, trainingCredits;
const respond = (url) => {
  if (url === "/clients/c-1") return Promise.resolve({ data: { id: "c-1", training_credits: trainingCredits } });
  if (url.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [SESSION] } });
  if (url.includes("money-modifier-preview")) return Promise.resolve({ data: { sales_tax: { enabled: false, rate_pct: 0 } } });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  trainingCredits = 3;
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset(); api.post.mockResolvedValue({ data: {} });
  api.delete.mockReset(); api.delete.mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const render = async (el) => { await act(async () => { root = createRoot(container); root.render(el); }); await flush(); };

test("checkout of a prepaid session: one program credit, nothing charged, no payment choices", async () => {
  await render(<CheckoutModal booking={SESSION} services={SERVICES} onClose={() => {}} />);
  expect(q("checkout-prepaid-note").textContent).toContain("uses one program credit (3 left). Nothing is charged.");
  expect(q("opt-use-credits")).toBeNull();
  expect(container.textContent).not.toContain("Base service");
  await act(async () => { q("confirm-checkout").click(); });
  await flush();
  const call = api.post.mock.calls.find(([url]) => String(url).endsWith("/bookings/bk-p/check-out"));
  expect(call).toBeTruthy();
  expect(call[1].use_credits).toBe(true);
});

test("with no program credit left nothing is shown as due and no money is sent", async () => {
  trainingCredits = 0;   // the catalogue's default lesson is $90 (SERVICES)
  await render(<CheckoutModal booking={SESSION} services={SERVICES} onClose={() => {}} />);
  expect(q("checkout-prepaid-note").textContent).toContain("No program credit is left, so this is recorded at $0");
  expect(container.textContent).not.toContain("Credit shortfall");
  expect(container.textContent).not.toContain("$90");
  expect(q("checkout-base-price")).toBeNull();
  await act(async () => { q("confirm-checkout").click(); });
  await flush();
  const body = api.post.mock.calls.find(([url]) => String(url).endsWith("/bookings/bk-p/check-out"))[1];
  expect(body.amount_paid).toBeUndefined();
  expect(body.base_price).toBeUndefined();
});

test("before the family's balance has loaded, nothing is shown as due either", async () => {
  api.get.mockImplementation((url) => (String(url) === "/clients/c-1" ? new Promise(() => {}) : respond(String(url))));
  await render(<CheckoutModal booking={SESSION} services={SERVICES} onClose={() => {}} />);
  expect(container.textContent).not.toContain("Credit shortfall");
  await act(async () => { q("confirm-checkout").click(); });
  await flush();
  const body = api.post.mock.calls.find(([url]) => String(url).endsWith("/bookings/bk-p/check-out"))[1];
  expect(body.amount_paid).toBeUndefined();
});

test("the cancel window speaks of the program, and cancels", async () => {
  const { checked_in_at, ...upcoming } = SESSION;   // eslint-disable-line no-unused-vars
  await render(<CancelBookingModal booking={upcoming} onClose={() => {}} />);
  expect(q("cancel-prepaid-session").textContent).toContain("the program credit stays with the family");
  expect(container.textContent).not.toContain("No money or credits attached yet");
  expect(q("cancel-refund").textContent).toContain("Cancel session");
  await act(async () => { q("cancel-refund").click(); });
  await flush();
  expect(api.delete).toHaveBeenCalledWith("/bookings/bk-p", expect.any(Object));
});

test("the portal never says to pay for a session already paid for", () => {
  const services = [{ id: "svc-t", service_type: "training", payment: { short: "Pay at pickup" } }];
  expect(upcomingPaymentNote({ status: "approved", service_type: "training", is_prepaid_program_session: true }, services))
    .toBe("Prepaid — part of your program");
  expect(upcomingPaymentNote({ status: "approved", service_type: "training" }, services)).toBe("Pay at pickup");
});
