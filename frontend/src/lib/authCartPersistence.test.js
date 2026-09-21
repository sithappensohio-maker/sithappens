/**
 * A signed-in cart that survives a reload — without surviving as a price.
 *
 * Two rules are on trial, and they pull in opposite directions:
 *
 *   1. Nothing is lost. Close the tab, come back, and the cart is still
 *      there: the right things, the right quantities, the right dog, the
 *      right gift recipient.
 *   2. Nothing is TRUSTED. What anything costs, whether there is any left,
 *      and whether this client may buy it at all are read again from the
 *      authenticated catalogue on every restore. A price in localStorage is
 *      a price a customer can edit, so no price is ever stored, and no
 *      stored number is ever believed.
 *
 * The tests below try to break rule 2 by hand-editing the store, the way
 * anyone with devtools would.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { useAuthCart } from "./useAuthCart";
import {
  readAuthCart, writeAuthCart, clearAllAuthCarts, authCartKey,
  safeLines, deserializeCart, serializeCart,
} from "./cartIntent";

jest.mock("./api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => String(e?.response?.data?.detail || e || ""),
}));

const { api } = require("./api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT = "client-a";
const OTHER = "client-b";

// The authenticated catalogue — the ONLY source of price, stock and
// eligibility anywhere in this file.
const CATALOG = [
  { kind: "product", id: "p1", name: "Husky Rope Leash", price: 18.0, track_inventory: true, stock_on_hand: 10 },
  { kind: "product", id: "p2", name: "Last One", price: 9.0, track_inventory: true, stock_on_hand: 1 },
  { kind: "product", id: "shopify", name: "Tee", price: 25.0, sales_destination: "shopify_external" },
  { kind: "gift_card", id: "gc-2500", name: "Gift card · $25", price: 25.0 },
  { kind: "training_program", id: "school-1", name: "Puppy Foundations", price: 99.0, purchase_fulfillment: "online_school" },
  { kind: "training_program", id: "inperson", name: "Board & Train", price: 1200.0 },
];
const DOGS = [{ id: "dog-1", name: "Rosie" }];

let container, root, seen;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/shop/catalog") return Promise.resolve({ data: { items: CATALOG } });
    if (url === "/dogs") return Promise.resolve({ data: DOGS });
    return Promise.resolve({ data: {} });
  });
  localStorage.clear();
  seen = null;
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

/** A stand-in for Portal: owns the cart, hands it to the hook. */
function Harness({ clientId }) {
  const [cart, setCart] = useState([]);
  const { notices } = useAuthCart(clientId, cart, setCart);
  seen = { cart, notices };
  return (
    <div>
      <span data-testid="count">{cart.reduce((n, c) => n + c.quantity, 0)}</span>
      <span data-testid="notices">{notices.join(" | ")}</span>
    </div>
  );
}

