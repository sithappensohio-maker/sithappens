/**
 * Saving things, coming back to things, and what happened after buying.
 *
 * The browser half of Phase 12–15. The server decides what may be SHOWN —
 * that is tested in backend/test_shop_discovery.py, and none of it is
 * re-implemented here. What this file is for is the half that lives on this
 * side and can therefore go wrong on its own:
 *
 *   * recently-viewed storage, which is the only thing in this batch that
 *     the browser keeps. It must hold references and never prices, must not
 *     grow without bound, and must fail safe when someone edits it.
 *   * a heart that tells the truth about what is saved, including when the
 *     save fails.
 *   * rows that render nothing rather than render filler.
 *   * "Buy again" carrying intent and no money.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  MAX_RECENT, readRecent, rememberViewed, clearRecent, clearAllRecent, recentKey, recentRefs,
} from "../lib/shopRecent";
import {
  FavoriteButton, FavoritesList, Recommendations, RecentlyViewed,
} from "./shop/ShopDiscovery";
import { OrderList, OrderDetail, orderState } from "./shop/ShopOrders";
import RelatedItemsEditor from "./shop/RelatedItemsEditor";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

const mount = (el) => act(() => { root = createRoot(container); root.render(el); });

/**
 * Type into a React-controlled input for real.
 *
 * Assigning `.value` and firing "input" does NOT reach React: React tracks
 * the value on the DOM node and skips the event when it has not changed
 * through the native setter. The first version of the tests below did
 * exactly that, so the search never ran — and the two tests asserting that
 * something is ABSENT from the results passed for that reason rather than
 * for the reason they claim. This is what makes them mean anything.
 */
