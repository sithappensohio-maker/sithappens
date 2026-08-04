import {
  categoryOptionsForTab, subcategoryOptionsForTab, nextFiltersForTab,
  sortShopItems, singularUnit, stockCeiling, isInternalPhysical, orderStatusLabel,
  categoryGroupsForTab, uncategorizedItemsForTab, categoryCoverItem, matchesSearchQuery,
  OTHER_CATEGORY_ID,
  sectionMetaFor, visibleSectionsInOrder, categoryCoverImageId, shouldHideEmptyCategory,
  orderCategoryGroupsFeaturedFirst, filterFeaturedItems, guestItemCta,
  creditPackCardLine, creditPackDetailLine, creditPackStaffLine,
  creditPackAdminSummaryLines, creditPackEditorPreview,
} from "./shopPolish";

const categories = [
  { id: "cat-merch", name: "Merch", subcategories: [{ id: "sub-collars", name: "Collars" }, { id: "sub-toys", name: "Toys" }] },
  { id: "cat-training", name: "Training Gear", subcategories: [{ id: "sub-leads", name: "Leads" }] },
];

const merchProduct = { kind: "product", id: "p1", name: "Collar", category_id: "cat-merch", subcategory_id: "sub-collars" };
const merchProductNoSub = { kind: "product", id: "p2", name: "Toy", category_id: "cat-merch" };
const packItem = { kind: "credit_pack", id: "pk1", name: "5-Visit Pack", category_id: "cat-training" };
const programItem = { kind: "training_program", id: "pr1", name: "Puppy 101", category_id: "cat-training", subcategory_id: "sub-leads" };
const items = [merchProduct, merchProductNoSub, packItem, programItem];

test("categoryOptionsForTab only returns categories with a matching item in the selected tab", () => {
  expect(categoryOptionsForTab(categories, items, "product").map((c) => c.id)).toEqual(["cat-merch"]);
  expect(categoryOptionsForTab(categories, items, "training_program").map((c) => c.id)).toEqual(["cat-training"]);
  expect(categoryOptionsForTab(categories, items, "credit_pack").map((c) => c.id)).toEqual(["cat-training"]);
  // "all" sees every category that has any item at all
  expect(categoryOptionsForTab(categories, items, "all").map((c) => c.id).sort()).toEqual(["cat-merch", "cat-training"]);
});

test("subcategoryOptionsForTab only returns subcategories with a matching item in the selected tab + category", () => {
  expect(subcategoryOptionsForTab(categories, items, "product", "cat-merch").map((s) => s.id)).toEqual(["sub-collars"]);
  // training_program tab under cat-training does have sub-leads (programItem)
  expect(subcategoryOptionsForTab(categories, items, "training_program", "cat-training").map((s) => s.id)).toEqual(["sub-leads"]);
  // credit_pack tab under cat-training has no subcategory-tagged item (packItem has none)
  expect(subcategoryOptionsForTab(categories, items, "credit_pack", "cat-training")).toEqual([]);
  // no category selected -> no subcategory options
  expect(subcategoryOptionsForTab(categories, items, "product", "")).toEqual([]);
});

test("nextFiltersForTab clears the category filter when it no longer matches the new tab", () => {
  // cat-merch has no training_program items -> switching to that tab clears both filters
  expect(nextFiltersForTab(items, "training_program", "cat-merch", "sub-collars"))
    .toEqual({ categoryFilter: "", subcategoryFilter: "" });
});

test("nextFiltersForTab clears only the subcategory filter when the category is still valid but the subcategory isn't", () => {
  // cat-training is valid for training_program (programItem), but sub-collars only exists under cat-merch
  expect(nextFiltersForTab(items, "training_program", "cat-training", "sub-collars"))
    .toEqual({ categoryFilter: "cat-training", subcategoryFilter: "" });
});

test("nextFiltersForTab leaves both filters alone when both remain valid for the new tab", () => {
  expect(nextFiltersForTab(items, "training_program", "cat-training", "sub-leads"))
    .toEqual({ categoryFilter: "cat-training", subcategoryFilter: "sub-leads" });
});

test("nextFiltersForTab is a no-op when no category filter is set", () => {
  expect(nextFiltersForTab(items, "product", "", "")).toEqual({ categoryFilter: "", subcategoryFilter: "" });
});