const mount = (clientId = CLIENT) =>
  act(() => { root = createRoot(container); root.render(<Harness clientId={clientId} />); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const raw = (clientId = CLIENT) => JSON.parse(localStorage.getItem(authCartKey(clientId)) || "null");

// ───────────────────────────────────────────── what may be stored at all

describe("what a cart is allowed to remember", () => {
  test("a cart comes back after a reload", async () => {
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "p1", quantity: 2 }]);
    mount();
    await flush();
    expect(seen.cart).toEqual([{ kind: "product", ref_id: "p1", quantity: 2 }]);
    expect(seen.notices).toEqual([]); // restored intact — nothing to announce
  });

  test("a price is never written, however it is handed in", () => {
    writeAuthCart(CLIENT, [{
      kind: "product", ref_id: "p1", quantity: 1,
      price: 999, unit_price: 999, subtotal: 999, total: 999, tax: 0, discount: 50,
      pricing_source: "override", price_override_id: "po-1",
      in_stock: true, stock_on_hand: 99, name: "Free Leash",
      entitlement: "granted", stripe_session: "cs_live_x",
    }]);
    // Read the RAW store, not the getter: a getter that filtered on the way
    // out would pass this while the price sat in localStorage all along.
    expect(raw().lines).toEqual([{ kind: "product", ref_id: "p1", quantity: 1 }]);
    expect(JSON.stringify(raw())).not.toMatch(/999|override|cs_live|entitlement/);
  });

  test("the stored shape is versioned", () => {
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "p1", quantity: 1 }]);
    expect(raw().version).toBe(1);
    expect(Array.isArray(raw().lines)).toBe(true);
  });

  test("a cart from a version this build does not know is discarded, not guessed at", () => {
    localStorage.setItem(authCartKey(CLIENT), JSON.stringify({
      version: 99, lines: [{ kind: "product", ref_id: "p1", quantity: 1 }],
    }));
    expect(readAuthCart(CLIENT)).toEqual([]);
  });

  test("nothing secret goes into the key or the contents", () => {
    localStorage.setItem("sh_token", "jwt.abc.secret");
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "p1", quantity: 1 }]);
    expect(authCartKey(CLIENT)).toBe("sh_cart_v1:client-a");
    expect(authCartKey(CLIENT)).not.toContain("jwt");
    expect(JSON.stringify(raw())).not.toContain("jwt");
  });
});

describe("a store that has been tampered with or corrupted", () => {
  test.each([
    ["not JSON at all", "{{{"],
    ["a bare string", '"nope"'],
    ["a number", "42"],
    ["null", "null"],
    ["an array where the envelope should be", '[{"kind":"product","ref_id":"p1","quantity":1}]'],
    ["lines that are not an array", '{"version":1,"lines":{"0":{"kind":"product"}}}'],
  ])("%s yields an empty cart rather than a crash", (_label, stored) => {
    localStorage.setItem(authCartKey(CLIENT), stored);
    expect(() => readAuthCart(CLIENT)).not.toThrow();
    const out = readAuthCart(CLIENT);
    // The one legible case — the pre-version shape — is read rather than
    // thrown away, because it is the same line shape by the same validator.
    expect(Array.isArray(out)).toBe(true);
  });

  test("the deserializer itself never throws", () => {
    // readAuthCart wraps it in its own try/catch (localStorage can throw in
    // a private window), which would hide a deserializer that threw. So it
    // is tested directly, not through the store.
    for (const bad of ["{{{", '"nope"', "42", "null", "[1,2,3]", '{"version":1,"lines":5}', ""]) {
      expect(() => deserializeCart(bad)).not.toThrow();
      expect(Array.isArray(deserializeCart(bad))).toBe(true);
    }
  });

  test("a corrupt store still lets the shop load", async () => {
    localStorage.setItem(authCartKey(CLIENT), "{{{not json");
    mount();
    await flush();
    expect(seen.cart).toEqual([]);
  });

  test("individually rotten lines are dropped, the good ones kept", () => {
    localStorage.setItem(authCartKey(CLIENT), JSON.stringify({
      version: 1,
      lines: [
        { kind: "product", ref_id: "ok", quantity: 1 },
        { kind: "nonsense", ref_id: "x", quantity: 1 },
        { kind: "product", ref_id: "neg", quantity: -5 },
        { kind: "product", ref_id: "frac", quantity: 1.5 },
        { kind: "product", quantity: 1 },
        null,
        "a string",
      ],
    }));
    expect(readAuthCart(CLIENT)).toEqual([{ kind: "product", ref_id: "ok", quantity: 1 }]);
  });

  test("an absurd cart cannot be forced into storage", () => {
    const huge = Array.from({ length: 500 }, (_, i) => ({ kind: "product", ref_id: `p${i}`, quantity: 9999 }));
    const safe = safeLines(huge);
    expect(safe.length).toBeLessThanOrEqual(40);     // the server's items cap
    expect(Math.max(...safe.map((l) => l.quantity))).toBeLessThanOrEqual(50); // its quantity cap
  });

  test("the same line stored twice becomes one line, not two", () => {
    const out = safeLines([
      { kind: "product", ref_id: "p1", quantity: 2 },
      { kind: "product", ref_id: "p1", quantity: 3 },
    ]);
    expect(out).toEqual([{ kind: "product", ref_id: "p1", quantity: 5 }]);
  });

  test("a round trip through storage changes nothing", () => {
    const lines = [
      { kind: "product", ref_id: "p1", quantity: 2 },
      { kind: "training_program", ref_id: "school-1", quantity: 1, dog_id: "dog-1" },
      { kind: "gift_card", ref_id: "gc-2500", quantity: 1, gift: { recipient_email: "nan@example.com", recipient_name: "Nan", gift_message: "xx" } },
    ];
    expect(deserializeCart(serializeCart(lines))).toEqual(lines);
  });
});

