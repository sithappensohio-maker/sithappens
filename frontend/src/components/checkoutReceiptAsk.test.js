/**
 * "Print a receipt?" at checkout (owner, 2026-11-10: "make the receipt
 * printing a yes or no in case someone doesn't want one, no need to waste
 * paper").
 *
 * Mounted: the point is what the printer is (not) told after a real
 * checkout response, which a source-pinned test cannot show.
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
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));

const { api } = require("../lib/api");
const posAgent = require("../lib/posAgent");
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-1", date: "2026-09-19",
  status: "checked_in", estimated_price: 40, unit_price: 40,
};
const SERVICES = [
  { id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true },
];

let container, root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
  await flush();
};

const checkOut = async (response) => {
  api.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [BOOKING] } });
    if (u.includes("money-modifier-preview")) return Promise.resolve({ data: { sales_tax: { enabled: false }, tipping: { enabled: false } } });
    if (u.includes("/pos/catalog")) return Promise.resolve({ data: { items: [] } });
    if (u.includes("discount-preview")) return Promise.resolve({ data: { eligible: false, preview_base_price: 40, discount: null } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockImplementation((path) => {
    if (String(path).includes("/check-out")) return Promise.resolve({ data: response });
    if (String(path).includes("/pos-tokens")) return Promise.resolve({ data: { print_receipt_token: "tok-fresh" } });
    return Promise.resolve({ data: {} });
  });
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={BOOKING} services={SERVICES} onClose={() => {}} />);
  });
  await flush();
  await click("confirm-checkout");
};

const PAID = { pos_invoice_id: "inv-1", pos_print_receipt_token: "tok-print", pos_open_drawer_token: "tok-drawer" };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.post.mockReset();
  posAgent.printReceipt.mockReset();
  posAgent.openDrawer.mockReset();
  posAgent.printReceipt.mockResolvedValue({ ok: true });
  posAgent.openDrawer.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

test("after checkout the receipt is asked about, not printed — the drawer still opens", async () => {
  await checkOut(PAID);
  expect(q("hw-print-ask")).toBeTruthy();
  expect(posAgent.printReceipt).not.toHaveBeenCalled();
  expect(posAgent.openDrawer).toHaveBeenCalledWith("tok-drawer");
  expect(q("hw-reprint")).toBeFalsy();              // one print control at a time
});

test("No receipt prints nothing and leaves Print Receipt for a change of mind", async () => {
  await checkOut(PAID);
  await click("hw-print-no");
  expect(posAgent.printReceipt).not.toHaveBeenCalled();
  expect(q("hw-print-ask")).toBeFalsy();
  expect(q("hw-print-status")).toBeFalsy();          // no "printed"/"failed" line for a receipt nobody asked for
  expect(q("hw-reprint").textContent).toContain("Print Receipt");
  await click("hw-reprint");
  expect(posAgent.printReceipt).toHaveBeenCalledWith("tok-fresh");
});

test("Yes prints the receipt, and any goods receipt with it, once each", async () => {
  await checkOut({ ...PAID, pos_extra_print_receipt_tokens: ["tok-goods"] });
  await click("hw-print-yes");
  expect(posAgent.printReceipt.mock.calls.map(([t]) => t)).toEqual(["tok-print", "tok-goods"]);
  expect(q("hw-print-ask")).toBeFalsy();
  expect(q("hw-print-status").textContent).toContain("Receipt printed.");
  expect(q("hw-reprint").textContent).toContain("Reprint Receipt");
});

test("a failed print after Yes says so and offers a retry", async () => {
  posAgent.printReceipt.mockResolvedValue({ ok: false, error: "printer offline" });
  await checkOut(PAID);
  await click("hw-print-yes");
  expect(q("hw-print-status").textContent).toContain("printer offline");
  expect(q("hw-reprint").textContent).toContain("Retry Print");
});

test("with automatic printing off there is no question, only the Print Receipt button", async () => {
  await checkOut({ pos_invoice_id: "inv-1" });
  expect(q("hw-print-ask")).toBeFalsy();
  expect(posAgent.printReceipt).not.toHaveBeenCalled();
  expect(q("hw-reprint").textContent).toContain("Print Receipt");
});
