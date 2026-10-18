/**
 * The Shop's information architecture.
 *
 * The old Shop had tabs named after database kinds and one flat grid of
 * everything. These tests pin the replacement: departments a customer would
 * recognise, and search/sort/filter that only ever offer controls which can
 * actually do something.
 *
 * Two rules are load-bearing and easy to lose later:
 *   1. Nothing is claimed that the data cannot prove — no Best Seller, no
 *      invented discount, no urgency.
 *   2. Sorting is deterministic, so a grid does not shuffle while somebody
 *      is looking at it.
 */
import {
  DEPARTMENTS, effectiveDepartments, departmentForItem, departmentByKey,
  itemsInDepartment, visibleDepartments, resolveDepartmentParam,
  searchItems, sortItems, SORTS, availableFilters, applyFilters,
  activeFilterCount, browseItems, badgesFor, packValue, EMPTY_FILTERS,
} from "./shopDepartments";

const leash = { kind: "product", id: "p1", name: "Husky Rope Leash", price: 24,
                category_id: "c1", category_name: "Everyday Gear", featured: true,
                listed_on: "2026-01-01", availability: "in_stock" };
const hoodie = { kind: "product", id: "p2", name: "Sit Happens Hoodie", price: 58,
                 category_id: "c2", category_name: "Apparel",
                 listed_on: "2026-03-01", availability: "in_stock" };
const soldOut = { kind: "product", id: "p3", name: "Slip Lead", price: 16,
                  category_id: "c1", category_name: "Everyday Gear",
                  listed_on: "2026-02-01", availability: "out_of_stock" };
const inPerson = { kind: "training_program", id: "t1", name: "Reactive Recovery",
                   price: 950, purchase_fulfillment: "credits_only",
                   helps_with: ["Lead reactivity"], listed_on: "2026-01-15" };
const online = { kind: "training_program", id: "t2", name: "Rock Solid Recall",
                 price: 119, purchase_fulfillment: "online_school",
                 listed_on: "2026-02-15" };
const pack = { kind: "credit_pack", id: "k1", name: "10 Daycare Visits", price: 280,
               qty: 10, display_quantity: 10, display_unit: "visits",
               service_type: "daycare", listed_on: "2026-01-20" };
const gift = { kind: "gift_card", id: "gc-2500", name: "Gift card · $25", price: 25 };

const ALL = [leash, hoodie, soldOut, inPerson, online, pack, gift];

// ───────────────────────────────────────────────────────── departments