const typeInto = (testId, value) => act(() => {
  const el = byTestId(testId);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const text = () => document.body.textContent;

const ITEM = (id, name) => ({
  kind: "product", id, name, price: 24, availability: "in_stock",
  in_stock: true, image_id: `img-${id}`,
});

// ───────────────────────────────────────────────── recently viewed

describe("what this browser remembers about browsing", () => {
  const CLIENT = "client-a";

  test("a product page visit is remembered", () => {
    rememberViewed(CLIENT, "product", "p1");
    expect(readRecent(CLIENT)).toEqual([
      expect.objectContaining({ kind: "product", ref_id: "p1" }),
    ]);
  });

  test("nothing about the item is stored — only that it was looked at", () => {
    // The assertion is the KEY SET, not a substring search. The first
    // version of this test grepped the raw JSON for "24" (the price in the
    // fixture) and went red at random, because a millisecond timestamp
    // contains "24" roughly whenever it feels like it. A flaky test that
    // fails for the wrong reason is worse than no test.
    rememberViewed(CLIENT, "product", "p1");
    const entry = JSON.parse(localStorage.getItem(recentKey(CLIENT))).items[0];
    expect(Object.keys(entry).sort()).toEqual(["at", "kind", "ref_id"]);
    expect(entry).toEqual({ kind: "product", ref_id: "p1", at: expect.any(Number) });
  });

  test("a price handed in on the side is not stored either", () => {
    rememberViewed(CLIENT, "product", "p1");
    const raw = localStorage.getItem(recentKey(CLIENT));
    expect(raw).not.toMatch(/"(price|name|stock|in_stock|unit_price)"/);
  });

  test("a price someone typed into the store is stripped on the way out", () => {
    // rememberViewed builds its own entry, so the only way a price can get
    // in here is by hand — and this is the guard that takes it back out.
    localStorage.setItem(recentKey(CLIENT), JSON.stringify({
      version: 1,
      items: [{ kind: "product", ref_id: "p1", at: 1, price: 1, name: "Free Leash", in_stock: true }],
    }));
    expect(readRecent(CLIENT)).toEqual([{ kind: "product", ref_id: "p1", at: 1 }]);
  });

  test("a store someone padded out is still bounded on the way out", () => {
    localStorage.setItem(recentKey(CLIENT), JSON.stringify({
      version: 1,
      items: Array.from({ length: 200 }, (_, i) => ({ kind: "product", ref_id: `p${i}`, at: i })),
    }));
    expect(readRecent(CLIENT).length).toBe(MAX_RECENT);
  });

  test("duplicates already in the store collapse on the way out", () => {
    localStorage.setItem(recentKey(CLIENT), JSON.stringify({
      version: 1,
      items: [
        { kind: "product", ref_id: "p1", at: 3 },
        { kind: "product", ref_id: "p1", at: 2 },
        { kind: "product", ref_id: "p2", at: 1 },
      ],
    }));
    expect(readRecent(CLIENT).map((e) => e.ref_id)).toEqual(["p1", "p2"]);
  });

  test("looking at the same thing twice is one entry, moved to the front", () => {
    rememberViewed(CLIENT, "product", "p1");
    rememberViewed(CLIENT, "product", "p2");
    rememberViewed(CLIENT, "product", "p1");
    const list = readRecent(CLIENT);
    expect(list.map((e) => e.ref_id)).toEqual(["p1", "p2"]);
  });

  test("newest first", () => {
    rememberViewed(CLIENT, "product", "old");
    rememberViewed(CLIENT, "product", "new");
    expect(readRecent(CLIENT)[0].ref_id).toBe("new");
  });

  test("the list is bounded", () => {
    for (let i = 0; i < MAX_RECENT + 10; i += 1) rememberViewed(CLIENT, "product", `p${i}`);
    expect(readRecent(CLIENT).length).toBe(MAX_RECENT);
    // ...and it is the OLDEST that fell off, not the newest.
    expect(readRecent(CLIENT)[0].ref_id).toBe(`p${MAX_RECENT + 9}`);
  });

  test("one person's browsing is not shown to another", () => {
    rememberViewed("client-a", "product", "p1");
    expect(readRecent("client-b")).toEqual([]);
    // A guest gets their own bucket too, rather than inheriting one.
    expect(readRecent(null)).toEqual([]);
  });

  test.each([
    ["not JSON", "{{{"],
    ["an array where the envelope should be", "[]"],
    ["a future version", '{"version":99,"items":[{"kind":"product","ref_id":"p1"}]}'],
    ["items that are not a list", '{"version":1,"items":5}'],
    ["null", "null"],
  ])("a store that is %s reads as empty rather than crashing", (_label, stored) => {
    localStorage.setItem(recentKey(CLIENT), stored);
    expect(() => readRecent(CLIENT)).not.toThrow();
    expect(readRecent(CLIENT)).toEqual([]);
  });

  test("individually rotten entries are dropped and the good ones kept", () => {
    localStorage.setItem(recentKey(CLIENT), JSON.stringify({
      version: 1,
      items: [
        { kind: "product", ref_id: "ok", at: 3 },
        { kind: "nonsense", ref_id: "x", at: 2 },
        { kind: "product", at: 1 },
        null, "a string", 7,
      ],
    }));
    expect(readRecent(CLIENT).map((e) => e.ref_id)).toEqual(["ok"]);
  });

  test("signing out forgets everyone's browsing on this computer", () => {
    rememberViewed("client-a", "product", "p1");
    rememberViewed("client-b", "product", "p2");
    rememberViewed(null, "product", "p3");
    clearAllRecent();
    expect(readRecent("client-a")).toEqual([]);
    expect(readRecent("client-b")).toEqual([]);
    expect(readRecent(null)).toEqual([]);
  });

  test("the request body is references and nothing else", () => {
    rememberViewed(CLIENT, "product", "p1");
    expect(recentRefs(CLIENT)).toEqual([{ kind: "product", ref_id: "p1" }]);
  });

  test("clearing one bucket leaves the others alone", () => {
    rememberViewed("client-a", "product", "p1");
    rememberViewed("client-b", "product", "p2");
    clearRecent("client-a");
    expect(readRecent("client-a")).toEqual([]);
    expect(readRecent("client-b")).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────── the heart

describe("the save control", () => {
  test("it is a real button, and it says what pressing it will do", () => {
    mount(<FavoriteButton kind="product" refId="p1" name="Rope Leash" saved={false} onToggle={() => {}} />);
    const btn = byTestId("shop-favorite-product-p1");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-label")).toBe("Save Rope Leash for later");
  });

  test("its state is announced, not just coloured in", () => {
    // A filled shape is not a state anybody can hear.
    mount(<FavoriteButton kind="product" refId="p1" name="Rope Leash" saved onToggle={() => {}} />);
    const btn = byTestId("shop-favorite-product-p1");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.getAttribute("aria-label")).toBe("Remove Rope Leash from saved items");
  });

  test("it has a visible focus ring", () => {
    mount(<FavoriteButton kind="product" refId="p1" name="X" saved={false} onToggle={() => {}} />);
    expect(byTestId("shop-favorite-product-p1").className).toMatch(/focus-visible:ring/);
  });

  test("pressing it does not also open the product", () => {
    // The card has a full-bleed button underneath; without stopPropagation
    // every save would navigate away from the thing being saved.
    const calls = [];
    mount(
      <div onClick={() => calls.push("card")}>
        <FavoriteButton kind="product" refId="p1" name="X" saved={false}
                        onToggle={() => calls.push("save")} />
      </div>,
    );
    act(() => { byTestId("shop-favorite-product-p1").click(); });
    expect(calls).toEqual(["save"]);
  });

  test("a busy heart cannot be pressed twice", () => {
    const calls = [];
    mount(<FavoriteButton kind="product" refId="p1" name="X" saved={false} busy
                          onToggle={() => calls.push("save")} />);
    act(() => { byTestId("shop-favorite-product-p1").click(); });
    expect(calls).toEqual([]);
  });
});

// ───────────────────────────────────────────────── rows that show nothing

describe("nothing is better than filler", () => {
  test("an empty recommendation list renders nothing at all", () => {
    mount(<Recommendations recommendations={[]} cardProps={{}} />);
    expect(byTestId("shop-recommendations")).toBeNull();
  });

  test("an empty recently-viewed list renders nothing at all", () => {
    mount(<RecentlyViewed items={[]} cardProps={{}} />);
    expect(byTestId("shop-recently-viewed")).toBeNull();
  });

  test("recommendations are grouped under what the curator meant", () => {
    mount(<Recommendations cardProps={{ mode: "guest" }} recommendations={[
      { rel: "complements", label: "Pairs well with", item: ITEM("p2", "Trail Harness") },
      { rel: "related", label: "You may also like", item: ITEM("p3", "Long Line") },
    ]} />);
    expect(byTestId("shop-recommendation-heading-complements").textContent).toBe("Pairs well with");
    expect(byTestId("shop-recommendation-heading-related").textContent).toBe("You may also like");
  });

  test("the fallback is labelled as what it is, not dressed up as curation", () => {
    mount(<Recommendations cardProps={{ mode: "guest" }} recommendations={[
      { rel: "same_department", label: "You may also like", item: ITEM("p2", "Trail Harness") },
    ]} />);
    expect(byTestId("shop-recommendation-heading-same_department").textContent).toBe("More like this");
  });

  test("headings are real headings, so the page outlines", () => {
    mount(<Recommendations cardProps={{ mode: "guest" }} recommendations={[
      { rel: "related", label: "You may also like", item: ITEM("p2", "Trail Harness") },
    ]} />);
    expect(byTestId("shop-recommendation-heading-related").tagName).toBe("H2");
  });
});

// ───────────────────────────────────────────────── saved items page

describe("the saved-items page", () => {
  test("an empty state that says what to do about it", () => {
    mount(<FavoritesList favorites={[]} loading={false} cardProps={{}} onBrowse={() => {}} />);
    expect(byTestId("shop-favorites-empty")).toBeTruthy();
    expect(text()).toContain("Nothing saved yet");
  });

  test("a saved item that is no longer available says so without naming it", () => {
    // The name belongs to an item this client may no longer be allowed to
    // see, and it was never stored — so there is nothing honest to print.
    mount(<FavoritesList loading={false} cardProps={{}} onRemove={() => {}} favorites={[
      { kind: "product", ref_id: "gone", available: false, item: null },
    ]} />);
    expect(byTestId("shop-favorites-unavailable")).toBeTruthy();
    expect(text()).toContain("no longer available");
    expect(byTestId("shop-favorite-remove-product-gone")).toBeTruthy();
  });

  test("available and unavailable are kept apart", () => {
    mount(<FavoritesList loading={false} cardProps={{ mode: "authenticated" }} onRemove={() => {}} favorites={[
      { kind: "product", ref_id: "p1", available: true, item: ITEM("p1", "Rope Leash") },
      { kind: "product", ref_id: "gone", available: false, item: null },
    ]} />);
    expect(text()).toContain("Rope Leash");
    expect(byTestId("shop-favorites-unavailable")).toBeTruthy();
  });
});

// ───────────────────────────────────────────────── orders

const ORDER_ROW = {
  order_id: "abcdef12-0000", reference: "ABCDEF12", created_at: "2026-09-20T12:00:00Z",
  status: "paid", fulfillment_status: "fulfilled", total: 42.5, item_count: 2,
  lines: [{ kind: "product", ref_id: "p1", name: "Rope Leash", quantity: 2, image_id: "img-1" }],
};

describe("the order list", () => {
  test("it shows the number, the date, the total and what was in it", () => {
    mount(<OrderList orders={[ORDER_ROW]} onOpen={() => {}} />);
    expect(text()).toContain("Order #ABCDEF12");
    expect(text()).toContain("$42.50");
    expect(text()).toContain("2 items");
    expect(text()).toContain("2× Rope Leash");
  });

  test("every row is a button, so a keyboard can open one", () => {
    mount(<OrderList orders={[ORDER_ROW]} onOpen={() => {}} />);
    expect(byTestId("shop-order-abcdef12-0000").tagName).toBe("BUTTON");
  });

  test("status is words, not only a colour", () => {
    mount(<OrderList orders={[ORDER_ROW]} onOpen={() => {}} />);
    expect(byTestId("shop-order-status-abcdef12-0000").textContent).toContain("Completed");
  });

  test("an empty history says so", () => {
    mount(<OrderList orders={[]} onOpen={() => {}} />);
    expect(byTestId("shop-orders-empty")).toBeTruthy();
  });

  test.each([
    [{ status: "pending_payment" }, "Not completed"],
    [{ status: "paid", fulfillment_status: "pending" }, "Being prepared"],
    [{ status: "paid", fulfillment_status: "fulfilled" }, "Completed"],
    [{ status: "paid", fulfillment_status: "fulfilled", pickup_status: "ready" }, "Ready for pickup"],
    [{ status: "paid", refund_status: "full" }, "Refunded"],
    [{ status: "paid", fulfillment_status: "fulfilled", refund_status: "partial" }, "Partly refunded"],
  ])("%j reads as %s", (order, expected) => {
    expect(orderState(order).label).toBe(expected);
  });
});

const DETAIL = {
  order_id: "abcdef12-0000", reference: "ABCDEF12", created_at: "2026-09-20T12:00:00Z",
  status: "paid", fulfillment_status: "fulfilled", subtotal: 40, tax_amount: 2.5, total: 42.5,
  lines: [{
    item_id: "li-1", kind: "product", ref_id: "p1", name: "Rope Leash", quantity: 2,
    unit_price: 20, line_subtotal: 40, line_total: 40, image_id: "img-1",
    actions: [
      { action: "view_item", enabled: true, kind: "product", ref_id: "p1" },
      { action: "buy_again", enabled: true, kind: "product", ref_id: "p1", quantity: 2 },
    ],
  }],
};

describe("the order detail", () => {
  test("it shows what was paid, line by line", () => {
    mount(<OrderDetail order={DETAIL} onBack={() => {}} />);
    expect(text()).toContain("Order #ABCDEF12");
    expect(text()).toContain("2 × $20.00");
    expect(text()).toContain("$42.50");
    expect(text()).toContain("Sales tax");
  });

  test("the order number is the page's heading", () => {
    mount(<OrderDetail order={DETAIL} onBack={() => {}} />);
    expect(byTestId("shop-order-detail-reference").tagName).toBe("H2");
  });

  test("buy again hands back a reference and a quantity — never a price", () => {
    const seen = [];
    mount(<OrderDetail order={DETAIL} onBack={() => {}} onBuyAgain={(a) => seen.push(a)} />);
    act(() => { byTestId("order-line-buy-again-p1").click(); });
    expect(seen).toEqual([{ action: "buy_again", enabled: true, kind: "product", ref_id: "p1", quantity: 2 }]);
    expect(JSON.stringify(seen)).not.toMatch(/unit_price|line_total|20/);
  });

  test("a blocked buy again explains itself rather than greying out silently", () => {
    mount(<OrderDetail onBack={() => {}} order={{
      ...DETAIL,
      lines: [{ ...DETAIL.lines[0], actions: [{ action: "buy_again", enabled: false, reason: "Out of stock" }] }],
    }} />);
    expect(byTestId("order-line-buy-again-blocked").textContent).toContain("Out of stock");
    expect(byTestId("order-line-buy-again-p1")).toBeNull();
  });

  test("a course line names the dog and opens the course", () => {
    const opened = [];
    mount(<OrderDetail onBack={() => {}} onOpenCourse={(a) => opened.push(a.enrollment_id)} order={{
      ...DETAIL,
      lines: [{
        item_id: "li-2", kind: "training_program", ref_id: "t1", name: "Rock Solid Recall",
        quantity: 1, unit_price: 119, line_total: 119, dog_name: "Rex",
        actions: [{ action: "open_course", enabled: true, enrollment_id: "en-1", dog_name: "Rex" }],
      }],
    }} />);
    expect(byTestId("order-line-dog-li-2").textContent).toContain("Rex");
    act(() => { byTestId("order-line-open-course-en-1").click(); });
    expect(opened).toEqual(["en-1"]);
  });

  test("a gift card line shows who it went to and never a code", () => {
    mount(<OrderDetail onBack={() => {}} order={{
      ...DETAIL,
      lines: [{
        item_id: "li-3", kind: "gift_card", ref_id: "gc-2500", name: "Gift card · $25.00",
        quantity: 1, unit_price: 25, line_total: 25, fulfillment_status: "fulfilled",
        recipient_name: "Nan", recipient_email: "nan@example.com", gift_message: "Happy birthday",
        actions: [],
      }],
    }} />);
    expect(byTestId("order-line-gift-li-3").textContent).toContain("Nan");
    expect(text()).toContain("nan@example.com");
    expect(text()).toContain("Happy birthday");
    // The code lives on the card and travels by email. It is not on the
    // order, and this screen must never start showing one.
    expect(text()).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
  });
});

// ───────────────────────────────────────────────── the curation editor

describe("curating related items", () => {
  const CANDIDATES = [
    { kind: "product", id: "p1", name: "Rope Leash" },
    { kind: "product", id: "p2", name: "Trail Harness" },
    { kind: "training_program", id: "t1", name: "Rock Solid Recall" },
  ];

  test("items are found by name — nobody types an id", () => {
    mount(<RelatedItemsEditor value={[]} onChange={() => {}} candidates={CANDIDATES} selfId="p1" />);
    typeInto("related-search", "harness");
    expect(byTestId("related-add-product-p2")).toBeTruthy();
  });

  test("the item being edited is never offered as its own relation", () => {
    mount(<RelatedItemsEditor value={[]} onChange={() => {}} candidates={CANDIDATES} selfId="p1" />);
    typeInto("related-search", "leash");
    expect(byTestId("related-add-product-p1")).toBeNull();
  });

  test("picking one stores a reference and nothing else", () => {
    const saved = [];
    mount(<RelatedItemsEditor value={[]} onChange={(v) => saved.push(v)} candidates={CANDIDATES} selfId="p1" />);
    typeInto("related-search", "harness");
    act(() => { byTestId("related-add-product-p2").click(); });
    expect(saved).toEqual([[{ rel: "complements", kind: "product", ref_id: "p2" }]]);
  });

  test("something already on the list is not offered again", () => {
    mount(<RelatedItemsEditor candidates={CANDIDATES} selfId="p1" onChange={() => {}}
                              value={[{ rel: "complements", kind: "product", ref_id: "p2" }]} />);
    typeInto("related-search", "harness");
    expect(byTestId("related-add-product-p2")).toBeNull();
  });

  test("order is the curator's, and can be changed", () => {
    const saved = [];
    mount(<RelatedItemsEditor candidates={CANDIDATES} selfId="p1" onChange={(v) => saved.push(v)}
                              value={[
                                { rel: "related", kind: "product", ref_id: "p2" },
                                { rel: "related", kind: "training_program", ref_id: "t1" },
                              ]} />);
    const down = document.querySelector('[aria-label="Move Trail Harness down"]');
    act(() => { down.click(); });
    expect(saved[0].map((r) => r.ref_id)).toEqual(["t1", "p2"]);
  });

  test("a reference that no longer resolves is shown as missing, not as a blank row", () => {
    mount(<RelatedItemsEditor candidates={CANDIDATES} selfId="p1" onChange={() => {}}
                              value={[{ rel: "related", kind: "product", ref_id: "deleted" }]} />);
    expect(byTestId("related-item-product-deleted").textContent).toContain("no longer available");
  });

  test("an empty list explains what happens instead", () => {
    mount(<RelatedItemsEditor value={[]} onChange={() => {}} candidates={CANDIDATES} selfId="p1" />);
    expect(byTestId("related-items-empty").textContent).toContain("same category");
  });
});
