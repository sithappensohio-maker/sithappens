/* A photo order whose register sale went back shows as Refunded (audit #28).
 *
 * Mounted, not source-read: what matters is what the desk sees and can press.
 * A refunded order says Refunded and how much went back, and offers no Send,
 * no Mark ready and no print status; a part refund still shows what went
 * back but stays a normal paid order. Same createRoot/act harness as
 * bookingBlocks.test.js.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PhotoOrdersPanel } from "./EventPhotosPanel";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const ORDER = {
  order_number: "HOW-P0001", primary_contact: "Pat Order", email: "pat@example.com", package_name: "5 Digitals + 8x10",
  qty: 1, total: 64.05, list_total: 60, receipt_number: "3F2A9C1B", print: "8×10", digitals: 5, print_status: "pending",
};
const REFUNDED = { ...ORDER, id: "o-refunded", status: "refunded", refunded_amount: 64.05 };
const PART = { ...ORDER, id: "o-part", order_number: "HOW-P0002", status: "paid", refunded_amount: 10 };

let root, host;
// The panel loads on a zero-delay timer; let it run and its requests settle.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
beforeEach(async () => {
  api.get.mockReset();
  api.get.mockImplementation((url, opts) => {
    if (url.endsWith("/photo-orders/summary")) return Promise.resolve({ data: { orders: 2, revenue: 54.05, unpaid: 0, to_send: 1, sent: 0, refunded: 1, prints_pending: 1 } });
    if (url.endsWith("/photo-orders")) {
      const want = opts?.params?.status;
      const rows = [REFUNDED, PART].filter((o) => !want || want === "all" || o.status === want);
      return Promise.resolve({ data: { orders: rows, count: rows.length } });
    }
    return Promise.resolve({ data: {} });
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<PhotoOrdersPanel owner={{ id: "sp1", name: "Howl-O-Ween" }} base="/admin/photo-specials/sp1" can={() => true} />);
  });
  await settle();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const q = (id) => host.querySelector(`[data-testid="${id}"]`);

test("a refunded order says so, says what went back, and offers nothing to do", () => {
  expect(q("photo-order-status-o-refunded").textContent).toBe("Refunded");
  expect(q("photo-order-given-back-o-refunded").textContent).toContain("$64.05 given back");
  expect(q("photo-order-send-o-refunded")).toBeNull();
  expect(q("photo-order-ready-o-refunded")).toBeNull();
  expect(q("photo-order-print-o-refunded")).toBeNull();
  expect(q("photo-order-pay-o-refunded")).toBeNull();
  expect(q("photo-order-delete-o-refunded")).toBeNull();
  expect(q("photo-order-o-refunded").textContent).not.toContain("Print pending");  // nothing owed on it
});

test("a part refund stays a paid order that still goes out", () => {
  expect(q("photo-order-status-o-part").textContent).toBe("Paid");
  expect(q("photo-order-given-back-o-part").textContent).toContain("$10.00 given back");
  expect(q("photo-order-send-o-part")).not.toBeNull();
  expect(q("photo-order-print-o-part")).not.toBeNull();
  expect(q("photo-order-o-part").textContent).toContain("Print pending");
});

test("refunded orders have their own filter", async () => {
  await act(async () => { q("photo-filter-refunded").click(); });
  await settle();
  const last = api.get.mock.calls.filter(([u]) => u.endsWith("/photo-orders")).pop();
  expect(last[1].params.status).toBe("refunded");
  expect(q("photo-order-o-part")).toBeNull();
  expect(q("photo-order-o-refunded")).not.toBeNull();
});
