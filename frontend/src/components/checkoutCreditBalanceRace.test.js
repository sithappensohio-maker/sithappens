/**
 * Checking out a dog whose owner has credits on file used to let staff click
 * "Complete Check-out" before the client's credit balance had even finished
 * loading — the auto-select-credits effect, and the manual "pay with
 * credits" option, only exist once that fetch resolves, so a fast checkout
 * (e.g. check-in then check-out back to back, backfilling a forgotten
 * morning) could slip through on the plain cash path and land unpaid
 * instead of covered by credits, with no error and no sign anything was
 * wrong. The submit button now stays disabled until the balance is known.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CheckoutModal } from "./CheckoutModal";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn() }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("../lib/posAgent", () => ({ printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("./ReceiptLogo", () => () => null);
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Rex", client_id: "c-1", client_name: "Sam",
  service_type: "daycare", service_id: "svc-1", date: "2026-10-15",
  status: "checked_in", checked_in_at: "2026-10-15T12:00:00+00:00",
  estimated_price: 22, unit_price: 22,
};
const SERVICES = [
  { id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 22, active: true, is_default: true },
];

let container, root, resolveClient, rejectClient;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const posts = () => api.post.mock.calls.map(([path, body]) => ({ path, body }));
const checkoutBody = () => (posts().find((p) => String(p.path).includes("/check-out")) || {}).body;

const respond = (url) => {
  const u = String(url);
  if (u.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [BOOKING] } });
  if (u.includes("credit-lots")) return Promise.resolve({ data: [] });
  if (u.includes("service-prices")) return Promise.resolve({ data: {} });
  // Only the plain balance fetch (GET /clients/{id}) is held — not the other
  // /clients/ calls above, which must resolve immediately like any other test.
  if (/\/clients\/[^/]+$/.test(u)) {
    return new Promise((resolve, reject) => { resolveClient = resolve; rejectClient = reject; });
  }
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => respond(url));
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  resolveClient = null;
  rejectClient = null;
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

test("checkout stays disabled until the credit balance finishes loading, so a fast click can't skip it", async () => {
  await act(async () => { root = createRoot(container); root.render(<CheckoutModal booking={BOOKING} services={SERVICES} onClose={() => {}} />); });
  await flush();
  expect(q("confirm-checkout").disabled).toBe(true);

  await act(async () => { resolveClient({ data: { credits: 5, boarding_credits: 0, training_credits: 0, account_balance: 0 } }); });
  await flush();
  expect(q("confirm-checkout").disabled).toBe(false);

  await act(async () => { q("confirm-checkout").click(); });
  await flush();
  expect(checkoutBody().use_credits).toBe(true);
});

test("a failed balance fetch still clears the gate instead of blocking checkout forever", async () => {
  await act(async () => { root = createRoot(container); root.render(<CheckoutModal booking={BOOKING} services={SERVICES} onClose={() => {}} />); });
  await flush();
  expect(q("confirm-checkout").disabled).toBe(true);

  await act(async () => { rejectClient(new Error("network error")); });
  await flush();
  expect(q("confirm-checkout").disabled).toBe(false);
});
