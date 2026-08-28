import {
  inventoryStatus, itemWarnings, marginDisplay, filterItemsByView,
  catalogProfitSummary,
  orderRef, orderComputedStatus, filterOrdersByView, searchOrders,
} from "./shopManagerPolish";

const trackedProduct = (overrides = {}) => ({
  kind: "physical_product", id: "p1", sales_destination: "internal",
  track_inventory: true, stock_on_hand: 10, low_stock_threshold: 3,
  active: true, archived: false, show_online: true, show_at_register: true,
  missing_image: false, missing_description: false, category_id: "cat-1", category_hidden: false,
  list_price: 25, cost: 10,
  ...overrides,
});

test("inventoryStatus reports Shopify Managed for Shopify-linked listings, never internal stock", () => {
  expect(inventoryStatus(trackedProduct({ sales_destination: "shopify_external" }))).toEqual({ label: "Shopify Managed", tone: "muted" });
});

test("inventoryStatus reports Not Tracked for untracked internal products", () => {
  expect(inventoryStatus(trackedProduct({ track_inventory: false }))).toEqual({ label: "Not Tracked", tone: "muted" });
});

test("inventoryStatus classifies In Stock / Low Stock / Out of Stock correctly", () => {
  expect(inventoryStatus(trackedProduct({ stock_on_hand: 10 }))).toEqual({ label: "In Stock · 10", tone: "ok" });
  expect(inventoryStatus(trackedProduct({ stock_on_hand: 3 }))).toEqual({ label: "Low Stock · 3", tone: "warn" });
  expect(inventoryStatus(trackedProduct({ stock_on_hand: 0 }))).toEqual({ label: "Out of Stock · 0", tone: "bad" });
});

test("inventoryStatus is null for credit packs/programs (no inventory concept)", () => {
  expect(inventoryStatus({ kind: "credit_pack" })).toBeNull();
  expect(inventoryStatus({ kind: "training_program" })).toBeNull();
});

test("itemWarnings bundles online-listing gaps into one Needs Setup badge, only when show_online", () => {
  const withGaps = trackedProduct({ missing_image: true, missing_description: true, category_id: null });
  expect(itemWarnings(withGaps)).toContainEqual({ label: "Needs Setup · Missing image, description, and category", tone: "warn" });
  // same gaps, but not intended to appear online -> no setup warning at all
  expect(itemWarnings({ ...withGaps, show_online: false })).not.toContainEqual(expect.objectContaining({ label: expect.stringContaining("Needs Setup") }));
});

test("itemWarnings flags a category that's assigned but hidden", () => {
  const hidden = trackedProduct({ category_hidden: true });
  expect(itemWarnings(hidden)).toContainEqual({ label: "Needs Setup · Missing active category", tone: "warn" });
});

test("itemWarnings adds a stock badge for active tracked products, never for archived/inactive ones", () => {
  expect(itemWarnings(trackedProduct({ stock_on_hand: 0 }))).toContainEqual({ label: "Out of Stock", tone: "bad" });
  expect(itemWarnings(trackedProduct({ stock_on_hand: 2 }))).toContainEqual({ label: "Low Stock · 2 remaining", tone: "warn" });
  // archived products are also active:false by construction -> no stock badge noise on the Archived view
  expect(itemWarnings(trackedProduct({ stock_on_hand: 0, active: false }))).not.toContainEqual(expect.objectContaining({ label: "Out of Stock" }));
});

test("itemWarnings shows Hidden Everywhere only when both channels are off", () => {
  expect(itemWarnings(trackedProduct({ show_online: false, show_at_register: false }))).toContainEqual({ label: "Hidden Everywhere", tone: "muted" });
  expect(itemWarnings(trackedProduct({ show_online: false, show_at_register: true }))).not.toContainEqual(expect.objectContaining({ label: "Hidden Everywhere" }));
});

test("marginDisplay is null for Shopify listings, credit packs, and training programs", () => {
  expect(marginDisplay(trackedProduct({ sales_destination: "shopify_external" }))).toBeNull();
  expect(marginDisplay({ kind: "credit_pack" })).toBeNull();
  expect(marginDisplay({ kind: "training_program" })).toBeNull();
});

