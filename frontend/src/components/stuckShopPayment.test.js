/**
 * A Shop payment the app couldn't record (money that arrived after its order
 * was cancelled — audit #62) shows in "Paid online, not recorded yet" as a
 * Shop order, with Refund and no Retry. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (d) => String(d || "") }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true }));
jest.mock("./PendingActionsPanel", () => ({ announcePendingActionsChanged: jest.fn() }));

const { api } = require("../lib/api");
const StuckOnlinePayments = require("./StuckOnlinePayments").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("a Shop payment paid after its order was cancelled can be refunded, not retried", async () => {
  api.get.mockResolvedValue({ data: { payments: [{
    id: "att-1", kind: "shop", order_number: "AB12CD34", invoice_number: "AB12CD34", invoice_id: null,
    amount: 20, client_name: "Sam Guest", reason_code: "paid_after_cancel",
    reason: "This payment arrived after the order was cancelled, and its items went back on sale.",
    can_retry: false, can_refund: true, can_close: false,
  }] } });
  api.post.mockResolvedValue({ data: { ok: true } });
  await act(async () => { root.render(<StuckOnlinePayments />); });
  await flush();
  const row = q("stuck-payment-att-1");
  expect(row.textContent).toContain("Shop order #AB12CD34");
  expect(row.textContent).not.toContain("Bill #");
  expect(q("stuck-payment-retry-att-1")).toBeFalsy();
  await act(async () => { q("stuck-payment-refund-att-1").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/admin/online-payments/stuck/att-1/refund");
});
