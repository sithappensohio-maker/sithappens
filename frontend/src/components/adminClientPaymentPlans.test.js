/**
 * The plans screen sends one request per installment at a time, disables the buttons
 * while it is in flight, and says the reversal is a refund today (audit #69). Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import AdminClientPaymentPlans from "./AdminClientPaymentPlans";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const mockConfirm = jest.fn(async () => true);
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => mockConfirm }));
jest.mock("./RichTextEditor", () => () => null);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = {
  id: "plan-1", client_id: "c-1", status: "active", total_amount: 50, paid_total: 0, remaining_total: 50,
  installments: [{ id: "inst-1", amount: 50, status: "due", due_date: "2026-10-05" }],
};
const PAID_PLAN = { ...PLAN, paid_total: 50, remaining_total: 0, installments: [{ ...PLAN.installments[0], status: "paid", paid_method: "cash" }] };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mockConfirm.mockReset().mockImplementation(async () => true);
  api.get.mockReset().mockResolvedValue({ data: [PLAN] });
  api.post.mockReset().mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminClientPaymentPlans clientId="c-1" />);
  });
  await flush();
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("a double tap on a mark-paid button sends one request", async () => {
  await mount();
  await act(async () => { q("mark-paid-inst-1-cash").click(); q("mark-paid-inst-1-cash").click(); });
  await flush();
  const marks = api.post.mock.calls.filter(([path]) => String(path).includes("/mark-paid"));
  expect(marks.length).toBe(1);
});

test("the mark-paid buttons are disabled while a request is in flight", async () => {
  await mount();
  let release;
  api.post.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await act(async () => { q("mark-paid-inst-1-cash").click(); });
  await flush();
  expect(q("mark-paid-inst-1-cash").disabled).toBe(true);
  await act(async () => { release({ data: {} }); });
  await flush();
});

test("the reverse confirmation says the money is refunded today, not removed from the P&L", async () => {
  api.get.mockResolvedValue({ data: [PAID_PLAN] });
  await mount();
  await act(async () => { q("reverse-payment-inst-1").click(); });
  await flush();
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  const body = mockConfirm.mock.calls[0][0].body;
  expect(body).toContain("refunds the payment today");
  expect(body).not.toContain("P&L");
});