test("marginDisplay never treats a missing cost as zero", () => {
  expect(marginDisplay(trackedProduct({ cost: null }))).toEqual({ cost: "Cost not entered", gm: null });
});

test("marginDisplay computes gross margin dollars and percent from price - cost", () => {
  const result = marginDisplay(trackedProduct({ list_price: 25, cost: 10 }));
  expect(result.cost).toBe("$10.00");
  expect(result.gm).toBe("$15.00 (60.0%)");
});

test("catalogProfitSummary rolls up stock value at cost/retail, excluding Shopify, archived, and cost-less items", () => {
  const items = [
    trackedProduct({ id: "a", stock_on_hand: 10, cost: 10, list_price: 25 }),   // 100 cost / 250 retail
    trackedProduct({ id: "b", stock_on_hand: 4, cost: 5, list_price: 8 }),      // 20 cost / 32 retail
    trackedProduct({ id: "no-cost", cost: null }),                              // uncounted, reported
    trackedProduct({ id: "shopify", sales_destination: "shopify_external" }),   // never counted
    trackedProduct({ id: "archived", archived: true }),                         // never counted
    { kind: "credit_pack", id: "pack", cost: 1 },                               // never counted
  ];
  const ps = catalogProfitSummary(items);
  expect(ps.costedCount).toBe(2);
  expect(ps.missingCostCount).toBe(1);
  expect(ps.inventoryCost).toBe("$120.00");
  expect(ps.inventoryRetail).toBe("$282.00");
  expect(ps.potentialProfit).toBe("$162.00");
  expect(ps.marginPercent).toBe("57.4%");
});

test("catalogProfitSummary skips untracked stock and clamps negative stock to zero, never inventing value", () => {
  const ps = catalogProfitSummary([
    trackedProduct({ id: "untracked", track_inventory: false, cost: 10, list_price: 25 }), // costed but no stock math
    trackedProduct({ id: "negative", stock_on_hand: -3, cost: 10, list_price: 25 }),
  ]);
  expect(ps.costedCount).toBe(2);
  expect(ps.inventoryCost).toBe("$0.00");
  expect(ps.inventoryRetail).toBe("$0.00");
  expect(ps.marginPercent).toBeNull();
});

test("filterItemsByView Low Stock / Out of Stock only include active tracked products past/at threshold", () => {
  const items = [
    trackedProduct({ id: "in-stock", stock_on_hand: 10 }),
    trackedProduct({ id: "low", stock_on_hand: 3 }),
    trackedProduct({ id: "out", stock_on_hand: 0 }),
    trackedProduct({ id: "untracked", track_inventory: false, stock_on_hand: 0 }),
    trackedProduct({ id: "inactive-out", stock_on_hand: 0, active: false }),
    { kind: "credit_pack", id: "pack" },
  ];
  expect(filterItemsByView(items, "low_stock").map((i) => i.id)).toEqual(["low"]);
  expect(filterItemsByView(items, "out_of_stock").map((i) => i.id)).toEqual(["out"]);
});

test("filterItemsByView Archived narrows a mixed (include_archived) response down to only archived rows", () => {
  const items = [
    trackedProduct({ id: "active-one", archived: false }),
    trackedProduct({ id: "archived-one", archived: true }),
    { kind: "credit_pack", id: "pack", archived: false }, // packs are never archived
  ];
  expect(filterItemsByView(items, "archived").map((i) => i.id)).toEqual(["archived-one"]);
});

test("filterItemsByView Missing Details only flags items intended to appear online", () => {
  const items = [
    trackedProduct({ id: "gap-online", show_online: true, missing_image: true }),
    trackedProduct({ id: "gap-offline", show_online: false, missing_image: true }),
    trackedProduct({ id: "complete", show_online: true, missing_image: false, missing_description: false }),
  ];
  expect(filterItemsByView(items, "missing_details").map((i) => i.id)).toEqual(["gap-online"]);
});

test("filterItemsByView Inactive matches every inactive item regardless of kind", () => {
  const items = [
    trackedProduct({ id: "inactive-product", active: false }),
    { kind: "credit_pack", id: "inactive-pack", active: false },
    trackedProduct({ id: "active-product", active: true }),
  ];
  expect(filterItemsByView(items, "inactive").map((i) => i.id).sort()).toEqual(["inactive-pack", "inactive-product"]);
});