test("sortShopItems puts featured items first regardless of name", () => {
  const list = [
    { name: "Zebra Leash", featured: false },
    { name: "Aardvark Bowl", featured: true },
  ];
  expect(sortShopItems(list).map((i) => i.name)).toEqual(["Aardvark Bowl", "Zebra Leash"]);
});

test("sortShopItems then orders by configured sort_order, then alphabetically", () => {
  const list = [
    { name: "B Product", featured: false, sort_order: 2 },
    { name: "A Product", featured: false, sort_order: 1 },
    { name: "C Product", featured: false }, // no sort_order at all (e.g. a credit pack/program)
    { name: "D Product", featured: false }, // ties with C on sort_order -> falls to name
  ];
  expect(sortShopItems(list).map((i) => i.name)).toEqual(["A Product", "B Product", "C Product", "D Product"]);
});

test("singularUnit handles the program format_unit vocabulary", () => {
  expect(singularUnit("sessions")).toBe("session");
  expect(singularUnit("classes")).toBe("class");
  expect(singularUnit("visits")).toBe("visit");
  expect(singularUnit("")).toBe("");
});

test("stockCeiling only applies to inventory-tracked internal products", () => {
  expect(stockCeiling({ kind: "product", sales_destination: "internal", track_inventory: true, stock_on_hand: 3 })).toBe(3);
  expect(stockCeiling({ kind: "product", sales_destination: "internal", track_inventory: true, stock_on_hand: 0.4 })).toBe(0);
  // untracked internal product -> unlimited
  expect(stockCeiling({ kind: "product", sales_destination: "internal", track_inventory: false, stock_on_hand: 3 })).toBeNull();
  // Shopify-linked listing -> Shopify owns inventory, never a client-side ceiling
  expect(stockCeiling({ kind: "product", sales_destination: "shopify_external", track_inventory: true, stock_on_hand: 3 })).toBeNull();
  // credit packs/programs never have a stock ceiling
  expect(stockCeiling({ kind: "credit_pack" })).toBeNull();
  expect(stockCeiling({ kind: "training_program" })).toBeNull();
});

test("isInternalPhysical is true only for internal (non-Shopify) products", () => {
  expect(isInternalPhysical({ kind: "product", sales_destination: "internal" })).toBe(true);
  expect(isInternalPhysical({ kind: "product" })).toBe(true); // sales_destination defaults to internal server-side
  expect(isInternalPhysical({ kind: "product", sales_destination: "shopify_external" })).toBe(false);
  expect(isInternalPhysical({ kind: "credit_pack" })).toBe(false);
  expect(isInternalPhysical({ kind: "training_program" })).toBe(false);
});

// ---------------------------------------------------------------------------
// Category-index navigation (categoryGroupsForTab / uncategorizedItemsForTab
// / categoryCoverItem / matchesSearchQuery) — powers PortalShop.jsx's
// clickable category cards, replacing the old category/subcategory
// dropdowns.
// ---------------------------------------------------------------------------

const navCategories = [
  { id: "cat-collars", name: "Collars & Leads", description: "Everyday walking gear", subcategories: [] },
  { id: "cat-toys", name: "Toys", description: null, subcategories: [] },
  { id: "cat-empty", name: "Seasonal", description: null, subcategories: [] }, // no matching items anywhere
];

const navItems = [
  { kind: "product", id: "p1", name: "Leash", category_id: "cat-collars", featured: false, image_id: "img-1" },
  { kind: "product", id: "p2", name: "Collar", category_id: "cat-collars", featured: true }, // featured, no image
  { kind: "product", id: "p3", name: "Chew Toy", category_id: "cat-toys", featured: false, image_id: "img-3" },
  { kind: "product", id: "p4", name: "Loose Bandana", category_id: null, featured: false, image_id: "img-4" }, // uncategorized
  { kind: "credit_pack", id: "pk1", name: "5-Visit Pack", category_id: null }, // uncategorized, different tab
];

test("categoryGroupsForTab keeps categories in their configured taxonomy order", () => {
  const groups = categoryGroupsForTab(navCategories, navItems, "product");
  // cat-collars then cat-toys, matching navCategories' own order — cat-empty
  // and the generated Other bucket are handled by the other assertions below.
  expect(groups.map((g) => g.category.id)).toEqual(["cat-collars", "cat-toys", OTHER_CATEGORY_ID]);
});

