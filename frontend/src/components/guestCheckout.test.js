/**
 * Checking out with no account — the browser half.
 *
 * These MOUNT the real components. A component that imports cleanly and
 * builds green can still die the moment it renders, and reading its source
 * cannot tell you which — so every test here puts it on a page and then
 * checks what it does.
 *
 * The one rule being defended: the browser is not allowed to decide what
 * anything costs, or what a guest may buy. It asks, and it shows the answer.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import GuestCheckoutPanel from "./GuestCheckoutPanel";
import GuestOrderStatus from "../screens/GuestOrderStatus";
import { guestItemCta } from "../lib/shopPolish";
import {
  readGuestCart, writeGuestCart, clearGuestCart,
  rememberGuestOrderToken, guestOrderToken, isValidShopRedirectPath,
} from "../lib/shopGuestCart";

jest.mock("../lib/goTo", () => ({ goTo: jest.fn() }));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => String(e?.response?.data?.detail || e || ""),
}));

const { api } = require("../lib/api");
const { goTo } = require("../lib/goTo");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.post.mockReset();
  goTo.mockReset();
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

const mount = (el) => act(() => {
  root = createRoot(container);
  root.render(el);
});

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const byTestId = (id) => container.ownerDocument.querySelector(`[data-testid="${id}"]`);
const text = () => container.ownerDocument.body.textContent;

const CART = [{ kind: "product", ref_id: "p1", quantity: 2 }];
const GIFT_CART = [{ kind: "gift_card", ref_id: "gc-2500", quantity: 1 }];

const setField = (id, value) => act(async () => {
  const el = byTestId(id);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const PRICED = {
  data: {
    lines: [{ kind: "product", ref_id: "p1", name: "Leash", quantity: 2,
              unit_price: 12.5, line_subtotal: 25, line_total: 26.88 }],
    subtotal: 25, tax_amount: 1.88, tax_rate_pct: 7.5, total: 26.88,
  },
};

// ───────────────────────────────────────────── the card mirrors the server

describe("what a card offers a stranger", () => {
  test("it offers to add whatever the server said a guest may buy", () => {
    expect(guestItemCta({ kind: "product", price: 10, guest_cart_allowed: true }).type)
      .toBe("add_to_cart");
    // Gift cards are not products, and the old rule checked the kind — so a
    // gift card a guest is allowed to buy was offered a sign-in prompt.
    expect(guestItemCta({ kind: "gift_card", price: 25, guest_cart_allowed: true }).type)
      .toBe("add_to_cart");
  });

  test("it never offers to add what the server refused", () => {
    expect(guestItemCta({ kind: "product", price: 10, guest_cart_allowed: false }).type)
      .toBe("sign_in");
    expect(guestItemCta({ kind: "credit_pack", price: 99, account_required: true }).type)
      .toBe("sign_in");
  });

  test("a price the guest cannot see is a sign-in for pricing, not a refusal", () => {
    expect(guestItemCta({ kind: "product", guest_cart_allowed: false }).type).toBe("hidden_price");
  });
});

// ─────────────────────────────────────────────────── what the cart may hold

describe("the guest cart in localStorage", () => {
  test("a gift card survives with the person it is for", () => {
    writeGuestCart([{
      kind: "gift_card", ref_id: "gc-2500", quantity: 1,
      gift: { recipient_email: "nan@example.com", recipient_name: "Nan", gift_message: "xx" },
    }]);
    const [line] = readGuestCart();
    expect(line.kind).toBe("gift_card");
    expect(line.gift.recipient_email).toBe("nan@example.com");
  });

  test("a price is never kept, however it is handed in", () => {
    writeGuestCart([{ kind: "product", ref_id: "p1", quantity: 1, price: 999, name: "Free Leash", in_stock: true }]);
    const [line] = readGuestCart();
    expect(line).toEqual({ kind: "product", ref_id: "p1", quantity: 1 });
    // Read the raw store, not the getter: a getter that filtered on the way
    // OUT would pass this while the price sat in localStorage all along.
    const stored = JSON.parse(localStorage.getItem("sh_guest_cart"));
    expect(stored.version).toBe(1);
    expect(stored.lines[0].price).toBeUndefined();
  });

  test("a tampered line is dropped rather than trusted", () => {
    localStorage.setItem("sh_guest_cart", JSON.stringify([
      { kind: "product", ref_id: "ok", quantity: 1 },
      { kind: "nonsense", ref_id: "x", quantity: 1 },
      { kind: "product", ref_id: "neg", quantity: -5 },
      { kind: "product", ref_id: "frac", quantity: 1.5 },
    ]));
    expect(readGuestCart()).toEqual([{ kind: "product", ref_id: "ok", quantity: 1 }]);
  });

  test("clearing means clearing", () => {
    writeGuestCart(CART);
    clearGuestCart();
    expect(readGuestCart()).toEqual([]);
  });

  test("a redirect path is an allowlist, not a free-form url", () => {
    expect(isValidShopRedirectPath("/shop")).toBe(true);
    expect(isValidShopRedirectPath("/shop/item/gift_card/gc-2500")).toBe(true);
    expect(isValidShopRedirectPath("https://evil.example.com")).toBe(false);
    expect(isValidShopRedirectPath("//evil.example.com")).toBe(false);
    expect(isValidShopRedirectPath("/admin")).toBe(false);
  });
});

describe("remembering a guest order token", () => {
  test("it comes back for the order it belongs to, and nothing else", () => {
    rememberGuestOrderToken("order-1", "tok-1");
    expect(guestOrderToken("order-1")).toBe("tok-1");
    expect(guestOrderToken("order-2")).toBeNull();
  });

  test("it does not grow forever on a shared machine", () => {
    for (let i = 0; i < 40; i += 1) rememberGuestOrderToken(`o${i}`, `t${i}`);
    expect(Object.keys(JSON.parse(localStorage.getItem("sh_guest_order_tokens"))).length)
      .toBeLessThanOrEqual(20);
    expect(guestOrderToken("o39")).toBe("t39");
  });
});

// ───────────────────────────────────────────────── the checkout panel

describe("the guest checkout panel", () => {
  test("it shows the total the SERVER worked out, not one it added up", async () => {
    api.post.mockResolvedValue(PRICED);
    mount(<GuestCheckoutPanel cart={CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    expect(api.post).toHaveBeenCalledWith("/public/shop/cart/price", { items: expect.any(Array) });
    expect(byTestId("guest-checkout-total").textContent).toBe("$26.88");
    expect(text()).toContain("$1.88");
  });

  test("the lines add up to the subtotal printed under them", async () => {
    // They did not: each line showed line_total, which already carries that
    // line's share of the tax, above a tax-EXCLUSIVE subtotal and a separate
    // tax row. On screen the tax appeared twice and the arithmetic looked
    // broken. Caught in a browser, not by a test — hence this one.
    api.post.mockResolvedValue(PRICED);
    mount(<GuestCheckoutPanel cart={CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    const summary = byTestId("guest-checkout-summary").textContent;
    expect(summary).toContain("$25.00");     // the line, before tax
    expect(summary).toContain("$1.88");      // tax, once
    expect(summary).toContain("$26.88");     // and the total
    expect(summary.match(/\$26\.88/g)).toHaveLength(1);
  });

  test("it sends no price, no total and no tax — only what is in the basket", async () => {
    api.post.mockResolvedValue(PRICED);
    mount(<GuestCheckoutPanel cart={CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    const [, body] = api.post.mock.calls[0];
    expect(Object.keys(body)).toEqual(["items"]);
    for (const line of body.items) {
      expect(Object.keys(line).sort()).toEqual(
        ["gift_message", "kind", "quantity", "recipient_email", "recipient_name", "ref_id"]);
    }
  });

  test("paying is refused until the email looks like one", async () => {
    api.post.mockResolvedValue(PRICED);
    mount(<GuestCheckoutPanel cart={GIFT_CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    expect(byTestId("guest-checkout-pay").disabled).toBe(true);
    await setField("guest-checkout-email", "not-an-email");
    expect(byTestId("guest-checkout-pay").disabled).toBe(true);
    await setField("guest-checkout-email", "buyer@example.com");
    expect(byTestId("guest-checkout-pay").disabled).toBe(false);
  });

  test("merchandise cannot be paid for without a name to hand it to", async () => {
    // Nothing is posted — it is collected in person. An email alone leaves
    // the desk with a paid order and nobody to give it to. (The server
    // refuses this too; the form just says so earlier.)
    api.post.mockResolvedValue(PRICED);
    mount(<GuestCheckoutPanel cart={CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    await setField("guest-checkout-email", "buyer@example.com");
    expect(byTestId("guest-checkout-pay").disabled).toBe(true);
    expect(byTestId("guest-checkout-pickup-note")).toBeTruthy();
    await setField("guest-checkout-name", "Sam Guest");
    expect(byTestId("guest-checkout-pay").disabled).toBe(false);
  });

  test("a gift card asks for no name and no phone, because nobody collects it", async () => {
    api.post.mockResolvedValue(PRICED);
    mount(<GuestCheckoutPanel cart={GIFT_CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    expect(byTestId("guest-checkout-phone")).toBeNull();
    expect(byTestId("guest-checkout-pickup-note")).toBeNull();
    await setField("guest-checkout-email", "buyer@example.com");
    expect(byTestId("guest-checkout-pay").disabled).toBe(false);
  });

  test("a refused cart promises the cart will still be there", async () => {
    // The thing a shopper is actually worried about when told to sign in.
    const err = new Error("403");
    err.response = { status: 403, data: { detail_object: { blocked: [
      { kind: "credit_pack", ref_id: "pk1", reason: "Prepaid visits are added to your account balance, so you'll need to sign in first." },
    ] } } };
    api.post.mockRejectedValue(err);
    mount(<GuestCheckoutPanel cart={[{ kind: "credit_pack", ref_id: "pk1", quantity: 1 }]}
                              onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    expect(byTestId("guest-checkout-blocked").textContent).toMatch(/cart stays as it is/i);
  });

  test("a refused basket is explained line by line, with both ways out", async () => {
    const err = new Error("403");
    err.response = {
      status: 403,
      data: {
        detail: "Some items in your cart need an account.",
        detail_object: {
          message: "Some items in your cart need an account.",
          blocked: [{ kind: "credit_pack", ref_id: "pk1",
                      reason: "Prepaid visits are added to your account balance, so you'll need to sign in first." }],
        },
      },
    };
    api.post.mockRejectedValue(err);
    const removed = [];
    mount(<GuestCheckoutPanel cart={[{ kind: "credit_pack", ref_id: "pk1", quantity: 1 }]}
                              onClose={() => {}} onSignIn={() => {}}
                              onRemoveLines={(l) => removed.push(...l)} />);
    await flush();
    expect(byTestId("guest-checkout-blocked")).toBeTruthy();
    expect(text()).toContain("Prepaid visits are added to your account balance");
    expect(byTestId("guest-checkout-sign-in")).toBeTruthy();
    await act(async () => { byTestId("guest-checkout-drop-blocked").click(); });
    expect(removed).toEqual([{ kind: "credit_pack", ref_id: "pk1" }]);
  });

  test("the token is kept BEFORE the browser leaves for Stripe", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/public/shop/cart/price") return Promise.resolve(PRICED);
      // By the time checkout resolves, the page is about to navigate — if
      // the token were stored after the redirect it would never be stored.
      return Promise.resolve({ data: {
        url: "https://checkout.stripe.com/x", order_id: "ord-9", guest_token: "tok-9" } });
    });
    mount(<GuestCheckoutPanel cart={CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    await setField("guest-checkout-email", "buyer@example.com");
    await setField("guest-checkout-name", "Sam Guest");
    await act(async () => { byTestId("guest-checkout-pay").click(); });
    await flush();
    expect(guestOrderToken("ord-9")).toBe("tok-9");
    expect(goTo).toHaveBeenCalledWith("https://checkout.stripe.com/x");
    const [, body] = api.post.mock.calls.find(([u]) => u === "/public/shop/checkout");
    expect(body.email).toBe("buyer@example.com");
    expect(body.idempotency_key).toEqual(expect.any(String));
  });
});

// ──────────────────────────────────────────── the order page after Stripe

describe("the guest order page", () => {
  const renderOrder = (orderId, search) => {
    mount(
      <MemoryRouter initialEntries={[`/shop/order/${orderId}${search}`]}>
        <Routes><Route path="/shop/order/:orderId" element={<GuestOrderStatus />} /></Routes>
      </MemoryRouter>,
    );
  };

  test("with the token from the url it shows the order", async () => {
    api.get.mockResolvedValue({ data: {
      order_id: "ord-1", status: "paid", fulfillment_status: "fulfilled",
      pickup_status: "preparing", total: 26.88, email: "buyer@example.com",
      lines: [{ kind: "product", name: "Leash", quantity: 2, fulfillment_status: "fulfilled" }],
    } });
    renderOrder("ord-1", "?stripe=success&token=tok-1");
    await flush();
    // A header, so the token stays out of access logs and browser history.
    expect(api.get).toHaveBeenCalledWith("/public/shop/orders/ord-1",
                                         { headers: { "X-Guest-Token": "tok-1" } });
    expect(JSON.stringify(api.get.mock.calls[0])).not.toContain("params");
    expect(byTestId("guest-order-total").textContent).toBe("$26.88");
    expect(text()).toContain("buyer@example.com");
    expect(byTestId("guest-order-pickup")).toBeTruthy();
  });

  test("the url token is remembered, so a reload without it still works", async () => {
    api.get.mockResolvedValue({ data: { order_id: "ord-2", status: "paid", total: 5, lines: [] } });
    renderOrder("ord-2", "?token=tok-2");
    await flush();
    expect(guestOrderToken("ord-2")).toBe("tok-2");
  });

  test("with no token at all it asks nothing and says so", async () => {
    renderOrder("ord-3", "");
    await flush();
    expect(api.get).not.toHaveBeenCalled();
    expect(byTestId("guest-order-denied")).toBeTruthy();
  });

  test("a rejected token looks exactly like an order that isn't there", async () => {
    const err = new Error("404");
    err.response = { status: 404, data: { detail: "Order not found." } };
    api.get.mockRejectedValue(err);
    renderOrder("ord-4", "?token=wrong");
    await flush();
    expect(byTestId("guest-order-denied")).toBeTruthy();
    expect(text()).not.toContain("$");
  });

  test("a canceled checkout says nothing was charged", async () => {
    api.get.mockResolvedValue({ data: {
      order_id: "ord-5", status: "pending_payment", total: 10, lines: [] } });
    renderOrder("ord-5", "?stripe=cancel&token=tok-5");
    await flush();
    expect(text()).toContain("Nothing was charged");
  });
});

describe("paying twice by accident", () => {
  test("a double-tap is ONE checkout, not two orders", async () => {
    // A fresh key per click means the server sees two unrelated requests,
    // creates two orders and two Stripe sessions, and the loser sits there
    // holding stock nobody will pay for.
    api.post.mockImplementation((url) => (url === "/public/shop/cart/price"
      ? Promise.resolve(PRICED)
      : Promise.resolve({ data: { url: "https://checkout.stripe.com/x", order_id: "o", guest_token: "t" } })));
    mount(<GuestCheckoutPanel cart={CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    await setField("guest-checkout-email", "buyer@example.com");
    await setField("guest-checkout-name", "Sam Guest");
    const pay = byTestId("guest-checkout-pay");
    await act(async () => { pay.click(); pay.click(); });
    await flush();
    const keys = api.post.mock.calls
      .filter(([u]) => u === "/public/shop/checkout")
      .map(([, b]) => b.idempotency_key);
    expect(new Set(keys).size).toBe(1);
  });

  test("typing does not rotate the key mid-checkout", async () => {
    // It is re-created on every render unless it is held in a ref, and an
    // email field re-renders on every keystroke.
    api.post.mockImplementation((url) => (url === "/public/shop/cart/price"
      ? Promise.resolve(PRICED)
      : Promise.resolve({ data: { url: "https://x", order_id: "o", guest_token: "t" } })));
    mount(<GuestCheckoutPanel cart={CART} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
    await flush();
    await setField("guest-checkout-email", "buyer@example.com");
    await setField("guest-checkout-name", "Sam Guest");
    await act(async () => { byTestId("guest-checkout-pay").click(); });
    await flush();
    const first = api.post.mock.calls.find(([u]) => u === "/public/shop/checkout")[1].idempotency_key;
    expect(first).toEqual(expect.any(String));
    expect(first.length).toBeGreaterThan(8);
  });
});
