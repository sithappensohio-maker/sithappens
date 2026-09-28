/**
 * Audit #36 — backing out of a bill's card page. Mounted, not source-pinned:
 * coming back through Stripe's cancel link tells the app (so the bill is free
 * to pay again at once) and reloads the bills.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : e ? JSON.stringify(e) : ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("./ReceiptLogo", () => ({ __esModule: true, default: () => null, fetchReceiptLogoDataUrl: () => Promise.resolve(null) }));

const { api } = require("../lib/api");
const { toast } = require("sonner");
const PortalInvoices = require("./PortalInvoices").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

let container; let root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.post.mockReset(); toast.mockReset(); toast.success.mockReset();
  api.get.mockResolvedValue({ data: { invoices: [], stripe_online_enabled: true } });
  window.history.replaceState({}, "", "/portal?stripe_attempt=att-1&stripe=cancel");
});
afterEach(() => { act(() => root.unmount()); container.remove(); window.history.replaceState({}, "", "/"); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const invoiceLoads = () => api.get.mock.calls.filter(([url]) => url === "/portal/invoices").length;

test("backing out tells the app, then reloads the bills", async () => {
  api.post.mockResolvedValue({ data: { status: "expired" } });
  act(() => root.render(<PortalInvoices />)); await flush();
  expect(api.post).toHaveBeenCalledWith("/portal/stripe-payment-attempts/att-1/cancel");
  expect(toast).toHaveBeenCalledWith("Payment canceled — nothing was charged.");
  expect(invoiceLoads()).toBe(2);
  expect(window.location.search).toBe("");
});

test("a payment that went through after all says so", async () => {
  api.post.mockResolvedValue({ data: { status: "applied" } });
  act(() => root.render(<PortalInvoices />)); await flush();
  expect(toast.success).toHaveBeenCalledWith("Payment successful!");
  expect(toast).not.toHaveBeenCalledWith("Payment canceled — nothing was charged.");
});

test("money Stripe took but the app hasn't recorded yet is never called 'nothing was charged'", async () => {
  api.post.mockResolvedValue({ data: { status: "pending", paid: true } });
  act(() => root.render(<PortalInvoices />)); await flush();
  expect(toast).toHaveBeenCalledWith("We received your payment and are finishing it up.");
  expect(toast).not.toHaveBeenCalledWith("Payment canceled — nothing was charged.");
});

test("if the app can't be reached the customer still hears nothing was charged", async () => {
  api.post.mockRejectedValue(new Error("offline"));
  act(() => root.render(<PortalInvoices />)); await flush();
  expect(toast).toHaveBeenCalledWith("Payment canceled — nothing was charged.");
  expect(invoiceLoads()).toBe(2);
});