test("categoryGroupsForTab reports correct item counts per tab", () => {
  const productGroups = categoryGroupsForTab(navCategories, navItems, "product");
  expect(productGroups.find((g) => g.category.id === "cat-collars").count).toBe(2);
  expect(productGroups.find((g) => g.category.id === "cat-toys").count).toBe(1);
  expect(productGroups.find((g) => g.category.id === OTHER_CATEGORY_ID).count).toBe(1);

  const packGroups = categoryGroupsForTab(navCategories, navItems, "credit_pack");
  expect(packGroups.find((g) => g.category.id === OTHER_CATEGORY_ID).count).toBe(1);
});

test("categoryGroupsForTab excludes categories with no matching item in the tab", () => {
  const groups = categoryGroupsForTab(navCategories, navItems, "product");
  expect(groups.some((g) => g.category.id === "cat-empty")).toBe(false);
  // training_program tab has no items at all -> no configured categories, no Other
  expect(categoryGroupsForTab(navCategories, navItems, "training_program")).toEqual([]);
});

test("uncategorizedItemsForTab / categoryGroupsForTab surface visible uncategorized items under Other, placed after configured categories", () => {
  expect(uncategorizedItemsForTab(navItems, "product").map((i) => i.id)).toEqual(["p4"]);
  const groups = categoryGroupsForTab(navCategories, navItems, "product");
  const otherIndex = groups.findIndex((g) => g.category.id === OTHER_CATEGORY_ID);
  expect(otherIndex).toBe(groups.length - 1); // last, after every configured category
  expect(groups[otherIndex].category.name).toBe("Other");
  expect(groups[otherIndex].items.map((i) => i.id)).toEqual(["p4"]);
});

test("categoryCoverItem prefers a featured item even when it has no image over a non-featured item that does", () => {
  const group = { items: [
    { id: "a", featured: false, image_id: "img-a" },
    { id: "b", featured: true }, // no image_id at all
  ] };
  expect(categoryCoverItem(group)?.id).toBe("b");
});

test("categoryCoverItem falls back to the first item with an image when nothing is featured", () => {
  const group = { items: [
    { id: "a", featured: false },
    { id: "b", featured: false, image_id: "img-b" },
  ] };
  expect(categoryCoverItem(group)?.id).toBe("b");
});

test("categoryCoverItem returns null (existing placeholder) when nothing is featured and nothing has an image", () => {
  expect(categoryCoverItem({ items: [{ id: "a", featured: false }] })).toBeNull();
  expect(categoryCoverItem({ items: [] })).toBeNull();
  expect(categoryCoverItem(undefined)).toBeNull();
});

test("nextFiltersForTab clears the generated Other selection when the new tab has no uncategorized items", () => {
  expect(nextFiltersForTab(navItems, "training_program", OTHER_CATEGORY_ID, ""))
    .toEqual({ categoryFilter: "", subcategoryFilter: "" });
});

test("nextFiltersForTab keeps the generated Other selection when the new tab still has uncategorized items", () => {
  expect(nextFiltersForTab(navItems, "credit_pack", OTHER_CATEGORY_ID, ""))
    .toEqual({ categoryFilter: OTHER_CATEGORY_ID, subcategoryFilter: "" });
});

test("matchesSearchQuery matches on name, description, category name, and subcategory name", () => {
  const item = { name: "Rope Leash", description: "Durable nylon rope", category_name: "Collars & Leads", subcategory_name: "Leashes" };
  expect(matchesSearchQuery(item, "rope")).toBe(true); // name
  expect(matchesSearchQuery(item, "nylon")).toBe(true); // description
  expect(matchesSearchQuery(item, "collars")).toBe(true); // category_name
  expect(matchesSearchQuery(item, "leashes")).toBe(true); // subcategory_name
  expect(matchesSearchQuery(item, "mugs")).toBe(false);
});

test("matchesSearchQuery treats a blank/empty query as matching everything", () => {
  const item = { name: "Anything" };
  expect(matchesSearchQuery(item, "")).toBe(true);
  expect(matchesSearchQuery(item, "   ")).toBe(true);
  expect(matchesSearchQuery(item, undefined)).toBe(true);
});

