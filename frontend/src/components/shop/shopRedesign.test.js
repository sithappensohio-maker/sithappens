/**
 * The redesigned Shop, mounted.
 *
 * These render the real components rather than reading their source,
 * because the things that went wrong in this redesign were all render-time:
 * a card that was a clickable div, a summary whose lines did not add up to
 * its own subtotal, a department tile that orphaned itself on a row.
 *
 * Two rules recur and are worth stating once:
 *   · nothing is claimed that the data cannot prove;
 *   · every control is a real control — a button or a link, reachable by
 *     keyboard, with a name a screen reader can read out.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MerchCard, TrainingCard, ValueCard, GiftCardCard, ShopCard } from "./ShopCards";
import { DepartmentNav, ShopSearch, SortSelect, FilterControls, ProductGrid } from "./ShopBrowse";
import CartPanel, { CartLine, CartSummary, AccountRequiredNotice, guestBlockers } from "./ShopCart";
import ShopLanding from "./ShopLanding";
import { QuantityStepper, Price } from "./ShopPrimitives";
import ProductFacts from "./ProductFacts";
import { DEPARTMENTS } from "../../lib/shopDepartments";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });

const mount = (el) => act(() => { root = createRoot(container); root.render(el); });
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const byTestId = (id) => q(`[data-testid="${id}"]`);
const text = () => document.body.textContent;

const leash = { kind: "product", id: "p1", name: "Husky Rope Leash", price: 24,
                availability: "in_stock", featured: true, guest_cart_allowed: true,
                track_inventory: true, in_stock: true, stock_on_hand: 9, category_id: "c1",
                category_name: "Gear" };
const soldOut = { ...leash, id: "p3", name: "Slip Lead", featured: false,
                  availability: "out_of_stock", in_stock: false, stock_on_hand: 0 };
const hoodie = { ...leash, id: "p2", name: "Hoodie", price: 58, featured: false,
                 category_id: "c2", category_name: "Apparel" };
const program = { kind: "training_program", id: "t1", name: "Reactive Recovery", price: 950,
                  description: "For dogs that bark and lunge.", helps_with: ["Lead reactivity", "Barking"],
                  format_count: 10, format_unit: "sessions", estimated_weeks: 12,
                  requires_dog: true, account_required: true, purchase_fulfillment: "credits_only" };
const school = { ...program, id: "t2", name: "Rock Solid Recall", price: 119,
                 purchase_fulfillment: "online_school" };
const pack = { kind: "credit_pack", id: "k1", name: "10 Daycare Visits", price: 280, qty: 10,
               display_quantity: 10, display_unit: "visits", service_type: "daycare",
               account_required: true };
const gift = { kind: "gift_card", id: "gc-2500", name: "Gift card · $25", price: 25,
               guest_cart_allowed: true };

// ═══════════════════════════════════════════════════════════════ cards

describe("cards", () => {
  test("a merch card leads with the photograph, the name and the price", () => {
    mount(<MerchCard item={leash} mode="guest" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(byTestId("shop-product-image")).toBeTruthy();
    expect(text()).toContain("Husky Rope Leash");
    expect(byTestId("shop-price").textContent).toContain("$24.00");
    // No paragraph of description on a grid card.
    expect(text()).not.toContain("For dogs that bark");
  });

  test("a card is a real control, not a clickable div", () => {
    // The old cards were <div onClick>: invisible to the keyboard and
    // announced as nothing at all.
    const opened = [];
    mount(<MerchCard item={leash} mode="guest" onOpenDetail={(i) => opened.push(i.id)} onAdd={() => {}} />);
    const opener = byTestId("shop-card-product-p1-open");
    expect(opener.tagName).toBe("BUTTON");
    expect(opener.getAttribute("aria-label")).toBe("View Husky Rope Leash");
    act(() => opener.click());
    expect(opened).toEqual(["p1"]);
  });

  test("adding to the cart does not also open the product", () => {
    const opened = [], added = [];
    mount(<MerchCard item={leash} mode="guest" onOpenDetail={() => opened.push(1)}
                     onAdd={(i) => added.push(i.id)} />);
    act(() => byTestId("shop-buy-product-p1").click());
    expect(added).toEqual(["p1"]);
    expect(opened).toEqual([]);
  });

  test("a sold-out card says so and cannot be added", () => {
    mount(<MerchCard item={soldOut} mode="guest" onOpenDetail={() => {}} onAdd={() => {}} />);
    const btn = byTestId("shop-buy-product-p3");
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/sold out/i);
    expect(byTestId("shop-badge-sold_out")).toBeTruthy();
  });

  test("badges only ever show states the data proves", () => {
    mount(<MerchCard item={leash} mode="guest" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(byTestId("shop-badge-featured")).toBeTruthy();
    expect(text()).not.toMatch(/best seller|only \d+ left|hurry|selling fast/i);
  });

  test("a training card explains rather than just pricing", () => {
    mount(<TrainingCard item={program} mode="guest" onOpenDetail={() => {}} onRequireAccount={() => {}} />);
    expect(text()).toContain("For dogs that bark and lunge.");
    expect(text()).toContain("Lead reactivity");
    expect(text()).toContain("10 sessions");
    expect(text()).toContain("about 12 weeks");
    expect(text()).toContain("Choose your dog at checkout");
  });

  test("a training card with nothing authored says less rather than inventing it", () => {
    const bare = { kind: "training_program", id: "t9", name: "Something", price: 100 };
    mount(<TrainingCard item={bare} mode="guest" onOpenDetail={() => {}} onRequireAccount={() => {}} />);
    expect(text()).toContain("Something");
    expect(text()).not.toMatch(/undefined|NaN|about  weeks/);
  });

  test("an Online School card is marked as one", () => {
    mount(<TrainingCard item={school} mode="guest" onOpenDetail={() => {}} onRequireAccount={() => {}} />);
    expect(text()).toContain("Online School");
    expect(text()).toContain("Work at your own pace");
  });

  test("a value card leads with the price per visit", () => {
    mount(<ValueCard item={pack} mode="authenticated" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(byTestId("shop-pack-each").textContent).toBe("$28.00");
    expect(text()).toContain("10 visits");
    expect(text()).toContain("$280.00");
  });

  test("a value card claims a saving only when a baseline proves one", () => {
    mount(<ValueCard item={pack} mode="authenticated" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(byTestId("shop-pack-saving")).toBeNull();
    act(() => root.unmount());
    root = null;
    mount(<ValueCard item={pack} baselinePrice={35} mode="authenticated"
                     onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(byTestId("shop-pack-saving").textContent).toContain("20%");
  });

  test("a gift card looks like a present, not a product", () => {
    mount(<GiftCardCard item={gift} mode="guest" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(text()).toContain("$25.00");
    expect(text()).toMatch(/emailed straight through/i);
    expect(text()).toMatch(/does not expire/i);
  });

  test("the right card is chosen for the thing, every time", () => {
    const cases = [[leash, "Husky Rope Leash"], [program, "Lead reactivity"],
                   [pack, "per visit"], [gift, "Emailed straight through"]];
    for (const [item, marker] of cases) {
      mount(<ShopCard item={item} mode="guest" onOpenDetail={() => {}} onAdd={() => {}} onRequireAccount={() => {}} />);
      expect(text()).toContain(marker);
      act(() => root.unmount());
      root = null;
    }
  });

  test("a guest sees sign-in on an account-bound item and add-to-cart on gear", () => {
    mount(<ShopCard item={pack} mode="guest" onOpenDetail={() => {}} onRequireAccount={() => {}} />);
    expect(byTestId("shop-buy-credit_pack-k1").textContent).toMatch(/sign in/i);
    act(() => root.unmount()); root = null;
    mount(<ShopCard item={leash} mode="guest" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(byTestId("shop-buy-product-p1").textContent).toMatch(/add to cart/i);
  });
});

// ════════════════════════════════════════════════ search / sort / filter

describe("browsing controls", () => {
  test("departments are a labelled navigation with a current page", () => {
    const depts = DEPARTMENTS.slice(0, 3).map((d) => ({ ...d, count: 2 }));
    mount(<DepartmentNav departments={depts} current="gear" onSelect={() => {}} />);
    expect(q('nav[aria-label="Shop departments"]')).toBeTruthy();
    expect(byTestId("shop-dept-gear").getAttribute("aria-current")).toBe("page");
    expect(byTestId("shop-dept-training").getAttribute("aria-current")).toBeNull();
  });

  test("choosing a department reports it", () => {
    const picked = [];
    const depts = DEPARTMENTS.slice(0, 2).map((d) => ({ ...d, count: 1 }));
    mount(<DepartmentNav departments={depts} current={null} onSelect={(k) => picked.push(k)} />);
    act(() => byTestId("shop-dept-training").click());
    expect(picked).toEqual(["training"]);
  });

  test("search is labelled, clearable and does not fire on every keystroke", async () => {
    const seen = [];
    mount(<ShopSearch value="" onChange={(v) => seen.push(v)} />);
    const input = byTestId("shop-search");
    expect(input.getAttribute("type")).toBe("search");
    expect(q(`label[for="${input.id}"]`).textContent).toMatch(/search/i);
    await act(async () => {
      for (const v of ["l", "le", "lea"]) {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 220));
    });
    // Debounced: three keystrokes, one update, and it is the final value.
    expect(seen).toEqual(["lea"]);
  });

  test("the clear button empties the search", async () => {
    const seen = [];
    mount(<ShopSearch value="leash" onChange={(v) => seen.push(v)} />);
    await act(async () => { byTestId("shop-search-clear").click(); });
    expect(seen).toContain("");
  });

  test("sorting is a labelled select offering only honourable sorts", () => {
    mount(<SortSelect value="featured" onChange={() => {}} />);
    const sel = byTestId("shop-sort");
    expect(q(`label[for="${sel.id}"]`)).toBeTruthy();
    expect(sel.textContent).not.toMatch(/best sell/i);
    expect(sel.textContent).toContain("Price: Low to High");
  });

  test("no filter is offered when none could do anything", () => {
    // One category, everything in stock, one price.
    mount(<FilterControls items={[leash]} filters={{}} onChange={() => {}} compact />);
    expect(byTestId("shop-filter-open")).toBeNull();
  });

  test("a filter appears once it could actually divide the list", () => {
    mount(<FilterControls items={[leash, hoodie, soldOut]} filters={{}} onChange={() => {}} compact />);
    expect(byTestId("shop-filter-open")).toBeTruthy();
  });

  test("the mobile filter sheet is a dialog with apply and reset", async () => {
    const applied = [];
    mount(<FilterControls items={[leash, hoodie, soldOut]} filters={{}}
                          onChange={(f) => applied.push(f)} compact />);
    await act(async () => { byTestId("shop-filter-open").click(); });
    const sheet = byTestId("shop-filter-sheet");
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    await act(async () => { byTestId("shop-filter-cat-c2").click(); });
    await act(async () => { byTestId("shop-filter-apply").click(); });
    expect(applied[applied.length - 1].categoryId).toBe("c2");
  });

  test("escape closes the filter sheet", async () => {
    mount(<FilterControls items={[leash, hoodie, soldOut]} filters={{}} onChange={() => {}} compact />);
    await act(async () => { byTestId("shop-filter-open").click(); });
    expect(byTestId("shop-filter-sheet")).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(byTestId("shop-filter-sheet")).toBeNull();
  });

  test("the grid lays out by department rather than one size for everything", () => {
    mount(<ProductGrid items={[leash, hoodie]} layout="grid" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(byTestId("shop-product-grid").dataset.layout).toBe("grid");
    // Two up on a phone — the old Shop showed one merchandise card per screen.
    expect(byTestId("shop-product-grid").className).toMatch(/grid-cols-2/);
    act(() => root.unmount()); root = null;
    mount(<ProductGrid items={[program]} layout="editorial" onOpenDetail={() => {}} onRequireAccount={() => {}} />);
    expect(byTestId("shop-product-grid").className).toMatch(/grid-cols-1/);
  });

  test("loading shows shaped skeletons, not a spinner on an empty page", () => {
    mount(<ProductGrid items={[]} layout="grid" loading skeletonCount={4} />);
    expect(qa('[data-testid="shop-card-skeleton"]').length).toBe(4);
    expect(q('[aria-busy="true"]')).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════ cart

describe("the cart", () => {
  const line = (item, extra = {}) => ({
    kind: item.kind, ref_id: item.id, quantity: 1, item, ...extra,
  });

  test("a merchandise line shows its thumbnail, price, quantity and how it is collected", () => {
    mount(<ul><CartLine line={line(leash, { quantity: 2 })} onQtyChange={() => {}} onRemove={() => {}} /></ul>);
    expect(text()).toContain("Husky Rope Leash");
    expect(byTestId("shop-price").textContent).toContain("$48.00");
    expect(text()).toContain("$24.00 each");
    expect(byTestId("cart-line-pickup")).toBeTruthy();
    expect(byTestId("shop-qty-value-p1").textContent).toBe("2");
  });

  test("quantity controls are labelled for a screen reader", () => {
    mount(<ul><CartLine line={line(leash)} onQtyChange={() => {}} onRemove={() => {}} /></ul>);
    expect(byTestId("shop-qty-plus-p1").getAttribute("aria-label")).toMatch(/increase quantity/i);
    expect(byTestId("shop-qty-minus-p1").getAttribute("aria-label")).toMatch(/decrease quantity/i);
  });

  test("a gift card line says who it is going to", () => {
    const l = line(gift, { gift: { recipient_email: "nan@example.com", recipient_name: "Nan" } });
    mount(<ul><CartLine line={l} onQtyChange={() => {}} onRemove={() => {}} /></ul>);
    expect(byTestId("cart-line-gift").textContent).toContain("Nan");
  });

  test("a gift card bought for yourself says that instead", () => {
    mount(<ul><CartLine line={line(gift)} onQtyChange={() => {}} onRemove={() => {}} /></ul>);
    expect(byTestId("cart-line-self").textContent).toMatch(/emailed to you/i);
  });

  test("a dog-bound line names the dog", () => {
    const l = line(school, { dog_id: "d1", dog_name: "Rex" });
    mount(<ul><CartLine line={l} onQtyChange={() => {}} onRemove={() => {}} /></ul>);
    expect(byTestId("cart-line-dog").textContent).toContain("Rex");
  });

  test("only merchandise gets a quantity stepper", () => {
    // A gift card for one named person and a dog's enrolment are not things
    // you buy three of from a stepper.
    mount(<ul><CartLine line={line(gift)} onQtyChange={() => {}} onRemove={() => {}} /></ul>);
    expect(byTestId("shop-qty-value-gc-2500")).toBeNull();
    expect(text()).toContain("Qty 1");
  });

  test("removing names what it removes", () => {
    const removed = [];
    mount(<ul><CartLine line={line(leash)} onQtyChange={() => {}}
                        onRemove={(k, r) => removed.push([k, r])} /></ul>);
    const btn = byTestId("shop-cart-remove-p1");
    expect(btn.getAttribute("aria-label")).toBe("Remove Husky Rope Leash from your cart");
    act(() => btn.click());
    expect(removed).toEqual([["product", "p1"]]);
  });

  test("the summary's lines add up to its own total", () => {
    // The guest-checkout browser QA caught this exact thing going wrong:
    // per-line amounts that already contained tax, printed above a
    // tax-exclusive subtotal. Subtotal + tax must equal total, visibly.
    mount(<CartSummary subtotal={25} tax={1.88} total={26.88} />);
    expect(byTestId("cart-subtotal").textContent).toBe("$25.00");
    expect(byTestId("cart-tax").textContent).toBe("$1.88");
    expect(byTestId("cart-total").textContent).toBe("$26.88");
  });

  test("before checkout it does not pretend to know the tax", () => {
    mount(<CartSummary subtotal={25} />);
    expect(byTestId("cart-tax")).toBeNull();
    expect(byTestId("cart-total").textContent).toBe("$25.00");
    expect(text()).toMatch(/added at checkout/i);
  });

  test("a guest cart of gear can just check out, with no nagging", () => {
    mount(<CartPanel lines={[line(leash)]} subtotal={24} guestMode
                     onQtyChange={() => {}} onRemove={() => {}} onCheckout={() => {}}
                     onClose={() => {}} onSignIn={() => {}} />);
    const btn = byTestId("shop-checkout-button");
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toMatch(/continue to secure checkout/i);
    expect(byTestId("cart-account-required")).toBeNull();
  });

  test("an account-required cart explains itself and offers a way in", () => {
    mount(<CartPanel lines={[line(leash), line(pack)]} subtotal={304} guestMode
                     onQtyChange={() => {}} onRemove={() => {}} onCheckout={() => {}}
                     onClose={() => {}} onSignIn={() => {}} />);
    const notice = byTestId("cart-account-required");
    expect(notice.textContent).toContain("10 Daycare Visits");
    expect(notice.textContent).toMatch(/your cart stays as it is/i);
    expect(byTestId("cart-sign-in")).toBeTruthy();
    // Both lines are still there — nothing was silently dropped or split.
    expect(qa('[data-testid^="shop-cart-line-"]').length).toBe(2);
    expect(byTestId("shop-checkout-button").textContent).toMatch(/sign in to check out/i);
  });

  test("only the blocking lines are flagged", () => {
    mount(<CartPanel lines={[line(leash), line(pack)]} subtotal={304} guestMode
                     onQtyChange={() => {}} onRemove={() => {}} onCheckout={() => {}}
                     onClose={() => {}} onSignIn={() => {}} />);
    expect(qa('[data-testid="cart-line-needs-account"]').length).toBe(1);
  });

  test("a signed-in client is never told to sign in", () => {
    mount(<CartPanel lines={[line(pack)]} subtotal={280} guestMode={false}
                     onQtyChange={() => {}} onRemove={() => {}} onCheckout={() => {}}
                     onClose={() => {}} onSignIn={() => {}} />);
    expect(byTestId("cart-account-required")).toBeNull();
    expect(byTestId("shop-checkout-button").disabled).toBe(false);
  });

  test("guestBlockers names the lines, not just a yes or no", () => {
    const blocked = guestBlockers([line(leash), line(pack), line(program)]);
    expect(blocked.map((l) => l.ref_id)).toEqual(["k1", "t1"]);
  });

  test("an empty cart offers somewhere to go", () => {
    mount(<CartPanel lines={[]} subtotal={0} onQtyChange={() => {}} onRemove={() => {}}
                     onCheckout={() => {}} onClose={() => {}} onSignIn={() => {}} />);
    expect(byTestId("shop-cart-empty")).toBeTruthy();
    expect(byTestId("shop-cart-empty-browse")).toBeTruthy();
    expect(byTestId("shop-checkout-button")).toBeNull();
  });

  test("the cart is a dialog that escape closes", async () => {
    let closed = false;
    mount(<CartPanel lines={[line(leash)]} subtotal={24} onQtyChange={() => {}} onRemove={() => {}}
                     onCheckout={() => {}} onClose={() => { closed = true; }} onSignIn={() => {}} />);
    expect(q('[role="dialog"][aria-modal="true"]')).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(closed).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════ landing

describe("the storefront landing", () => {
  const items = [leash, hoodie, program, school, pack, gift];
  const depts = [
    { key: "gear", label: "Gear", tagline: "t", count: 2 },
    { key: "training", label: "Training", tagline: "t", count: 1 },
    { key: "gift_cards", label: "Gift Cards", tagline: "t", count: 1 },
  ];

  const render = (extra = {}) => mount(
    <ShopLanding items={items} departments={depts} shopPage={{}} mode="guest"
                 onSelectDepartment={() => {}} onOpenDetail={() => {}} onAdd={() => {}}
                 onRequireAccount={() => {}} onShopify={() => {}} {...extra} />,
  );

  test("there is exactly one h1, and it is the shop's own", () => {
    render();
    const h1s = qa("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toContain("Shop Sit Happens");
  });

  test("every department is reachable from the front page", () => {
    render();
    for (const d of depts) expect(byTestId(`shop-dept-tile-${d.key}`)).toBeTruthy();
    expect(q('nav[aria-label="Shop departments"]')).toBeTruthy();
  });

  test("an odd last department spans the row rather than orphaning", () => {
    render();
    expect(byTestId("shop-dept-tile-gift_cards").className).toMatch(/col-span-2/);
  });

  test("sections are headed and labelled, so the page has a real outline", () => {
    render();
    const labelled = qa("section[aria-labelledby]");
    expect(labelled.length).toBeGreaterThanOrEqual(4);
    expect(text()).toContain("Kit we actually use");
    expect(text()).toContain("Work with a trainer");
  });

  test("a section with nothing in it is not rendered at all", () => {
    mount(<ShopLanding items={[leash]} departments={[depts[0]]} shopPage={{}} mode="guest"
                       onSelectDepartment={() => {}} onOpenDetail={() => {}} onAdd={() => {}}
                       onRequireAccount={() => {}} onShopify={() => {}} />);
    expect(text()).not.toContain("Work with a trainer");
    expect(text()).not.toContain("Buy visits up front");
  });

  test("the admin's own hero copy is used when they have set it", () => {
    render({ shopPage: { title: "The Sit Happens Store", subtitle: "Good things for good dogs." } });
    expect(q("h1").textContent).toBe("The Sit Happens Store");
    expect(text()).toContain("Good things for good dogs.");
  });

  test("Online School keeps a spotlight of its own", () => {
    render();
    expect(byTestId("shop-school-spotlight")).toBeTruthy();
    expect(text()).toContain("Train your dog, anywhere");
  });

  test("the school spotlight shows real numbers, or none", () => {
    render();
    expect(byTestId("shop-school-stat-dogs")).toBeNull();
    expect(text()).toContain("Self-paced");
    act(() => root.unmount()); root = null;
    render({ schoolStats: { dogs_trained: 400, rating_average: 4.8, rating_count: 40 } });
    expect(byTestId("shop-school-stat-dogs")).toBeTruthy();
  });

  test("the trust block states facts, not testimonials", () => {
    render();
    expect(byTestId("shop-trust")).toBeTruthy();
    expect(text()).toMatch(/Stripe/);
    expect(text()).not.toMatch(/★|5 stars|customers love|testimonial/i);
  });
});

// ═══════════════════════════════════════════════════════ primitives

describe("primitives", () => {
  test("a stepper will not go below its minimum or above the stock", () => {
    mount(<QuantityStepper value={1} max={3} onChange={() => {}} />);
    expect(byTestId("shop-qty-minus").disabled).toBe(true);
    act(() => root.unmount()); root = null;
    mount(<QuantityStepper value={3} max={3} onChange={() => {}} />);
    expect(byTestId("shop-qty-plus").disabled).toBe(true);
    expect(byTestId("shop-qty-plus").getAttribute("title")).toMatch(/all we have/i);
  });

  test("a struck-through price only shows when it is genuinely higher", () => {
    mount(<Price amount={20} was={30} />);
    expect(text()).toContain("$30.00");
    act(() => root.unmount()); root = null;
    mount(<Price amount={20} was={20} />);
    expect(document.querySelectorAll(".line-through")).toHaveLength(0);
  });
});

// ══════════════════════════════════════════ product detail blocks

describe("product facts", () => {
  test("a field that is an object is never rendered as one", () => {
    // `school_support` comes back from the real catalog as {} — and {} is
    // truthy, so it walked straight past a truthiness guard, reached React
    // as a child object and took the whole product page down. Found by
    // signing in as a real client, not by any unit test.
    const hostile = {
      kind: "training_program", id: "t9", name: "Rock Solid Recall",
      purchase_fulfillment: "online_school",
      school_support: {},                 // the real shape
      school_onboarding: {},
      helps_with: ["Recall", {}, null, "", 42],
      format_count: 8, format_unit: "lessons", lesson_count: 1, module_count: 1,
      requires_dog: true, min_age_months: 0,
    };
    mount(<ProductFacts item={hostile} mode="authenticated" />);
    expect(byTestId("pdp-facts")).toBeTruthy();
    expect(text()).toContain("Recall");
    expect(text()).toContain("8 lessons");
    // Nothing stringified an object into the page.
    expect(text()).not.toContain("[object Object]");
    // A numeric entry is kept as text; the empty and null ones are dropped.
    expect(byTestId("pdp-helps-list").children).toHaveLength(2);
  });

  test("a section with nothing real to say does not render", () => {
    const bare = { kind: "product", id: "p9", name: "Thing" };
    mount(<ProductFacts item={bare} mode="guest" />);
    expect(byTestId("pdp-helps")).toBeNull();
    expect(byTestId("pdp-requirements")).toBeNull();
  });

  test("min age of zero is not a requirement", () => {
    mount(<ProductFacts item={{ kind: "training_program", id: "t8", name: "X",
                                requires_dog: true, min_age_months: 0 }} mode="authenticated" />);
    expect(text()).toContain("choose which dog");
    expect(text()).not.toMatch(/at least 0 months/);
  });
});