describe("departments are what a customer would call them", () => {
  test("every kind lands in exactly one department", () => {
    for (const item of ALL) {
      const found = DEPARTMENTS.filter(
        (d) => d.kinds.includes(item.kind) && (!d.match || d.match(item)));
      expect(found).toHaveLength(1);
    }
  });

  test("in-person training and Online School are different departments", () => {
    // They share a database kind. They are not the same purchase, and the
    // old tab scheme could only tell them apart by a flag nobody saw.
    expect(departmentForItem(inPerson).key).toBe("training");
    expect(departmentForItem(online).key).toBe("online_school");
  });

  test("each department carries how it should be presented", () => {
    expect(departmentForItem(leash).layout).toBe("grid");
    expect(departmentForItem(inPerson).layout).toBe("editorial");
    expect(departmentForItem(pack).layout).toBe("value");
    expect(departmentForItem(gift).layout).toBe("gift");
  });

  test("a department holds only its own things", () => {
    expect(itemsInDepartment(ALL, "gear").map((i) => i.id)).toEqual(["p1", "p2", "p3"]);
    expect(itemsInDepartment(ALL, "online_school").map((i) => i.id)).toEqual(["t2"]);
  });

  test("an empty department is not offered", () => {
    // A shop that lists five departments and fills two looks broken.
    const keys = visibleDepartments([leash, gift]).map((d) => d.key);
    expect(keys).toEqual(["gear", "gift_cards"]);
  });

  test("the admin's section switches still hide a department", () => {
    const keys = visibleDepartments(ALL, { sectionVisible: (s) => s !== "merch" })
      .map((d) => d.key);
    expect(keys).not.toContain("gear");
    expect(keys).toContain("training");
  });

  test("turning a section off never hides gift cards, which belong to none", () => {
    const keys = visibleDepartments(ALL, { sectionVisible: () => false }).map((d) => d.key);
    expect(keys).toEqual(["gift_cards"]);
  });

  // Owner, 2026-10-17: "grooming category isnt showing as an option and
  // its placing grooming items under gear" (fixed with a one-off hardcoded
  // "grooming" department), then "i need to be able to add these categories
  // my self as well for future stuff" — replaced by this general mechanism:
  // any Merch & Gear category with `is_department` set becomes its own
  // department, read off Shop Manager's own category data, no code change
  // needed per category.
  describe("self-service departments, read off a Merch & Gear category's own is_department flag", () => {
    const bath = { kind: "product", id: "p4", name: "Bath", price: 20, category_id: "cat-groom" };
    const plainGear = { kind: "product", id: "p5", name: "Harness", price: 30, category_id: "c1" };
    const groomingCategory = { id: "cat-groom", name: "Grooming", description: "Bath, nail trims and other grooming extras.",
                                section: "merch", is_department: true, active: true, image_id: "img-groom" };

    test("a product whose category is flagged lands in that department, not gear", () => {
      expect(departmentForItem(bath, [groomingCategory]).key).toBe("cat:cat-groom");
      expect(departmentForItem(bath, [groomingCategory]).label).toBe("Grooming");
    });

    test("without the categories argument, every product still lands in gear — unchanged default", () => {
      expect(departmentForItem(bath).key).toBe("gear");
    });

    test("a product in an unflagged category still lands in gear", () => {
      expect(departmentForItem(plainGear, [groomingCategory]).key).toBe("gear");
    });

    test("gear and the custom department never share an item", () => {
      const items = [bath, plainGear];
      expect(itemsInDepartment(items, "gear", [groomingCategory]).map((i) => i.id)).toEqual(["p5"]);
      expect(itemsInDepartment(items, "cat:cat-groom", [groomingCategory]).map((i) => i.id)).toEqual(["p4"]);
    });

    test("matched by category_id, not name — surviving a rename unlike the old one-off version", () => {
      const renamed = { ...bath, id: "p6" };
      const renamedCategory = { ...groomingCategory, name: "Grooming & Spa Day" };
      expect(departmentForItem(renamed, [renamedCategory]).key).toBe("cat:cat-groom");
    });

    test("a Training or Prepaid Visits category is never promoted, even if flagged", () => {
      const trainingCategory = { ...groomingCategory, id: "cat-train", section: "training" };
      expect(effectiveDepartments([trainingCategory])).toBe(DEPARTMENTS);
    });

    test("an inactive flagged category is dropped", () => {
      const inactive = { ...groomingCategory, active: false };
      expect(effectiveDepartments([inactive])).toBe(DEPARTMENTS);
    });

    test("the custom department shares the Merch & Gear section switch with gear", () => {
      const keys = visibleDepartments([bath], { sectionVisible: (s) => s !== "merch", categories: [groomingCategory] })
        .map((d) => d.key);
      expect(keys).not.toContain("cat:cat-groom");
    });

    test("departmentByKey and resolveDepartmentParam resolve the custom key when categories are passed", () => {
      expect(departmentByKey("cat:cat-groom", [groomingCategory])?.label).toBe("Grooming");
      expect(departmentByKey("cat:cat-groom")).toBeNull(); // not resolvable without categories
      const params = new URLSearchParams("?dept=cat:cat-groom");
      expect(resolveDepartmentParam(params, [groomingCategory])).toBe("cat:cat-groom");
    });

    test("the department's own cover image comes through for the tile", () => {
      expect(departmentForItem(bath, [groomingCategory]).coverImageId).toBe("img-groom");
    });
  });
});

// ────────────────────────────────────────────────────────────── search

