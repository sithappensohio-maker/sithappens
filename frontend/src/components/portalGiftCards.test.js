/**
 * Gift cards in the client portal.
 *
 * The rule this screen has to respect: it never grants anything. Every money
 * button only asks for a Stripe URL and hands the browser over. So these
 * tests care about what is SENT and where the browser is pointed — not about
 * balances changing, because nothing here can change one.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PortalGiftCards from "./PortalGiftCards";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => String(e?.response?.data?.detail || e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/goTo", () => ({ goTo: jest.fn() }));

const { api } = require("../lib/api");
const { toast } = require("sonner");
const { goTo } = require("../lib/goTo");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CARD = { code_display: "ABCD-EFGH-JKMN", balance: 42.5, status: "active",
               can_top_up: true };

let container, root, assigned;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockResolvedValue({ data: CARD });
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { checkout_url: "https://checkout.stripe.test/s/1" } });
  toast.error.mockReset();
  goTo.mockReset();
  assigned = goTo.mock.calls;
  // jsdom will not let a test redefine window.location, so the URL is moved
  // with history instead — which is also closer to what a browser does.
  window.history.replaceState({}, "", "/portal");
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

const mount = async () => {
  await act(async () => { root = createRoot(container); root.render(<PortalGiftCards />); });
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
};
const type = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const proto = el.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  await act(async () => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("it mounts", async () => {
  await mount();
  expect(q("portal-gift-cards")).toBeTruthy();
});

test("a customer can check what is left on a card", async () => {
  await mount();
  await type("portal-gift-code", "ABCD-EFGH-JKMN");
  await click("portal-gift-check");
  expect(api.get).toHaveBeenCalledWith("/portal/gift-cards/ABCD-EFGH-JKMN");
  expect(q("portal-gift-found").textContent).toContain("$42.50");
});

test("a code that is not a card says so", async () => {
  api.get.mockRejectedValue({ response: { data: { detail: "No gift card with that code." } } });
  await mount();
  await type("portal-gift-code", "NOPE");
  await click("portal-gift-check");
  expect(q("portal-gift-found")).toBeFalsy();
  expect(toast.error).toHaveBeenCalled();
});

test("checking with no code does not call the backend", async () => {
  await mount();
  await click("portal-gift-check");
  expect(api.get).not.toHaveBeenCalled();
});

test("adding money hands the browser to Stripe and grants nothing itself", async () => {
  await mount();
  await type("portal-gift-code", "ABCD-EFGH-JKMN");
  await click("portal-gift-check");
  await type("portal-gift-topup-amount", "50");
  await click("portal-gift-topup-go");
  expect(api.post).toHaveBeenCalledWith(
    "/portal/gift-cards/ABCD-EFGH-JKMN/topup-session",
    expect.objectContaining({ amount: 50 }));
  expect(goTo).toHaveBeenCalledWith("https://checkout.stripe.test/s/1");
});

test("every payment carries its own idempotency key", async () => {
  // Two clicks must not be able to look like one payment, or like three.
  await mount();
  await type("portal-gift-code", "ABCD-EFGH-JKMN");
  await click("portal-gift-check");
  await type("portal-gift-topup-amount", "50");
  await click("portal-gift-topup-go");
  await click("portal-gift-topup-go");
  const keys = api.post.mock.calls.map((c) => c[1].idempotency_key);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).not.toBe(keys[1]);
});

test("a card that cannot take money is not offered a top-up", async () => {
  api.get.mockResolvedValue({ data: { ...CARD, status: "voided", can_top_up: false } });
  await mount();
  await type("portal-gift-code", "ABCD-EFGH-JKMN");
  await click("portal-gift-check");
  expect(q("portal-gift-topup-go")).toBeFalsy();
  expect(q("portal-gift-found").textContent).toMatch(/cancelled/i);
});

test("a top-up with no amount does not start a payment", async () => {
  await mount();
  await type("portal-gift-code", "ABCD-EFGH-JKMN");
  await click("portal-gift-check");
  await click("portal-gift-topup-go");
  expect(api.post).not.toHaveBeenCalled();
  expect(goTo).not.toHaveBeenCalled();
});

test("a customer can buy a digital card for somebody", async () => {
  await mount();
  await click("portal-gift-buy-toggle");
  expect(q("portal-gift-buy-form").textContent).toMatch(/nothing to collect/i);
  await type("portal-gift-buy-amount", "40");
  await type("portal-gift-buy-email", "dana@example.com");
  await type("portal-gift-buy-name", "Dana");
  await type("portal-gift-buy-message", "Happy birthday");
  await click("portal-gift-buy-go");
  expect(api.post).toHaveBeenCalledWith("/portal/gift-cards/purchase-session",
    expect.objectContaining({
      amount: 40, recipient_email: "dana@example.com",
      recipient_name: "Dana", message: "Happy birthday",
    }));
  expect(goTo).toHaveBeenCalledWith("https://checkout.stripe.test/s/1");
});

test("buying without somewhere to send it is refused here, not at Stripe", async () => {
  await mount();
  await click("portal-gift-buy-toggle");
  await type("portal-gift-buy-amount", "40");
  await click("portal-gift-buy-go");
  expect(api.post).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

test("a failed start says so rather than looking like it worked", async () => {
  api.post.mockResolvedValue({ data: {} });   // no checkout_url
  await mount();
  await click("portal-gift-buy-toggle");
  await type("portal-gift-buy-amount", "40");
  await type("portal-gift-buy-email", "dana@example.com");
  await click("portal-gift-buy-go");
  expect(goTo).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

// ────────────────────── coming back from Stripe

test("the result is read from our records, not from the query string", async () => {
  // The browser can say anything. Only the server knows whether it was paid.
  window.history.replaceState({}, "", "/portal?gift_card_topup=att-1&stripe=success");
  api.get.mockResolvedValue({ data: { status: "applied", amount: 50,
                                      card: { balance: 92.5 } } });
  await mount();
  expect(api.get).toHaveBeenCalledWith("/portal/gift-card-attempts/att-1");
  expect(q("gift-outcome-done").textContent).toContain("$50.00");
  expect(q("gift-outcome-done").textContent).toContain("$92.50");
});

test("a success in the URL that the server has not confirmed does not claim success", async () => {
  window.history.replaceState({}, "", "/portal?gift_card_topup=att-1&stripe=success");
  api.get.mockResolvedValue({ data: { status: "pending", amount: 50 } });
  await mount();
  expect(q("gift-outcome-done")).toBeFalsy();
  expect(q("gift-outcome-pending")).toBeTruthy();
});

test("a payment that did not go through says nothing was charged", async () => {
  window.history.replaceState({}, "", "/portal?gift_card_purchase=att-9&stripe=cancel");
  api.get.mockResolvedValue({ data: { status: "expired", amount: 40 } });
  await mount();
  expect(q("gift-outcome-none").textContent).toMatch(/nothing was charged/i);
});

test("no attempt in the URL shows no result panel at all", async () => {
  await mount();
  expect(q("gift-outcome")).toBeFalsy();
});


test("a top-up that comes back with no payment URL says so too", async () => {
  // The buy path had this covered and the top-up path did not, which is
  // exactly the kind of gap a mutation finds and a passing suite hides.
  api.get.mockResolvedValue({ data: CARD });
  api.post.mockResolvedValue({ data: {} });   // no checkout_url
  await mount();
  await type("portal-gift-code", "ABCD-EFGH-JKMN");
  await click("portal-gift-check");
  await type("portal-gift-topup-amount", "50");
  await click("portal-gift-topup-go");
  expect(goTo).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});