// ---------------------------------------------------------------------------
// Shop Appearance & Organization — section metadata, category cover-image
// priority, hide-when-empty, featured-category ordering, and the
// featured_items landing mode.
// ---------------------------------------------------------------------------

test("sectionMetaFor returns hardcoded fallback when shop_page is undefined/missing keys", () => {
  expect(sectionMetaFor("merch", undefined)).toEqual({ label: "Merch & Gear", description: "", image_id: null, visible: true, order: 0 });
  expect(sectionMetaFor("training", {})).toEqual({ label: "Training", description: "", image_id: null, visible: true, order: 2 });
  // Partially-configured section — missing fields fall back individually.
  expect(sectionMetaFor("prepaid_visits", { sections: { prepaid_visits: { label: "Visit Passes" } } }))
    .toEqual({ label: "Visit Passes", description: "", image_id: null, visible: true, order: 1 });
});

test("sectionMetaFor returns admin-configured label/description/image when present", () => {
  const shopPage = { sections: { merch: { label: "Store", description: "Gear & goods", image_id: "img-merch", visible: false, order: 5 } } };
  expect(sectionMetaFor("merch", shopPage)).toEqual({ label: "Store", description: "Gear & goods", image_id: "img-merch", visible: false, order: 5 });
});

test("visibleSectionsInOrder excludes a section with visible:false and sorts by order", () => {
  const shopPage = {
    sections: {
      merch: { order: 2, visible: true },
      prepaid_visits: { order: 0, visible: true },
      training: { order: 1, visible: false },
    },
  };
  expect(visibleSectionsInOrder(shopPage).map((s) => s.key)).toEqual(["prepaid_visits", "merch"]);
});

test("categoryCoverImageId prefers the category's own configured image over any item cover", () => {
  const group = {
    category: { image_id: "cat-img" },
    items: [{ id: "a", featured: true, image_id: "item-img" }],
  };
  expect(categoryCoverImageId(group)).toBe("cat-img");
});

test("categoryCoverImageId prefers the mobile image when preferMobile is set and available", () => {
  const group = { category: { image_id: "cat-img", mobile_image_id: "cat-img-mobile" }, items: [] };
  expect(categoryCoverImageId(group, { preferMobile: true })).toBe("cat-img-mobile");
  expect(categoryCoverImageId(group, { preferMobile: false })).toBe("cat-img");
});

test("categoryCoverImageId falls back to categoryCoverItem's unmodified behavior when no category image is set", () => {
  const group = { category: { image_id: null }, items: [{ id: "a", featured: false, image_id: "item-img" }] };
  expect(categoryCoverImageId(group)).toBe("item-img");
  expect(categoryCoverImageId({ category: null, items: [] })).toBeNull();
});

test("shouldHideEmptyCategory: category override true hides even when global is false", () => {
  expect(shouldHideEmptyCategory({ count: 0, category: { hide_when_empty: true } }, { hide_empty_categories: false })).toBe(true);
});

test("shouldHideEmptyCategory: category override false shows even when global is true", () => {
  expect(shouldHideEmptyCategory({ count: 0, category: { hide_when_empty: false } }, { hide_empty_categories: true })).toBe(false);
});

test("shouldHideEmptyCategory: null/undefined override defers to the global setting", () => {
  expect(shouldHideEmptyCategory({ count: 0, category: {} }, { hide_empty_categories: true })).toBe(true);
  expect(shouldHideEmptyCategory({ count: 0, category: {} }, { hide_empty_categories: false })).toBe(false);
  // Missing shop_page entirely -> defaults to hiding (today's implicit behavior)
  expect(shouldHideEmptyCategory({ count: 0, category: {} }, undefined)).toBe(true);
});

test("shouldHideEmptyCategory never hides a non-empty group regardless of flags", () => {
  expect(shouldHideEmptyCategory({ count: 3, category: { hide_when_empty: true } }, { hide_empty_categories: true })).toBe(false);
});

test("orderCategoryGroupsFeaturedFirst puts featured groups first while preserving relative order within each group", () => {
  const groups = [
    { category: { id: "a", is_featured: false } },
    { category: { id: "b", is_featured: true } },
    { category: { id: "c", is_featured: false } },
    { category: { id: "d", is_featured: true } },
  ];
  expect(orderCategoryGroupsFeaturedFirst(groups).map((g) => g.category.id)).toEqual(["b", "d", "a", "c"]);
});