const paidOrder = (overrides = {}) => ({
  id: "order-abc12345", client_name: "Jane Doe", total: 40, admin_unseen: false,
  fulfillment_status: "fulfilled", pickup_status: "not_applicable",
  lines: [{ kind: "credit_pack", name: "5-Visit Pack", quantity: 1 }],
  ...overrides,
});

test("orderRef derives a short, safe reference from the order id", () => {
  expect(orderRef({ id: "order-abc12345" })).toBe("ORDER-AB");
});

test("orderComputedStatus prioritizes needs_attention over everything else", () => {
  expect(orderComputedStatus(paidOrder({ fulfillment_status: "needs_attention" }))).toBe("needs_attention");
});

test("orderComputedStatus follows pickup_status for physical orders, fulfillment_status otherwise", () => {
  const physical = paidOrder({ pickup_status: "preparing", lines: [{ kind: "product", name: "Leash", quantity: 1 }] });
  expect(orderComputedStatus(physical)).toBe("preparing");
  expect(orderComputedStatus({ ...physical, pickup_status: "ready_for_pickup" })).toBe("ready_for_pickup");
  expect(orderComputedStatus({ ...physical, pickup_status: "picked_up" })).toBe("picked_up");
  expect(orderComputedStatus(paidOrder({ fulfillment_status: "fulfilled" }))).toBe("completed");
  expect(orderComputedStatus(paidOrder({ fulfillment_status: "pending" }))).toBe("processing");
});

test("filterOrdersByView Open bundles Preparing/Ready for Pickup/Needs Attention", () => {
  const orders = [
    paidOrder({ id: "o1", pickup_status: "preparing", lines: [{ kind: "product", name: "x", quantity: 1 }] }),
    paidOrder({ id: "o2", pickup_status: "ready_for_pickup", lines: [{ kind: "product", name: "x", quantity: 1 }] }),
    paidOrder({ id: "o3", fulfillment_status: "needs_attention" }),
    paidOrder({ id: "o4", fulfillment_status: "fulfilled" }), // completed, not open
  ];
  expect(filterOrdersByView(orders, "open").map((o) => o.id).sort()).toEqual(["o1", "o2", "o3"]);
});

test("filterOrdersByView New matches admin_unseen orders regardless of status", () => {
  const orders = [paidOrder({ id: "seen", admin_unseen: false }), paidOrder({ id: "unseen", admin_unseen: true })];
  expect(filterOrdersByView(orders, "new").map((o) => o.id)).toEqual(["unseen"]);
});

test("filterOrdersByView Completed matches Picked Up (physical) or fulfilled (nonphysical)", () => {
  const orders = [
    paidOrder({ id: "picked", pickup_status: "picked_up", lines: [{ kind: "product", name: "x", quantity: 1 }] }),
    paidOrder({ id: "fulfilled-nonphysical", fulfillment_status: "fulfilled" }),
    paidOrder({ id: "still-preparing", pickup_status: "preparing", lines: [{ kind: "product", name: "x", quantity: 1 }] }),
  ];
  expect(filterOrdersByView(orders, "completed").map((o) => o.id).sort()).toEqual(["fulfilled-nonphysical", "picked"]);
});

test("searchOrders finds orders by client name, short order reference, and item name", () => {
  const orders = [
    paidOrder({ id: "order-abc12345", client_name: "Jane Doe", lines: [{ kind: "product", name: "Leash", quantity: 1 }] }),
    paidOrder({ id: "order-zzz99999", client_name: "John Smith", lines: [{ kind: "product", name: "Collar", quantity: 1 }] }),
  ];
  expect(searchOrders(orders, "jane").map((o) => o.id)).toEqual(["order-abc12345"]);
  expect(searchOrders(orders, "ORDER-AB").map((o) => o.id)).toEqual(["order-abc12345"]);
  expect(searchOrders(orders, "collar").map((o) => o.id)).toEqual(["order-zzz99999"]);
  expect(searchOrders(orders, "")).toHaveLength(2);
});
