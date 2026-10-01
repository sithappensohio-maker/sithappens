/**
 * Pickup customers are told their order is ready (audit: "Pickup customers
 * aren't told their order is ready").
 *
 * The order page looked for a status word the server never sets, so it said
 * "Completed" while items were still being got ready and never said "Ready
 * for pickup"; it promised "we'll let you know" on orders with nothing to
 * collect. Staff now hear what happened to the customer's email.
 *
 * Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { pickupActionToast, pickupNote } from "../../lib/shopPolish";
import { OrderDetail } from "./ShopOrders";

jest.mock("../../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
global.IS_REACT_ACT_ENVIRONMENT = true;

const LEASH = { item_id: "li-1", kind: "product", ref_id: "p1", name: "Rope Leash", quantity: 2, unit_price: 20,
                line_subtotal: 40, line_total: 40, actions: [] };
const CARD = { item_id: "li-2", kind: "gift_card", ref_id: "gc", name: "Gift card", quantity: 1, unit_price: 25,
               line_subtotal: 25, line_total: 25, actions: [] };
const ORDER = { order_id: "abcdef12-0000", reference: "ABCDEF12", created_at: "2026-09-20T12:00:00Z", status: "paid",
                fulfillment_status: "fulfilled", subtotal: 40, tax_amount: 0, total: 40, lines: [LEASH] };

describe("which pickup note a customer sees", () => {
  test.each([
    [{ pickup_status: "preparing" }, "preparing"],
    [{ pickup_status: "ready_for_pickup" }, "ready"],
    [{ pickup_status: "picked_up" }, "picked_up"],
    [{ pickup_status: "not_applicable", lines: [CARD] }, null],
    [{ pickup_status: "preparing", refund_status: "full" }, null],
    [{ pickup_status: "preparing", lines: [{ ...LEASH, quantity_refunded: 2 }, CARD] }, null],
    [{ pickup_status: "preparing", status: "pending_payment" }, null],
    [{ pickup_status: null }, null],
  ])("%j → %s", (patch, expected) => {
    expect(pickupNote({ ...ORDER, ...patch })).toBe(expected);
  });
});

describe("what staff are told after pressing a pickup button", () => {
  test.each([
    ["retry_fulfillment", {}, "success", "Fulfillment retried"],
    ["mark_ready", { ready_email: { state: "sent", to: "dana@example.com" } }, "success", "Marked ready — we emailed dana@example.com"],
    ["mark_ready", { ready_email: { state: "queued", reason: "quiet_hours" } }, "success", "Marked ready — the email goes out when Quiet Hours end"],
    ["mark_ready", { ready_email: { state: "queued", reason: "retrying" } }, "success", "Marked ready — the email is queued and will retry"],
    ["mark_ready", { ready_email: { state: "skipped", reason: "refunded" } }, "success", "Marked ready — no email (nothing left to collect)"],
    ["mark_ready", { ready_email: { state: "no_email" } }, "notice", "Marked ready — no email could be sent, so please let them know"],
    ["mark_ready", { ready_email: { state: "failed" } }, "notice", "Marked ready — no email could be sent, so please let them know"],
    ["mark_ready", {}, "success", "Order updated"],
    ["mark_picked_up", {}, "success", "Order updated"],
  ])("%s %j", (action, data, level, message) => {
    expect(pickupActionToast(action, data)).toEqual({ level, message });
  });
});

let container, root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });
const mount = (el) => act(() => { root = createRoot(container); root.render(el); });
const note = () => document.querySelector('[data-testid="shop-order-pickup-note"]');

describe("the order page", () => {
  test("a ready order says so", () => {
    mount(<OrderDetail order={{ ...ORDER, pickup_status: "ready_for_pickup" }} onBack={() => {}} />);
    expect(note().textContent).toContain("Ready to collect at Sit Happens");
  });
  test("an order still being got ready promises an email, which now really comes", () => {
    mount(<OrderDetail order={{ ...ORDER, pickup_status: "preparing" }} onBack={() => {}} />);
    expect(note().textContent).toContain("We'll email you as soon as it's ready to collect");
  });
  test.each([
    ["nothing to collect", { pickup_status: "not_applicable", lines: [CARD] }],
    ["fully refunded", { pickup_status: "preparing", refund_status: "full" }],
    ["its items refunded", { pickup_status: "preparing", lines: [{ ...LEASH, quantity_refunded: 2 }] }],
    ["already collected", { pickup_status: "picked_up" }],
    ["not paid", { pickup_status: "preparing", status: "payment_failed" }],
  ])("no pickup promise when %s", (_why, patch) => {
    mount(<OrderDetail order={{ ...ORDER, ...patch }} onBack={() => {}} />);
    expect(note()).toBeNull();
  });
});
