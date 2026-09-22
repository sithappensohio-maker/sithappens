/* What a Shopify product's price line actually renders.
 *
 * These mount the real card. The bug was never in a calculation — the number
 * was absent from the payload and `money(undefined)` filled the hole with
 * `$0.00`, so every piece of merch on the storefront looked free. A test that
 * only checked a helper would have passed throughout.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MerchCard } from "./ShopCards";
import { Price, priceProps } from "./ShopPrimitives";

jest.mock("../../lib/api", () => ({
  api: { get: jest.fn(() => Promise.resolve({ data: [] })), post: jest.fn(() => Promise.resolve({ data: {} })), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    text: () => host.textContent || "",
    testId: (id) => host.querySelector(`[data-testid="${id}"]`),
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

const shopifyItem = (over = {}) => ({
  kind: "product", id: "p1", name: "Shut Your Bark Hole Dog ID Tag",
  sales_destination: "shopify_external",
  shopify_product_url: "https://example.myshopify.com/products/tag",
  ...over,
});

const card = (item) => <MerchCard item={item} mode="client" onOpenDetail={() => {}} />;

describe("a Shopify product never claims to be free", () => {
  test("no price anywhere renders the Shopify pointer, not $0.00", () => {
    // Exactly the payload that produced the screenshot: price is simply absent.
    const w = mount(card(shopifyItem()));
    expect(w.text()).not.toMatch(/\$0\.00/);
    expect(w.testId("shop-price")).toBeNull();
    expect(w.testId("shop-price-unknown").textContent).toMatch(/view price on shopify/i);
    w.cleanup();
  });

  test("an explicit null price is still not zero", () => {
    const w = mount(card(shopifyItem({ price: null, shopify_price: { has_price: false, display: null } })));
    expect(w.text()).not.toMatch(/\$0\.00/);
    expect(w.testId("shop-price-unknown")).toBeTruthy();
    w.cleanup();
  });
});

describe("a Shopify product shows the price the server resolved", () => {
  test("single price", () => {
    const w = mount(card(shopifyItem({
      price: 24.99,
      shopify_price: { amount: 24.99, from_price: false, has_price: true, display: "$24.99" },
    })));
    expect(w.testId("shop-price").textContent).toBe("$24.99");
    expect(w.text()).not.toMatch(/From/);
    w.cleanup();
  });

  test("variants that differ read as a floor", () => {
    const w = mount(card(shopifyItem({
      price: 24.99,
      shopify_price: { amount: 24.99, from_price: true, has_price: true, display: "From $24.99" },
    })));
    expect(w.testId("shop-price").textContent).toBe("From $24.99");
    w.cleanup();
  });

  test("a client holding an older payload reads the flat fields rather than $0.00", () => {
    // shopify_price is absent (cached response from before the fix).
    const w = mount(card(shopifyItem({ shopify_display_price: 24.99, shopify_from_price: true })));
    expect(w.testId("shop-price").textContent).toBe("From $24.99");
    w.cleanup();
  });
});

describe("our own products are untouched", () => {
  test("an internal product still renders its price", () => {
    const w = mount(card({ kind: "product", id: "p2", name: "Lead", sales_destination: "internal", price: 18.5 }));
    expect(w.testId("shop-price").textContent).toBe("$18.50");
    w.cleanup();
  });

  test("a genuine zero is still a zero, because somebody entered it", () => {
    // Only a MISSING price is unknown. This is the line between the two.
    const w = mount(<Price amount={0} />);
    expect(w.testId("shop-price").textContent).toBe("$0.00");
    w.cleanup();
  });

  test("an unknown price with no label renders nothing rather than a number", () => {
    const w = mount(<Price amount={null} />);
    expect(w.text()).toBe("");
    w.cleanup();
  });
});

describe("priceProps decides once for every surface", () => {
  test("it prefers the server's resolved display", () => {
    expect(priceProps(shopifyItem({
      shopify_display_price: 9.99,
      shopify_price: { has_price: true, display: "From $24.99" },
    }))).toEqual({ display: "From $24.99" });
  });

  test("it refuses a zero or junk flat price instead of printing it", () => {
    expect(priceProps(shopifyItem({ shopify_display_price: 0 })).unknownLabel).toMatch(/shopify/i);
    expect(priceProps(shopifyItem({ shopify_display_price: "abc" })).unknownLabel).toMatch(/shopify/i);
  });

  test("internal products fall back to effective_price when price is absent", () => {
    expect(priceProps({ sales_destination: "internal", effective_price: 12 })).toEqual({ amount: 12 });
  });
});