describe("search", () => {
  test("it finds things by name", () => {
    expect(searchItems(ALL, "hoodie").map((i) => i.id)).toEqual(["p2"]);
  });

  test("it is case and whitespace forgiving", () => {
    expect(searchItems(ALL, "  HUSKY  ").map((i) => i.id)).toEqual(["p1"]);
  });

  test("a second word narrows rather than widens", () => {
    expect(searchItems(ALL, "rope leash").map((i) => i.id)).toEqual(["p1"]);
    expect(searchItems(ALL, "rope hoodie")).toEqual([]);
  });

  test("it searches what a shopper would type, including what a program helps with", () => {
    expect(searchItems(ALL, "reactivity").map((i) => i.id)).toEqual(["t1"]);
    expect(searchItems(ALL, "everyday gear").map((i) => i.id)).toEqual(["p1", "p3"]);
  });

  test("it never matches on admin-only fields", () => {
    // "Why did that come up?" is worse than "no results".
    const sneaky = { ...leash, id: "secret-id", internal_note: "reorder from supplier",
                     cost_price: 4.2, sku: "ZZZ-999" };
    expect(searchItems([sneaky], "supplier")).toEqual([]);
    expect(searchItems([sneaky], "ZZZ-999")).toEqual([]);
    expect(searchItems([sneaky], "secret-id")).toEqual([]);
  });

  // A description can now be real HTML (RichTextEditor — see
  // ManageProductsPanel.jsx): a search for "strong" must still find the
  // real bolded word, but the tag name itself must never be searchable.
  test("HTML tags in a description never become searchable text, but the real words still match", () => {
    const rich = { ...leash, id: "rich-1", description: "<p>Soft and <strong>strong</strong> nylon.</p>" };
    expect(searchItems([rich], "strong").map((i) => i.id)).toEqual(["rich-1"]);
    expect(searchItems([rich], "<strong>")).toEqual([]);
  });

  test("an empty query changes nothing", () => {
    expect(searchItems(ALL, "")).toHaveLength(ALL.length);
    expect(searchItems(ALL, "   ")).toHaveLength(ALL.length);
  });
});

// ────────────────────────────────────────────────────────────── sorting