test("filterFeaturedItems returns only items with featured:true", () => {
  const list = [{ id: "a", featured: true }, { id: "b", featured: false }, { id: "c", featured: true }];
  expect(filterFeaturedItems(list).map((i) => i.id)).toEqual(["a", "c"]);
});

test("uncategorizedItemsForTab never buckets an item whose category_id points to a category absent from the given list (never leaks into Other)", () => {
  // p-orphan's category_id ("cat-gone") doesn't match any category in
  // navCategories — it must NOT appear in the generated Other bucket
  // (which is reserved for items with a genuinely null category_id), and
  // it must not appear under any other group either.
  const itemsWithOrphan = [...navItems, { kind: "product", id: "p-orphan", name: "Orphaned", category_id: "cat-gone" }];
  const groups = categoryGroupsForTab(navCategories, itemsWithOrphan, "product");
  const allGroupedIds = groups.flatMap((g) => g.items.map((i) => i.id));
  expect(allGroupedIds).not.toContain("p-orphan");
  const other = groups.find((g) => g.category.id === OTHER_CATEGORY_ID);
  expect(other.items.map((i) => i.id)).toEqual(["p4"]); // unchanged — only the genuinely uncategorized item
});

test("orderStatusLabel maps every required status combination to its exact customer-facing label", () => {
  expect(orderStatusLabel({ status: "pending_payment" })).toBe("Payment Processing");
  expect(orderStatusLabel({ status: "payment_failed" })).toBe("Not Completed");
  expect(orderStatusLabel({ status: "canceled" })).toBe("Not Completed");
  expect(orderStatusLabel({ status: "paid", fulfillment_status: "needs_attention", lines: [] })).toBe("Needs Attention");
  // paid, no physical lines (packs/programs only), fulfilled -> Completed
  expect(orderStatusLabel({ status: "paid", fulfillment_status: "fulfilled", lines: [{ kind: "credit_pack" }] })).toBe("Completed");
  // paid, has a physical line -> pickup_status drives the label
  expect(orderStatusLabel({ status: "paid", pickup_status: "preparing", lines: [{ kind: "product" }] })).toBe("Preparing for Pickup");
  expect(orderStatusLabel({ status: "paid", pickup_status: "ready_for_pickup", lines: [{ kind: "product" }] })).toBe("Ready for Pickup");
  expect(orderStatusLabel({ status: "paid", pickup_status: "picked_up", lines: [{ kind: "product" }] })).toBe("Picked Up");
});

describe("guestItemCta", () => {
  test("Shopify external product always wins, regardless of any other flag", () => {
    expect(guestItemCta({
      kind: "product", sales_destination: "shopify_external",
      requires_approval: true, account_required: true,
    })).toEqual({ type: "shopify" });
  });

  test("price-hidden wins over account_required/approval/dog — no price fields present", () => {
    expect(guestItemCta({ kind: "product", account_required: true })).toEqual({ type: "hidden_price" });
    expect(guestItemCta({ kind: "product", requires_approval: true })).toEqual({ type: "hidden_price" });
    expect(guestItemCta({ kind: "training_program", requires_dog: true })).toEqual({ type: "hidden_price" });
  });

  test("approval/dog blockers win over a plain sign-in message when price is visible", () => {
    expect(guestItemCta({ kind: "product", price: 10, requires_approval: true, account_required: true }))
      .toEqual({ type: "contact_required", reason: "approval" });
    expect(guestItemCta({ kind: "product", price: 10, requires_dog: true, account_required: true }))
      .toEqual({ type: "contact_required", reason: "dog" });
  });

  test("account_required (credit packs/programs always) shows sign-in when price is visible and no approval/dog block", () => {
    expect(guestItemCta({ kind: "credit_pack", price: 50, account_required: true })).toEqual({ type: "sign_in" });
    expect(guestItemCta({ kind: "training_program", price: 200, account_required: true })).toEqual({ type: "sign_in" });
  });

  test("eligible product with guest_cart_allowed and a visible price adds to cart", () => {
    expect(guestItemCta({ kind: "product", price: 10, account_required: false, guest_cart_allowed: true }))
      .toEqual({ type: "add_to_cart" });
  });
});

