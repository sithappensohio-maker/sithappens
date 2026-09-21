/**
 * The browser half of the analytics, which has three jobs and can fail at all three.
 *
 *   It must not storm. React re-renders constantly and StrictMode double-invokes
 *   effects; a product on screen is ONE impression, and this file proves it stays
 *   one however many times the component redraws.
 *
 *   It must not block. Nothing waits for a response, and a rejected request must
 *   not surface anywhere — least of all as an unhandled rejection in the middle of
 *   somebody's checkout.
 *
 *   It must not carry content. What leaves the browser is a reference and a count.
 *   The server enforces that too, but a recipient's email should not be travelling
 *   in the first place.
 *
 * Plus the metadata helpers, where the rule is that nothing is invented: no
 * description a person did not write, no "New" badge on an item with no reliable
 * date.
 */
import {
  trackShop, trackOnce, flushShopEvents, trackImpressions, trackProductView,
  resetShopImpressions, shopSession,
} from "./shopAnalytics";
import { itemMetaFor, shopMetaFor, isNew, plainText, NEW_FOR_DAYS } from "./shopSeo";
import { badgesFor } from "./shopDepartments";

jest.mock("./api", () => ({
  api: { post: jest.fn(() => Promise.resolve({ data: {} })), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));

const { api } = require("./api");

beforeEach(() => {
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  sessionStorage.clear();
  resetShopImpressions();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

const sent = () => api.post.mock.calls.filter((c) => c[0] === "/public/shop/events").map((c) => c[1]);
const allEvents = () => sent().flatMap((b) => b.events);

// ───────────────────────────────────────────── batching and blocking

describe("reporting never gets in the way", () => {
  test("events are batched rather than sent one at a time", () => {
    trackShop({ event: "shop_view" });
    trackShop({ event: "product_view", kind: "product", ref_id: "p1" });
    expect(api.post).not.toHaveBeenCalled();     // nothing yet — still collecting
    jest.advanceTimersByTime(5000);
    expect(sent()).toHaveLength(1);
    expect(allEvents()).toHaveLength(2);
  });

  test("a full queue flushes rather than growing", () => {
    for (let i = 0; i < 40; i += 1) trackShop({ event: "product_impression", kind: "product", ref_id: `p${i}` });
    expect(api.post).toHaveBeenCalled();
  });

  test("a rejected request is swallowed, not thrown at the page", async () => {
    // A missing .catch() does NOT throw synchronously — it produces an
    // unhandled rejection, which is what actually shows up in a customer's
    // console mid-checkout. So that is what this listens for; the earlier
    // version only asserted "did not throw" and passed with no .catch at all.
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      api.post.mockRejectedValue(new Error("offline"));
      trackShop({ event: "shop_view" });
      expect(() => flushShopEvents()).not.toThrow();
      jest.useRealTimers();
      // A macrotask, so a rejected promise has had its chance to go
      // unhandled. setImmediate is not available in this jsdom environment.
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      jest.useFakeTimers();
    }
  });

  test("a client that throws synchronously does not take the shop down", () => {
    api.post.mockImplementation(() => { throw new Error("boom"); });
    trackShop({ event: "shop_view" });
    expect(() => flushShopEvents()).not.toThrow();
  });

  test("flushing an empty queue does nothing at all", () => {
    flushShopEvents();
    expect(api.post).not.toHaveBeenCalled();
  });

  test("the queue is emptied by a flush, so nothing is sent twice", () => {
    trackShop({ event: "shop_view" });
    flushShopEvents();
    flushShopEvents();
    expect(sent()).toHaveLength(1);
  });
});

// ───────────────────────────────────────────── what travels

describe("what leaves the browser", () => {
  test("only named fields travel", () => {
    trackShop({
      event: "add_to_cart", kind: "product", ref_id: "p1", quantity: 2,
      recipient_email: "nan@example.com", recipient_name: "Nan", dog_name: "Rex",
      gift_message: "Happy birthday", client_name: "Sam", token: "secret",
    });
    flushShopEvents();
    const [event] = allEvents();
    expect(Object.keys(event).sort()).toEqual(["event", "kind", "quantity", "ref_id"]);
    expect(JSON.stringify(event)).not.toMatch(/nan@|Nan|Rex|Happy birthday|Sam|secret/);
  });

  test("an event with no name is dropped before it is queued", () => {
    trackShop({ kind: "product", ref_id: "p1" });
    flushShopEvents();
    expect(api.post).not.toHaveBeenCalled();
  });

  test("the viewport travels, the user agent does not", () => {
    trackShop({ event: "shop_view" });
    flushShopEvents();
    const [body] = sent();
    expect(typeof body.viewport_width).toBe("number");
    expect(JSON.stringify(body)).not.toMatch(/Mozilla|user_agent/);
  });

  test("the session id is stable within a visit", () => {
    const first = shopSession();
    expect(first).toBeTruthy();
    expect(shopSession()).toBe(first);
  });

  test("a fresh page load persists its session id to sessionStorage, not localStorage", () => {
    // In a FRESH module, because the id is also held in memory: once it has
    // been generated it keeps working even if storage is cleared underneath
    // it, which is right for a session and would hide this assertion.
    jest.isolateModules(() => {
      sessionStorage.clear();
      localStorage.clear();
      // eslint-disable-next-line global-require
      const { shopSession: fresh } = require("./shopAnalytics");
      const id = fresh();
      // sessionStorage, not localStorage: a shopping session should not be
      // the same one next week.
      expect(sessionStorage.getItem("sh_shop_session")).toBe(id);
      expect(localStorage.getItem("sh_shop_session")).toBeNull();
    });
  });

  test("blocked storage still produces a working session id", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    try {
      expect(typeof shopSession()).toBe("string");
    } finally {
      Object.defineProperty(window, "sessionStorage", original);
    }
  });
});

// ───────────────────────────────────────────── deduplication

describe("a product on screen is one impression", () => {
  const ITEMS = [
    { kind: "product", id: "p1", name: "Leash" },
    { kind: "product", id: "p2", name: "Harness" },
  ];

  test("re-rendering the same list reports nothing extra", () => {
    for (let i = 0; i < 14; i += 1) trackImpressions(ITEMS, { department: "gear", search: "" });
    flushShopEvents();
    expect(allEvents().filter((e) => e.event === "product_impression")).toHaveLength(2);
  });

  test("a genuinely different list counts again", () => {
    trackImpressions(ITEMS, { department: "gear", search: "" });
    trackImpressions(ITEMS, { department: "training", search: "" });
    flushShopEvents();
    expect(allEvents().filter((e) => e.event === "product_impression")).toHaveLength(4);
  });

  test("a new search is a new context", () => {
    trackImpressions(ITEMS, { department: "gear", search: "" });
    trackImpressions(ITEMS, { department: "gear", search: "leash" });
    flushShopEvents();
    expect(allEvents().filter((e) => e.event === "product_impression")).toHaveLength(4);
  });

  test("a page-level event fires once however many times the effect runs", () => {
    // Browser QA caught shop_view being reported twice per page load: React
    // StrictMode runs an effect, tears it down and runs it again.
    for (let i = 0; i < 5; i += 1) trackOnce("shop_view", { event: "shop_view" });
    flushShopEvents();
    expect(allEvents().filter((e) => e.event === "shop_view")).toHaveLength(1);
  });

  test("a product page is one view however many times the effect runs", () => {
    // StrictMode runs an effect, tears it down and runs it again. Without
    // deduplication that is two views for one visit, on every product page.
    for (let i = 0; i < 6; i += 1) trackProductView("product", "p1");
    flushShopEvents();
    expect(allEvents().filter((e) => e.event === "product_view")).toHaveLength(1);
  });

  test("two different products are two views", () => {
    trackProductView("product", "p1");
    trackProductView("product", "p2");
    flushShopEvents();
    expect(allEvents().filter((e) => e.event === "product_view")).toHaveLength(2);
  });

  test("an item with no id reports nothing rather than a broken row", () => {
    trackImpressions([{ kind: "product" }, { id: "x" }, null], { department: "gear" });
    flushShopEvents();
    expect(api.post).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────── metadata

describe("what a page says about itself", () => {
  const ITEM = {
    kind: "product", id: "p1", name: "Rope Leash", image_id: "img-1",
    online_description: "Six feet of braided rope.",
  };

  test("a product page is titled after the product", () => {
    const meta = itemMetaFor(ITEM, { origin: "https://example.com" });
    expect(meta.title).toBe("Rope Leash | Sit Happens");
    expect(meta.description).toBe("Six feet of braided rope.");
    expect(meta.canonical).toBe("https://example.com/shop/item/product/p1");
    expect(meta.ogType).toBe("product");
  });

  test("the social image is the large derivative, never the thumbnail", () => {
    const meta = itemMetaFor(ITEM, { origin: "https://example.com" });
    expect(meta.image).toBe("https://example.com/api/public/shop/media/img-1/pdp");
    expect(meta.image).not.toContain("/thumb");
  });

  test("a description is never invented", () => {
    const bare = itemMetaFor({ kind: "product", id: "p2", name: "Mystery Item" }, {});
    // Says what it IS, not how good it is.
    expect(bare.description).toBe("Mystery Item from Sit Happens.");
  });

  test("a program with no description says what it helps with", () => {
    const meta = itemMetaFor({
      kind: "training_program", id: "t1", name: "Recall",
      helps_with: ["Recall", "Confidence"],
    }, {});
    expect(meta.description).toBe("Training for recall, confidence.");
  });

  test("markup in a description does not reach a meta tag", () => {
    const meta = itemMetaFor({ ...ITEM, online_description: "<b>Bold</b> <script>x</script> rope" }, {});
    expect(meta.description).not.toMatch(/<|script/);
    expect(meta.description).toContain("Bold");
  });

  test("an account-only item is marked noindex", () => {
    expect(itemMetaFor({ ...ITEM, publicly_visible: false }, {}).noindex).toBe(true);
    expect(itemMetaFor(ITEM, { isPublic: false }).noindex).toBe(true);
    expect(itemMetaFor(ITEM, { isPublic: true }).noindex).toBe(false);
  });

  test("departments get their own title and canonical", () => {
    const gear = shopMetaFor({ department: "gear", origin: "https://example.com" });
    const shop = shopMetaFor({ department: null, origin: "https://example.com" });
    expect(gear.title).toBe("Dog Training Gear | Sit Happens");
    expect(gear.canonical).toBe("https://example.com/shop?dept=gear");
    // Different pages need different canonicals or they are treated as one.
    expect(shop.canonical).toBe("https://example.com/shop");
    expect(shop.title).not.toBe(gear.title);
  });

  test("a long description is clipped at a word", () => {
    const long = `${"word ".repeat(200)}end`;
    const out = plainText(long);
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wo…$/);
  });
});

// ───────────────────────────────────────────── badges

describe("badges only say what the data can prove", () => {
  const now = Date.UTC(2026, 8, 21);
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();

  test("New comes from a real date", () => {
    expect(isNew({ listed_on: daysAgo(3) }, now)).toBe(true);
    expect(isNew({ listed_on: daysAgo(NEW_FOR_DAYS + 1) }, now)).toBe(false);
  });

  test("an item with no reliable date gets no New badge rather than a guess", () => {
    expect(isNew({}, now)).toBe(false);
    expect(isNew({ listed_on: null }, now)).toBe(false);
    expect(isNew({ listed_on: "not a date" }, now)).toBe(false);
  });

  test("a future timestamp is bad data, not a brand-new product", () => {
    expect(isNew({ listed_on: daysAgo(-5) }, now)).toBe(false);
  });

  test("the raw created_at timestamp is NOT what the badge reads", () => {
    // The customer-facing catalog is an allowlist and created_at is not on
    // it (backend tests/test_client_shop_catalog.py asserts the same). If
    // this badge ever starts reading created_at again, the field has to
    // have leaked back into the catalog to make it work.
    expect(isNew({ created_at: daysAgo(1) }, now)).toBe(false);
  });

  test("Best Seller comes from the orders and outranks Featured", () => {
    const item = { id: "p1", featured: true };
    const keys = badgesFor(item, { bestSellerIds: new Set(["p1"]) }).map((b) => b.key);
    expect(keys).toContain("best_seller");
    // Two competing claims in one corner is noise; the stronger one wins.
    expect(keys).not.toContain("featured");
  });

  test("Featured shows when nothing has outsold it", () => {
    const keys = badgesFor({ id: "p1", featured: true }, { bestSellerIds: new Set() })
      .map((b) => b.key);
    expect(keys).toEqual(["featured"]);
  });

  test("no badge is invented for an ordinary product", () => {
    expect(badgesFor({ id: "p9" })).toEqual([]);
  });

  test("stock states still read in words", () => {
    expect(badgesFor({ id: "p1", availability: "out_of_stock" }).map((b) => b.label))
      .toContain("Sold out");
    expect(badgesFor({ id: "p1", availability: "low_stock" }).map((b) => b.label))
      .toContain("Low stock");
  });
});