describe("sorting", () => {
  test("the offered sorts are the ones we can honour", () => {
    expect(SORTS.map((s) => s.key))
      .toEqual(["featured", "newest", "price_asc", "price_desc"]);
    // No "Best Selling" until there is sales data to back it.
    expect(SORTS.map((s) => s.label.toLowerCase()).join(" ")).not.toContain("best");
  });

  test("price sorts run the right way", () => {
    const asc = sortItems([hoodie, leash, soldOut], "price_asc").map((i) => i.price);
    expect(asc).toEqual([16, 24, 58]);
    expect(sortItems([hoodie, leash, soldOut], "price_desc").map((i) => i.price))
      .toEqual([58, 24, 16]);
  });

  test("featured comes first", () => {
    expect(sortItems([hoodie, leash], "featured")[0].id).toBe("p1");
  });

  test("newest is newest", () => {
    expect(sortItems([leash, hoodie, soldOut], "newest").map((i) => i.id))
      .toEqual(["p2", "p3", "p1"]);
  });

  test("ties break the same way every time, so the grid cannot shuffle", () => {
    const a = { kind: "product", id: "b", name: "Same", price: 10 };
    const b = { kind: "product", id: "a", name: "Same", price: 10 };
    const once = sortItems([a, b], "price_asc").map((i) => i.id);
    const twice = sortItems([b, a], "price_asc").map((i) => i.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(["a", "b"]);
  });

  test("sorting does not mutate what it was given", () => {
    const input = [hoodie, leash];
    sortItems(input, "price_asc");
    expect(input.map((i) => i.id)).toEqual(["p2", "p1"]);
  });

  test("an unknown sort falls back rather than breaking the page", () => {
    expect(sortItems(ALL, "nonsense")).toHaveLength(ALL.length);
  });
});

// ──────────────────────────────────────────────────────────── filtering

describe("filters are only offered when they could do something", () => {
  test("one category means no category filter", () => {
    expect(availableFilters([leash, soldOut]).categories).toEqual([]);
  });

  test("two categories means a category filter", () => {
    expect(availableFilters([leash, hoodie]).categories.map((c) => c.name))
      .toEqual(["Apparel", "Everyday Gear"]);
  });

  test("availability is offered only when something is actually out of stock", () => {
    expect(availableFilters([leash, hoodie]).availability).toBe(false);
    expect(availableFilters([leash, soldOut]).availability).toBe(true);
  });

  test("a price range needs more than one price", () => {
    expect(availableFilters([leash]).priceRange).toBeNull();
    expect(availableFilters([leash, hoodie]).priceRange).toEqual({ min: 24, max: 58 });
  });

  test("filters actually filter", () => {
    expect(applyFilters(ALL, { categoryId: "c2" }).map((i) => i.id)).toEqual(["p2"]);
    expect(applyFilters(ALL, { availability: "in_stock" }).map((i) => i.id))
      .not.toContain("p3");
    expect(applyFilters([leash, hoodie], { maxPrice: 30 }).map((i) => i.id)).toEqual(["p1"]);
  });

  test("no filters means nothing is filtered", () => {
    expect(applyFilters(ALL, EMPTY_FILTERS)).toHaveLength(ALL.length);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  test("the active count is what the badge shows", () => {
    expect(activeFilterCount({ categoryId: "c1", availability: "in_stock" })).toBe(2);
  });
});

// ─────────────────────────────────────────────────── the whole pipeline

describe("browsing", () => {
  test("department, then search, then filter, then sort", () => {
    const out = browseItems(ALL, {
      // "lea" matches both Leash and Slip Lead; the stock filter then drops
      // the Slip Lead, which is what makes this a pipeline test rather than
      // four separate ones.
      department: "gear", query: "lea", filters: { availability: "in_stock" },
      sort: "price_asc",
    });
    expect(out.map((i) => i.id)).toEqual(["p1"]);   // Slip Lead is out of stock
  });

  test("sorting applies to what is on screen, not the whole catalog", () => {
    const out = browseItems(ALL, { department: "gear", sort: "price_asc" });
    expect(out.map((i) => i.price)).toEqual([16, 24, 58]);
    expect(out.every((i) => i.kind === "product")).toBe(true);
  });

  test("a search with no matches returns nothing rather than everything", () => {
    expect(browseItems(ALL, { query: "xylophone" })).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────── badges

describe("badges say only what is true", () => {
  test("featured and sold out come from real state", () => {
    expect(badgesFor(leash).map((b) => b.key)).toEqual(["featured"]);
    expect(badgesFor(soldOut).map((b) => b.key)).toEqual(["sold_out"]);
  });

  test("low stock is a real state, and does not shout", () => {
    const low = { ...leash, featured: false, availability: "low_stock" };
    expect(badgesFor(low).map((b) => b.label)).toEqual(["Low stock"]);
    // Not "Only 2 left!" — no count, no exclamation, no countdown.
    expect(badgesFor(low)[0].label).not.toMatch(/\d|!/);
  });

  test("sold out replaces low stock rather than stacking with it", () => {
    expect(badgesFor({ ...soldOut, availability: "out_of_stock" }).map((b) => b.key))
      .toEqual(["sold_out"]);
  });

  test("there is no best seller, because there is no sales data", () => {
    const all = ALL.flatMap(badgesFor).map((b) => b.key);
    expect(all).not.toContain("best_seller");
  });
});

// ──────────────────────────────────────────────────────── pack value

describe("prepaid value", () => {
  test("it works out the price per visit", () => {
    const v = packValue(pack);
    expect(v.quantity).toBe(10);
    expect(v.each).toBe(28);
    expect(v.unit).toBe("visits");
  });

  test("a saving is claimed only when a real baseline proves it", () => {
    expect(packValue(pack).savingPct).toBeNull();          // no baseline given
    expect(packValue(pack, 35).savingPct).toBe(20);        // £35 → £28 each
    expect(packValue(pack, 35).savingTotal).toBe(70);
  });

  test("a baseline that is not actually cheaper claims nothing", () => {
    expect(packValue(pack, 28).savingPct).toBeNull();
    expect(packValue(pack, 20).savingPct).toBeNull();
  });

  test("a pack with no quantity claims nothing at all", () => {
    expect(packValue({ kind: "credit_pack", price: 100 })).toBeNull();
  });
});
