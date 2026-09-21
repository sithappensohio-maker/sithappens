/**
 * The Shop screens, actually mounted.
 *
 * Every other Shop test renders a component in isolation, and a green `vite
 * build` proves only that the modules parse. Neither catches the one thing
 * that has now bitten twice in this redesign: a function used in a component
 * that was never imported into it. That is not a syntax error and not a type
 * error — it is a ReferenceError thrown at render, which in this app means
 * the error boundary swallows the page and the customer sees "The dog ate
 * our homework".
 *
 * The real one: `ShopItemDetail`'s `ImgOrPlaceholder` called
 * `useShopMediaSrc` without importing it, so every product page crashed.
 * Found in a browser, not by a test. So: mount the screens, and assert they
 * render something rather than nothing.
 *
 * Deliberately shallow on content. These are smoke tests — the presentation
 * is pinned in shopRedesign.test.js, and duplicating that here would make
 * them brittle for no gain.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import PortalShop, { DetailDiscovery } from "./PortalShop";
import ShopItemDetail from "./ShopItemDetail";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CATALOG = {
  items: [
    { kind: "product", id: "p1", name: "Husky Rope Leash", price: 24,
      description: "Six feet of rope.", availability: "in_stock", in_stock: true,
      track_inventory: true, stock_on_hand: 9, guest_cart_allowed: true,
      category_id: "c1", category_name: "Gear", image_id: "img-1", image_ids: ["img-1"] },
    // A SECOND product with an image, returned as this page's recommendation.
    // The strip below the fold is where the original crash lived, and it only
    // renders an image for a suggestion that HAS one. Without this pair the
    // smoke test never reaches the code it was written to protect, which is
    // exactly what happened the first time.
    { kind: "product", id: "p2", name: "Trail Harness", price: 46,
      description: "Padded and reflective.", availability: "in_stock", in_stock: true,
      track_inventory: true, stock_on_hand: 4, guest_cart_allowed: true,
      category_id: "c1", category_name: "Gear", image_id: "img-2", image_ids: ["img-2"] },
    { kind: "credit_pack", id: "k1", name: "10 Daycare Visits", price: 280, qty: 10,
      display_quantity: 10, display_unit: "visits", service_type: "daycare",
      account_required: true },
    { kind: "training_program", id: "t1", name: "Reactive Recovery", price: 950,
      description: "For dogs that lunge.", helps_with: ["Lead reactivity"],
      format_count: 10, format_unit: "sessions", requires_dog: true,
      account_required: true, purchase_fulfillment: "credits_only" },
    { kind: "training_program", id: "t2", name: "Rock Solid Recall", price: 119,
      description: "Eight guided lessons.", helps_with: ["Recall"],
      format_count: 8, format_unit: "lessons", requires_dog: true,
      account_required: true, purchase_fulfillment: "online_school",
      // The shapes that actually come back and have crashed pages before.
      school_support: {}, school_onboarding: {}, lesson_count: 8, module_count: 3 },
    { kind: "gift_card", id: "gc-2500", name: "Gift card · $25", price: 25,
      guest_cart_allowed: true },
  ],
};

// By id, never by index — adding a fixture item silently repointed these
// once already.
const itemById = (id) => CATALOG.items.find((i) => i.id === id);

let container, root, errors;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  errors = [];
  jest.spyOn(console, "error").mockImplementation((...a) => errors.push(String(a[0])));
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url.includes("/catalog/taxonomy")) return Promise.resolve({ data: { categories: [], subcategories: [] } });
    if (url.includes("/catalog")) return Promise.resolve({ data: CATALOG });
    if (url.includes("/settings/public")) return Promise.resolve({ data: { shop_page: { public_shop_enabled: true, public_browsing_enabled: true } } });
    if (url.includes("/dogs")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
  console.error.mockRestore();
});

const mount = async (el) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter>{el}</MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

/** A ReferenceError at render is the specific failure this file exists for. */
const noReferenceErrors = () => {
  const bad = errors.filter((e) => /is not defined|is not a function/.test(e));
  expect(bad).toEqual([]);
};