// Credit-pack customer-facing quantity fix — the "Daycare 2 dogs 10 days"
// pack from the bug report: $375, 15 internal daycare credits (a two-dog
// day costs 1.5 credits), sold to customers as "10 days for 2 dogs".
const daycare2DogPack = {
  kind: "credit_pack", id: "pk-2dog", name: "Daycare 2 dogs 10 days",
  service_type: "daycare", qty: 15, price: 375, effective_price: 375,
  value_each: 25.00,
  display_quantity: 10, display_unit: "day", display_dog_count: 2,
  display_price_each: 37.50, credits_per_display_unit: 1.5,
};

// A pack with no display metadata at all — the fallback path every
// pre-existing pack must keep using.
const plainPack = {
  kind: "credit_pack", id: "pk-plain", name: "10-Pack Daycare",
  service_type: "daycare", qty: 15, price: 375, effective_price: 375,
  value_each: 25.00,
};

describe("credit-pack customer-facing wording", () => {
  test("card line matches the exact spec string when display metadata exists", () => {
    expect(creditPackCardLine(daycare2DogPack)).toBe("10 daycare days for 2 dogs · $37.50 per day");
  });

  test("detail line matches the exact spec paragraph when display metadata exists", () => {
    expect(creditPackDetailLine(daycare2DogPack)).toBe(
      "Includes 10 daycare days for 2 dogs. This purchase adds 15 daycare credits to your account. Each two-dog daycare day uses 1.5 credits."
    );
  });

  test("card and detail fall back to the accurate credit count when no display metadata exists", () => {
    expect(creditPackCardLine(plainPack)).toBe("15 daycare credits · $25.00 per credit");
    expect(creditPackDetailLine(plainPack)).toBe("15 daycare credits · $25.00 per credit");
  });

  test("never labels raw qty as visits or days for either pack", () => {
    for (const line of [creditPackCardLine(daycare2DogPack), creditPackDetailLine(daycare2DogPack),
      creditPackCardLine(plainPack), creditPackDetailLine(plainPack)]) {
      expect(line).not.toMatch(/visit/i);
    }
    expect(creditPackCardLine(plainPack)).not.toMatch(/\bdays?\b/i);
    expect(creditPackDetailLine(plainPack)).not.toMatch(/\bdays?\b/i);
  });

  test("staff/register line shows both values for clarity", () => {
    expect(creditPackStaffLine(daycare2DogPack)).toBe("10 days for 2 dogs · grants 15 daycare credits");
    expect(creditPackStaffLine(plainPack)).toBe("15 daycare credits");
  });

  test("admin summary lines show internal values always, customer package only when display metadata exists", () => {
    expect(creditPackAdminSummaryLines(daycare2DogPack)).toEqual([
      "Credits granted: 15",
      "Internal per-credit value: $25.00",
      "Customer package: 10 days for 2 dogs",
      "Customer price per package day: $37.50",
      "Credits per package day: 1.5",
    ]);
    expect(creditPackAdminSummaryLines(plainPack)).toEqual([
      "Credits granted: 15",
      "Internal per-credit value: $25.00",
    ]);
  });

  test("a grandfathered client price recalculates the displayed per-day price, not the credits-per-day ratio", () => {
    const grandfathered = { ...daycare2DogPack, effective_price: 300, display_price_each: 30.0 };
    expect(creditPackCardLine(grandfathered)).toBe("10 daycare days for 2 dogs · $30.00 per day");
    // credits_per_display_unit is qty/display_quantity — price-independent, still 1.5
    expect(creditPackDetailLine(grandfathered)).toContain("uses 1.5 credits");
  });

  test("PackEditor live preview matches the exact spec string", () => {
    const form = { qty: 15, price: 375, service_type: "daycare", display_quantity: 10, display_unit: "day", display_dog_count: 2 };
    expect(creditPackEditorPreview(form)).toBe(
      "Clients receive 10 daycare days for 2 dogs. The account receives 15 daycare credits. Each two-dog day uses 1.5 credits. $37.50 per two-dog day."
    );
  });

  test("PackEditor live preview returns null until a positive display_quantity is entered", () => {
    expect(creditPackEditorPreview({ qty: 15, price: 375, service_type: "daycare" })).toBeNull();
    expect(creditPackEditorPreview({ qty: 15, price: 375, service_type: "daycare", display_quantity: 0 })).toBeNull();
  });
});