// ───────────────────────────────────────────── whose cart is whose

describe("more than one person uses this computer", () => {
  test("one client's cart is never handed to another", async () => {
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "p1", quantity: 2 }]);
    mount(OTHER);
    await flush();
    expect(seen.cart).toEqual([]);
    // ...and the first client's cart is still intact underneath.
    expect(readAuthCart(CLIENT)).toHaveLength(1);
  });

  test("a cart is not written into the bucket of whoever signs in next", async () => {
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "p1", quantity: 2 }]);
    mount();
    await flush();
    expect(seen.cart).toHaveLength(1);
    // The same mounted tree, now a different account.
    await act(async () => { root.render(<Harness clientId={OTHER} />); });
    await flush();
    expect(seen.cart).toEqual([]);
    expect(readAuthCart(OTHER)).toEqual([]);
  });

  test("signing out takes the cart with it", () => {
    writeAuthCart(CLIENT, [{ kind: "gift_card", ref_id: "gc-2500", quantity: 1, gift: { recipient_email: "nan@example.com", recipient_name: "Nan" } }]);
    writeAuthCart(OTHER, [{ kind: "product", ref_id: "p1", quantity: 1 }]);
    expect(localStorage.getItem("sh_guest_cart")).toBeNull();
    clearAllAuthCarts();
    expect(readAuthCart(CLIENT)).toEqual([]);
    expect(readAuthCart(OTHER)).toEqual([]);
    // A gift recipient's name must not be left behind on a shared machine.
    expect(JSON.stringify(localStorage)).not.toContain("nan@example.com");
  });

  test("the real logout is the thing that calls it", () => {
    // Guards the wiring, not the helper: a clearAllAuthCarts nobody calls is
    // the same as no clearing at all. Read only the BODY of logout, with
    // comments stripped — a greedy match runs past the function and finds
    // the word anywhere in the file, including inside a comment, which is
    // how the first version of this test passed while logout did nothing.
    const src = require("fs").readFileSync(require("path").join(__dirname, "auth.js"), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const body = /const logout = \(\) => \{([\s\S]*?)\n {2}\};/.exec(src);
    expect(body).toBeTruthy();
    expect(body[1]).toContain("clearAllAuthCarts()");
  });
});

// ───────────────────────────────────────────── the restore re-resolves