describe("the Shop screens survive being rendered", () => {
  test("the guest storefront mounts and shows the shop", async () => {
    await mount(<PortalShop mode="guest" cart={[]} onCartChange={() => {}} onRequireAccount={() => {}} />);
    noReferenceErrors();
    expect(document.body.textContent).toContain("Shop Sit Happens");
    expect(document.querySelector('[data-testid="shop-landing"]')).toBeTruthy();
  });

  test("the signed-in storefront mounts", async () => {
    await mount(<PortalShop mode="authenticated" cart={[]} onCartChange={() => {}} />);
    noReferenceErrors();
    expect(document.querySelector('[data-testid="shop-landing"]')).toBeTruthy();
  });

  test("a department view mounts with its controls", async () => {
    window.history.pushState({}, "", "/shop?dept=gear");
    await mount(<PortalShop mode="guest" cart={[]} onCartChange={() => {}} onRequireAccount={() => {}} />);
    noReferenceErrors();
    expect(document.querySelector('[data-testid="shop-department-view"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="shop-search"]')).toBeTruthy();
    window.history.pushState({}, "", "/shop");
  });

  test("the product page mounts — the crash this file was written for", async () => {
    // ShopItemDetail's ImgOrPlaceholder called useShopMediaSrc without
    // importing it. Nothing failed until it rendered, and then the whole
    // page did. That helper is gone now and the strip below the fold is the
    // server-resolved recommendation row instead, so the mock answers the
    // discovery endpoint and the assertion follows it there — the point of
    // the test was never the helper, it was that the bottom of the page
    // actually renders.
    api.get.mockImplementation((url) => {
      if (url.includes("/shop/item/")) return Promise.resolve({ data: itemById("p1") });
      if (url.includes("/catalog")) return Promise.resolve({ data: CATALOG });
      return Promise.resolve({ data: {} });
    });
    api.post.mockImplementation((url) => {
      if (url.includes("/shop/discovery")) {
        return Promise.resolve({ data: {
          recommendations: [{ rel: "complements", label: "Pairs well with", item: itemById("p2") }],
          recently_viewed: [],
        } });
      }
      return Promise.resolve({ data: {} });
    });
    await mount(
      <ShopItemDetail kind="product" itemId="p1" cart={[]} onAddToCart={() => {}}
                      onBack={() => {}} allItems={CATALOG.items} onOpenItem={() => {}}
                      mode="guest" dogs={[]}
                      discoverySlot={<DetailDiscovery detail={{ kind: "product", id: "p1" }}
                                                      mode="guest" clientId={null}
                                                      cardProps={{ mode: "guest" }} />} />,
    );
    noReferenceErrors();
    expect(document.body.textContent).toContain("Husky Rope Leash");
    // Proof the strip under the product actually rendered, so the assertion
    // above covers the code below the fold rather than skipping it.
    expect(document.body.textContent).toContain("Trail Harness");
    expect(document.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  test("a training product page mounts and explains itself", async () => {
    api.get.mockImplementation((url) => {
      if (url.includes("/shop/item/")) return Promise.resolve({ data: itemById("t1") });
      return Promise.resolve({ data: CATALOG });
    });
    await mount(
      <ShopItemDetail kind="training_program" itemId="t1" cart={[]} onAddToCart={() => {}}
                      onBack={() => {}} allItems={CATALOG.items} onOpenItem={() => {}}
                      mode="guest" dogs={[]} />,
    );
    noReferenceErrors();
    expect(document.body.textContent).toContain("Reactive Recovery");
    // The department-aware detail blocks render from real fields only.
    expect(document.querySelector('[data-testid="pdp-facts"]')).toBeTruthy();
    expect(document.body.textContent).toContain("Lead reactivity");
  });

  test("a credit pack page mounts", async () => {
    api.get.mockImplementation((url) => {
      if (url.includes("/shop/item/")) return Promise.resolve({ data: itemById("k1") });
      return Promise.resolve({ data: CATALOG });
    });
    await mount(
      <ShopItemDetail kind="credit_pack" itemId="k1" cart={[]} onAddToCart={() => {}}
                      onBack={() => {}} allItems={CATALOG.items} onOpenItem={() => {}}
                      mode="guest" dogs={[]} />,
    );
    noReferenceErrors();
    expect(document.body.textContent).toContain("10 Daycare Visits");
  });
});

// ══════════════════════════ every department, mounted

describe("every department renders", () => {
  const DEPTS = ["gear", "training", "online_school", "prepaid", "gift_cards"];

  test.each(DEPTS)("the %s department mounts with its own layout", async (dept) => {
    window.history.pushState({}, "", `/shop?dept=${dept}`);
    await mount(<PortalShop mode="guest" cart={[]} onCartChange={() => {}} onRequireAccount={() => {}} />);
    noReferenceErrors();
    expect(document.querySelector('[data-testid="shop-department-view"]')).toBeTruthy();
    // Online School keeps its own storefront rather than a product grid, so
    // it is the one department without the grid — everything else has one.
    const grid = document.querySelector('[data-testid="shop-product-grid"]');
    if (dept !== "online_school") expect(grid).toBeTruthy();
    window.history.pushState({}, "", "/shop");
  });

  test("the old ?section= links still land somewhere real", async () => {
    window.history.pushState({}, "", "/shop?section=merch");
    await mount(<PortalShop mode="guest" cart={[]} onCartChange={() => {}} onRequireAccount={() => {}} />);
    noReferenceErrors();
    expect(document.querySelector('[data-testid="shop-department-view"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="shop-dept-gear"]').getAttribute("aria-current")).toBe("page");
    window.history.pushState({}, "", "/shop");
  });
});

// ══════════════════════════ every product page, mounted

describe("every kind of product page renders", () => {
  const openPdp = async (kind, id, mode = "guest", extra = {}) => {
    api.get.mockImplementation((url) => {
      if (url.includes("/shop/item/")) return Promise.resolve({ data: itemById(id) });
      if (url.includes("/catalog")) return Promise.resolve({ data: CATALOG });
      if (url.includes("/dogs")) return Promise.resolve({ data: extra.dogs || [] });
      return Promise.resolve({ data: {} });
    });
    await mount(
      <ShopItemDetail kind={kind} itemId={id} cart={[]} onAddToCart={() => {}}
                      onBack={() => {}} allItems={CATALOG.items} onOpenItem={() => {}}
                      mode={mode} dogs={extra.dogs || []} />,
    );
  };

  test("an Online School course page mounts despite the object-shaped fields", async () => {
    // school_support arrives as {} — truthy, and not a string. Rendering it
    // as a React child is what took this page down.
    await openPdp("training_program", "t2");
    noReferenceErrors();
    expect(document.body.textContent).toContain("Rock Solid Recall");
    expect(document.body.textContent).not.toContain("[object Object]");
  });

  test("a gift-card page mounts", async () => {
    await openPdp("gift_card", "gc-2500");
    noReferenceErrors();
    expect(document.body.textContent).toContain("Gift card");
  });

  test("an authenticated course page offers this client's dogs", async () => {
    await openPdp("training_program", "t2", "authenticated",
                  { dogs: [{ id: "d1", name: "Rex" }, { id: "d2", name: "Pepper" }] });
    noReferenceErrors();
    expect(document.querySelector('[data-testid="shop-detail-dog-d1"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="shop-detail-dog-d2"]')).toBeTruthy();
    expect(document.body.textContent).toContain("Rex");
  });
});

// ══════════════════════════════════════ the cart, in every state

describe("the cart renders in every state", () => {
  const CartPanel = require("./shop/ShopCart").default;
  const line = (id, extra = {}) => {
    const item = itemById(id);
    return { kind: item.kind, ref_id: item.id, quantity: 1, item, ...extra };
  };

  const show = async (props) => {
    await act(async () => {
      root = createRoot(container);
      root.render(<MemoryRouter><CartPanel
        onQtyChange={() => {}} onRemove={() => {}} onCheckout={() => {}}
        onClose={() => {}} onSignIn={() => {}} {...props} /></MemoryRouter>);
    });
  };

  test("a guest cart of gear", async () => {
    await show({ lines: [line("p1")], subtotal: 24, guestMode: true });
    noReferenceErrors();
    expect(document.querySelector('[data-testid="shop-checkout-button"]').disabled).toBe(false);
  });

  test("a mixed cart that needs an account", async () => {
    await show({ lines: [line("p1"), line("k1")], subtotal: 304, guestMode: true });
    noReferenceErrors();
    expect(document.querySelector('[data-testid="cart-account-required"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="shop-cart-line-"]')).toHaveLength(2);
  });

  test("an authenticated cart with a dog association", async () => {
    await show({ lines: [line("t2", { dog_id: "d1", dog_name: "Rex" })],
                 subtotal: 119, guestMode: false });
    noReferenceErrors();
    expect(document.querySelector('[data-testid="cart-line-dog"]').textContent).toContain("Rex");
    expect(document.querySelector('[data-testid="cart-account-required"]')).toBeNull();
  });

  test("a gift card in the cart names its recipient", async () => {
    await show({ lines: [line("gc-2500", { gift: { recipient_email: "nan@example.com", recipient_name: "Nan" } })],
                 subtotal: 25, guestMode: true });
    noReferenceErrors();
    expect(document.querySelector('[data-testid="cart-line-gift"]').textContent).toContain("Nan");
  });

  test("an empty cart", async () => {
    await show({ lines: [], subtotal: 0 });
    noReferenceErrors();
    expect(document.querySelector('[data-testid="shop-cart-empty"]')).toBeTruthy();
  });
});