describe("what the restore checks again", () => {
  test("the price shown is the catalogue's, never the stored one", async () => {
    // A hand-edited store claiming this leash is a dollar.
    localStorage.setItem(authCartKey(CLIENT), JSON.stringify({
      version: 1, lines: [{ kind: "product", ref_id: "p1", quantity: 1, price: 1 }],
    }));
    mount();
    await flush();
    expect(api.get).toHaveBeenCalledWith("/shop/catalog");
    expect(seen.cart[0].price).toBeUndefined();   // no price on the line at all
  });

  test("an item that no longer exists is dropped, and said out loud", async () => {
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "withdrawn", quantity: 1 }]);
    mount();
    await flush();
    expect(seen.cart).toEqual([]);
    expect(seen.notices.join(" ")).toMatch(/no longer available/i);
  });

  test("a quantity above what is left is cut down to what is left", async () => {
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "p2", quantity: 5 }]);
    mount();
    await flush();
    expect(seen.cart).toEqual([{ kind: "product", ref_id: "p2", quantity: 1 }]);
    expect(seen.notices.join(" ")).toMatch(/only 1 available/i);
  });

  test("a sold-out item is dropped rather than carried to checkout", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/shop/catalog") {
        return Promise.resolve({ data: { items: [{ ...CATALOG[1], stock_on_hand: 0 }] } });
      }
      return Promise.resolve({ data: DOGS });
    });
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "p2", quantity: 2 }]);
    mount();
    await flush();
    expect(seen.cart).toEqual([]);
  });

  test("a line whose dog is no longer on the account is dropped, never re-pointed", async () => {
    writeAuthCart(CLIENT, [{ kind: "training_program", ref_id: "school-1", quantity: 1, dog_id: "dog-gone" }]);
    mount();
    await flush();
    // Buying a course for the wrong dog is worse than buying nothing.
    expect(seen.cart).toEqual([]);
    expect(seen.notices.join(" ")).toMatch(/no longer on your account/i);
  });

  test("a dog that IS still on the account survives", async () => {
    writeAuthCart(CLIENT, [{ kind: "training_program", ref_id: "school-1", quantity: 1, dog_id: "dog-1" }]);
    mount();
    await flush();
    expect(seen.cart).toEqual([{ kind: "training_program", ref_id: "school-1", quantity: 1, dog_id: "dog-1" }]);
  });

  test("an online-school course with no dog attached is dropped", async () => {
    localStorage.setItem(authCartKey(CLIENT), JSON.stringify({
      version: 1, lines: [{ kind: "training_program", ref_id: "school-1", quantity: 1 }],
    }));
    mount();
    await flush();
    expect(seen.cart).toEqual([]);
  });

  test("a Shopify-fulfilled product is dropped — its checkout is not ours", async () => {
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "shopify", quantity: 1 }]);
    mount();
    await flush();
    expect(seen.cart).toEqual([]);
  });

  test("two gift cards of the same value for two people stay two lines", async () => {
    writeAuthCart(CLIENT, [
      { kind: "gift_card", ref_id: "gc-2500", quantity: 1, gift: { recipient_email: "nan@example.com", recipient_name: "Nan" } },
      { kind: "gift_card", ref_id: "gc-2500", quantity: 1, gift: { recipient_email: "sam@example.com", recipient_name: "Sam" } },
    ]);
    mount();
    await flush();
    expect(seen.cart).toHaveLength(2);
    expect(seen.cart.map((l) => l.gift.recipient_email).sort()).toEqual(["nan@example.com", "sam@example.com"]);
  });

  test("the pruned cart is what gets written back", async () => {
    writeAuthCart(CLIENT, [
      { kind: "product", ref_id: "p1", quantity: 1 },
      { kind: "product", ref_id: "withdrawn", quantity: 1 },
    ]);
    mount();
    await flush();
    expect(raw().lines).toEqual([{ kind: "product", ref_id: "p1", quantity: 1 }]);
  });

  test("a catalogue that will not load leaves the stored cart alone", async () => {
    // Better to restore nothing this time than to throw away a real cart
    // because one request failed.
    api.get.mockImplementation((url) => (url === "/shop/catalog"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ data: DOGS })));
    writeAuthCart(CLIENT, [{ kind: "product", ref_id: "p1", quantity: 2 }]);
    mount();
    await flush();
    expect(seen.cart).toEqual([]);
    expect(readAuthCart(CLIENT)).toEqual([{ kind: "product", ref_id: "p1", quantity: 2 }]);
  });

  test("an empty stored cart costs no requests at all", async () => {
    mount();
    await flush();
    expect(api.get).not.toHaveBeenCalled();
  });
});
