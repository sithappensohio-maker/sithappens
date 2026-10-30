/**
 * The Shop Manager, actually mounted — including its editors.
 *
 * This file exists because of a bug a green `vite build` waved straight
 * through: the relationship editor's candidate list was read in the
 * component that renders the EDITORS while being defined in a sibling
 * component that renders the TABLE. Every module parsed, every type was
 * fine, the bundle built — and opening a product editor would have thrown a
 * ReferenceError and taken the admin screen down with it.
 *
 * That is the third time this shape of defect has appeared in this project.
 * The only thing that catches it is rendering the thing.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "../lib/useConfirm";
import ShopManager from "./ShopManager";
import ShopAnalyticsDashboard from "../components/shop/ShopAnalyticsDashboard";
import RegisterSalesDashboard from "../components/shop/RegisterSalesDashboard";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(),
         defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS = [
  { kind: "physical_product", id: "p1", name: "Rope Leash", active: true, list_price: 24 },
  { kind: "credit_pack", id: "k1", name: "10 Visits", active: true, list_price: 280 },
  { kind: "training_program", id: "t1", name: "Rock Solid Recall", active: true, list_price: 119 },
];

const OVERVIEW = {
  range: { start: "2026-09-15", end: "2026-09-21" },
  sales: { revenue: 412.5, orders: 6, units: 9, average_order_value: 68.75,
           guest_orders: 2, account_orders: 4 },
  funnel: { visitors: 140, product_viewers: 52, carts: 18, checkout_starts: 9, orders: 6,
            rates: { visit_to_product_view: 37.1, product_view_to_cart: 34.6,
                     cart_to_checkout: 50, checkout_to_order: 66.7, visit_to_order: 4.3 } },
  departments: [{ department: "gear", label: "Gear", revenue: 212.5, units: 6, orders: 4 }],
  top_products: [{ kind: "product", ref_id: "p1", name: "Rope Leash", department: "gear",
                   available: true, impressions: 90, views: 40, cart_adds: 12, units: 6,
                   revenue: 212.5, view_to_purchase: 15 }],
  viewed_not_bought: [{ kind: "product", ref_id: "p9", name: "Very Dark Long Line",
                        department: "gear", available: true, impressions: 40, views: 22,
                        cart_adds: 0, units: 0, revenue: 0 }],
  searches: { top_searches: [{ query: "harness", searches: 12, sessions: 9 }],
              zero_result_searches: [{ query: "puppy pads", searches: 4, sessions: 4 }] },
  best_sellers: [{ ref_id: "p1", kind: "product", name: "Rope Leash", units: 6, revenue: 212.5 }],
  splits: { audience: { true: 96, false: 44 }, device: { mobile: 88, desktop: 52 } },
  activity: { search: 20, search_zero_results: 4 },
};

const REGISTER_SALES = {
  range: { start_date: "2026-09-15", end_date: "2026-09-21" },
  products: [{ product_id: "p1", variant_id: null, name: "Rope Leash", units: 4, revenue: 100 }],
  not_sold: [{ product_id: "p2", name: "Winter Coat — Large", stock_on_hand: 6 }],
  totals: { units: 4, revenue: 100 },
};

let container, root, errors;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  errors = [];
  jest.spyOn(console, "error").mockImplementation((...a) => errors.push(String(a[0])));
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url.includes("/analytics/overview")) return Promise.resolve({ data: OVERVIEW });
    if (url.includes("/register/sales-by-product")) return Promise.resolve({ data: REGISTER_SALES });
    if (url.includes("/shop-manager/items")) return Promise.resolve({ data: { items: ITEMS } });
    if (url.includes("/programs/meta")) return Promise.resolve({ data: { types: [], focuses: [] } });
    if (url.includes("/programs")) return Promise.resolve({ data: [] });
    if (url.includes("/email-templates")) return Promise.resolve({ data: [] });
    if (url.includes("/shop/categories")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
  console.error.mockRestore();
});

const mountRaw = async (el) => {
  await act(async () => {
    root = createRoot(container);
    // The real provider, not a stub: ShopManager's useConfirm throwing
    // outside one is a deliberate guard, and a test that mocks it away would
    // be testing a component the app never renders.
    root.render(<MemoryRouter><ConfirmProvider>{el}</ConfirmProvider></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

// Items tab categories default to collapsed (owner, 2026-10-18). Every
// existing test here predates that and reaches into a row by id right
// after mounting, so the shared `mount` helper expands every category
// once up front — the handful of tests that actually care about the
// collapsed default use `mountRaw` directly instead.
const expandAllCategories = async () => {
  const headers = Array.prototype.slice.call(
    document.querySelectorAll('[data-testid^="sm-category-group-"]')
  );
  for (const h of headers) {
    await act(async () => { h.click(); });
  }
};
const mount = async (el) => {
  await mountRaw(el);
  await expandAllCategories();
};

/** The specific failure this file exists for. */
const noReferenceErrors = () => {
  const bad = errors.filter((e) => /is not defined|Cannot access|is not a function/.test(e));
  expect(bad).toEqual([]);
};

const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const text = () => document.body.textContent;

describe("the Shop Manager survives being rendered", () => {
  test("it mounts", async () => {
    await mount(<ShopManager />);
    noReferenceErrors();
    expect(text()).toContain("Shop Manager");
  });

  test("the candidate list for relationship editing is loaded where the editors are", async () => {
    // The regression itself: this list used to be built in ItemsTab while
    // the editors that read it live in ShopManager.
    await mount(<ShopManager />);
    noReferenceErrors();
    expect(api.get).toHaveBeenCalledWith("/shop-manager/items");
  });

  test("the Insights tab renders the dashboard", async () => {
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-insights").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    noReferenceErrors();
    expect(byTestId("shop-analytics-dashboard")).toBeTruthy();
  });

  test("the Register Sales tab renders the dashboard", async () => {
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-register_sales").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    noReferenceErrors();
    expect(byTestId("register-sales-dashboard")).toBeTruthy();
  });

  test("Print Label is offered for a plain physical product, never for a pack or a program", async () => {
    // Row actions beyond Edit/Delete collapse behind a "More" menu (see
    // RowActionsMenu) — each row's own menu must be opened first.
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-row-p1-more").click(); });
    expect(byTestId("sm-print-label-p1")).toBeTruthy();
    await act(async () => { byTestId("sm-row-k1-more").click(); });
    expect(byTestId("sm-print-label-k1")).toBeFalsy();
    await act(async () => { byTestId("sm-row-t1-more").click(); });
    expect(byTestId("sm-print-label-t1")).toBeFalsy();
  });

  test("clicking Print Label opens the print sheet for that product, with no sku call yet made", async () => {
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { sku: "2000000000" } });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-row-p1-more").click(); });
    await act(async () => { byTestId("sm-print-label-p1").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    noReferenceErrors();
    expect(byTestId("print-labels-modal")).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith("/pos/products/p1/generate-sku");
  });

  // Owner-reported bug: a row with several actions (Duplicate, Print
  // Label, Receive/Adjust Stock, Stock History) pushed the row so wide
  // that Delete scrolled off-screen — read as "there's no way to delete
  // this". Edit and Delete must always be reachable with no "More" menu
  // and no horizontal scrolling, for every item kind — a pack/program
  // used to bury Delete in the More menu instead, same bug by a
  // different name (see "Delete for packs and programs" below).
  test("Edit and Delete are always inline, never hidden behind the More menu, for every item kind", async () => {
    await mount(<ShopManager />);
    for (const id of ["p1", "k1", "t1"]) {
      const row = byTestId(`sm-item-row-${id}`);
      expect(row.querySelector(`[data-testid="sm-delete-${id}"]`)).toBeTruthy();
      expect([...row.querySelectorAll("button")].some((b) => b.textContent === "Edit")).toBe(true);
    }
    // Not yet opened — Duplicate lives inside the collapsed menu.
    expect(byTestId("sm-duplicate-p1")).toBeFalsy();
    await act(async () => { byTestId("sm-row-p1-more").click(); });
    expect(byTestId("sm-duplicate-p1")).toBeTruthy();
  });
});

// Owner, 2026-10-17: "can we make it so any item in the shop can be
// deleted so i can clean up unused stuff" — screenshot showed several
// training programs and prepaid packs stuck in the table (some already
// "Hidden Everywhere") with no way to actually remove the row, only a
// physical product had a Delete button at all. Delete started out tucked
// in the More menu for a pack/program (unlike the physical product's own
// always-inline button) — inconsistent, and the exact "pushed off-screen
// behind a menu" bug above by a different name, so it was moved inline
// too, same place as every other kind.
describe("Delete for packs and programs (owner request, 2026-10-17)", () => {
  test("Delete is offered for a pack and a program, inline like every other kind", async () => {
    await mount(<ShopManager />);
    expect(byTestId("sm-delete-k1")).toBeTruthy();
    expect(byTestId("sm-delete-t1")).toBeTruthy();
  });

  // Owner-reported, live: a menu item was in the DOM but invisible — the
  // Items table's overflow-x-auto wrapper (for horizontal scroll on
  // mobile) also clips the Y axis per the CSS overflow spec, so a
  // dropdown got cut off after the first item. jsdom doesn't lay out or
  // clip anything, so it can't reproduce the visual bug — but it CAN
  // prove the fix's actual mechanism: the panel must render outside the
  // row's DOM subtree (portaled to document.body with fixed positioning),
  // not nested inside the clipping ancestor. If this regresses back to an
  // inline/absolute panel, this is the test that catches it.
  test("the More menu panel escapes the row via portal, not nested inside the scrollable table wrapper", async () => {
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-row-k1-more").click(); });
    const panel = byTestId("sm-row-k1-more-panel");
    const row = byTestId("sm-item-row-k1");
    expect(panel).toBeTruthy();
    expect(row.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
    expect(byTestId("sm-duplicate-k1")).toBeTruthy();
  });

  test("confirming delete on a program with no history calls the real hard-delete endpoint", async () => {
    api.delete.mockReset();
    api.delete.mockResolvedValue({ data: { ok: true, action: "deleted" } });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-delete-t1").click(); });
    expect(byTestId("sm-delete-confirm")).toBeTruthy();
    await act(async () => { byTestId("sm-delete-confirm").querySelector("button.bg-red-500").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.delete).toHaveBeenCalledWith("/programs/t1?hard=true");
    noReferenceErrors();
  });

  test("a program with real enrollment history is refused, and the fallback hides it (never reactivates)", async () => {
    api.delete.mockReset();
    api.delete.mockRejectedValue({ response: { status: 409, data: {
      detail: "This program has enrollment history and can't be permanently deleted — hide it instead to keep past enrollments and progress intact.",
    } } });
    api.get.mockImplementation((url, opts) => {
      if (url === "/programs" && opts?.params?.include_inactive) {
        return Promise.resolve({ data: [{ id: "t1", name: "Rock Solid Recall", active: true, price: 119 }] });
      }
      if (url.includes("/shop-manager/items")) return Promise.resolve({ data: { items: ITEMS } });
      if (url.includes("/programs/meta")) return Promise.resolve({ data: { types: [], focuses: [] } });
      return Promise.resolve({ data: {} });
    });
    api.put.mockReset();
    api.put.mockResolvedValue({ data: {} });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-delete-t1").click(); });
    await act(async () => { byTestId("sm-delete-confirm").querySelector("button.bg-red-500").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Blocked, never fell back to the "no history" path silently.
    expect(byTestId("sm-delete-confirm").textContent).toContain("enrollment history");
    const fallback = byTestId("sm-delete-confirm").querySelector("button.bg-shPrimary");
    expect(fallback.textContent).toBe("Hide Program");
    await act(async () => { fallback.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Explicitly active:false — never the toggle (which would REACTIVATE
    // an item that started hidden, the exact bug this must avoid).
    expect(api.put).toHaveBeenCalledWith("/programs/t1", expect.objectContaining({ active: false }));
    noReferenceErrors();
  });

  // Owner, 2026-10-30: courses "it wont let me delete because past enrolments"
  // — a program with history can now go with that history, after a preview.
  const refuseWithHistory = (preview) => {
    api.delete.mockReset();
    api.delete.mockRejectedValue({ response: { status: 409, data: { detail: "This program has enrollment history" } } });
    api.get.mockImplementation((url) => {
      if (url === "/admin/programs/t1/delete-preview") return Promise.resolve({ data: preview });
      if (url.includes("/shop-manager/items")) return Promise.resolve({ data: { items: ITEMS } });
      if (url.includes("/programs/meta")) return Promise.resolve({ data: { types: [], focuses: [] } });
      return Promise.resolve({ data: {} });
    });
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { ok: true } });
  };
  const askToDelete = async () => {
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-delete-t1").click(); });
    await act(async () => { byTestId("sm-delete-confirm").querySelector("button.bg-red-500").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  };

  test("a program with history can be deleted with it, after saying what goes", async () => {
    refuseWithHistory({ program: { id: "t1", name: "Rock Solid Recall" }, enrollments: 3, dogs: 2, active: 1, blockers: [] });
    await askToDelete();
    expect(byTestId("sm-delete-program-history").textContent).toContain("3 enrollments (2 dogs), 1 still in progress");
    expect(byTestId("sm-delete-program-history").textContent).toContain("Sales, payments and receipts stay");
    await act(async () => { byTestId("sm-delete-program-with-history").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/admin/programs/t1/delete-with-history", { confirm: true });
    expect(byTestId("sm-delete-confirm")).toBeFalsy();
    noReferenceErrors();
  });

  test("while sessions are still booked, deleting with history is not offered as possible", async () => {
    refuseWithHistory({ program: { id: "t1" }, enrollments: 1, dogs: 1, active: 1,
                        blockers: ["2 upcoming sessions are still booked for it. Cancel or finish them first."] });
    await askToDelete();
    expect(byTestId("sm-delete-program-blocker").textContent).toContain("Cancel or finish them first");
    expect(byTestId("sm-delete-program-with-history").disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  test("a credit pack with client-specific prices offers Delete Anyway with the server's real message, not a generic one", async () => {
    api.delete.mockReset();
    api.delete.mockImplementation((url) => {
      if (url === "/credit-packs/k1") {
        return Promise.reject({ response: { status: 409, data: {
          detail: '2 clients have an active client-specific price on "10 Visits". Pass force=true to proceed anyway.',
        } } });
      }
      return Promise.resolve({ data: { ok: true } });
    });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-delete-k1").click(); });
    await act(async () => { byTestId("sm-delete-confirm").querySelector("button.bg-red-500").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(byTestId("sm-delete-confirm").textContent).toContain('2 clients have an active client-specific price');
    const again = [...byTestId("sm-delete-confirm").querySelectorAll("button")].find((b) => b.textContent === "Delete Anyway");
    expect(again).toBeTruthy();
    await act(async () => { again.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.delete).toHaveBeenCalledWith("/credit-packs/k1?force=true");
    noReferenceErrors();
  });
});

// Owner, 2026-10-17 (follow-up to the Grooming-department fix above):
// "i need to be able to add these categories my self as well for future
// stuff" — a Merch & Gear category can now be flagged to become its own
// Shop department, no code change required per category.
describe("self-service Shop departments (owner request, 2026-10-17)", () => {
  const mockCategories = (overrides = {}) => {
    api.get.mockImplementation((url) => {
      if (url.includes("/analytics/overview")) return Promise.resolve({ data: OVERVIEW });
      if (url.includes("/shop-manager/items")) return Promise.resolve({ data: { items: ITEMS } });
      if (url.includes("/programs/meta")) return Promise.resolve({ data: { types: [], focuses: [] } });
      if (url.includes("/programs")) return Promise.resolve({ data: [] });
      if (url.includes("/shop/uncategorized-items")) return Promise.resolve({ data: { items: [] } });
      if (url.includes("/shop/categories")) return Promise.resolve({ data: { categories: [
        { id: "cat-groom", name: "Grooming", section: "merch", is_department: false, active: true, item_count: 2, ...overrides },
      ] } });
      return Promise.resolve({ data: {} });
    });
  };

  test("the department checkbox is offered for a Merch & Gear category, not a Training one", async () => {
    mockCategories();
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-categories").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byTestId("sm-add-category").click(); });
    expect(byTestId("sm-category-is-department")).toBeTruthy();

    await act(async () => { byTestId("sm-cat-section-training").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byTestId("sm-add-category").click(); });
    expect(byTestId("sm-category-is-department")).toBeFalsy();
    noReferenceErrors();
  });

  test("checking it and saving sends is_department through to the category", async () => {
    mockCategories();
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { ok: true } });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-categories").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byTestId("sm-add-category").click(); });
    const setInput = (id, value) => {
      const el = byTestId(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { setInput("sm-category-name-input", "Spa Day"); });
    await act(async () => { byTestId("sm-category-is-department").click(); });
    await act(async () => { byTestId("sm-save-category").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/shop/categories",
      expect.objectContaining({ is_department: true }));
    noReferenceErrors();
  });

  // A double-click (or a slow network) must not create the category twice —
  // saveCategory had no busy guard at all.
  test("double-clicking Save Category only creates the category once", async () => {
    mockCategories();
    let release;
    api.post.mockReset();
    api.post.mockImplementation(() => new Promise((r) => { release = () => r({ data: { ok: true } }); }));
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-categories").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byTestId("sm-add-category").click(); });
    const setInput = (id, value) => {
      const el = byTestId(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { setInput("sm-category-name-input", "Spa Day"); });
    await act(async () => { byTestId("sm-save-category").click(); byTestId("sm-save-category").click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await Promise.resolve(); });
    noReferenceErrors();
  });

  // Same gap, the Subcategory Save button right next to it.
  test("double-clicking Save on a new Subcategory only creates it once", async () => {
    mockCategories();
    let release;
    api.post.mockReset();
    api.post.mockImplementation(() => new Promise((r) => { release = () => r({ data: { ok: true } }); }));
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-categories").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byTestId("sm-expand-category-cat-groom").click(); });
    await act(async () => { byTestId("sm-add-subcategory-cat-groom").click(); });
    const setInput = (id, value) => {
      const el = byTestId(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { setInput("sm-subcategory-name-input-cat-groom", "Nail Trims"); });
    await act(async () => { byTestId("sm-save-subcategory-cat-groom").click(); byTestId("sm-save-subcategory-cat-groom").click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await Promise.resolve(); });
    noReferenceErrors();
  });

  test("a flagged category shows the Department pill in the list", async () => {
    mockCategories({ is_department: true });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-categories").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(text()).toContain("Department");
    noReferenceErrors();
  });

  // Owner, 2026-10-18: "i would like for it to show me what items are in
  // the category when expanded" — expanding used to only offer "Add
  // Subcategory"; the items actually filed under the category were nowhere
  // on screen.
  test("expanding a category lists the items filed under it", async () => {
    api.get.mockImplementation((url) => {
      if (url.includes("/shop-manager/items")) {
        return Promise.resolve({ data: { items: [
          { kind: "physical_product", id: "p1", name: "Rope Leash", active: true, list_price: 24, category_id: "cat-groom" },
          { kind: "credit_pack", id: "k1", name: "10 Visits", active: true, list_price: 280, category_id: null },
        ] } });
      }
      if (url.includes("/shop/uncategorized-items")) return Promise.resolve({ data: { items: [] } });
      if (url.includes("/shop/categories")) return Promise.resolve({ data: { categories: [
        { id: "cat-groom", name: "Grooming", section: "merch", is_department: false, active: true, item_count: 1 },
      ] } });
      return Promise.resolve({ data: {} });
    });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-categories").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(byTestId("sm-category-item-cat-groom-p1")).toBeFalsy(); // collapsed by default

    await act(async () => { byTestId("sm-expand-category-cat-groom").click(); });
    expect(byTestId("sm-category-item-cat-groom-p1")).toBeTruthy();
    expect(text()).toContain("Rope Leash");
    expect(text()).not.toContain("10 Visits"); // uncategorized, not in this category
    noReferenceErrors();
  });

  // /shop-manager/items needs the "pricing" permission; this tab
  // deliberately doesn't (ItemsTab's own forbidden message points staff
  // without it here). Expanding a category should degrade quietly, not
  // break the tab's own load.
  test("a 403 on the items list degrades to 'no items' instead of breaking the Categories tab", async () => {
    api.get.mockImplementation((url) => {
      if (url.includes("/shop-manager/items")) return Promise.reject({ response: { status: 403 } });
      if (url.includes("/shop/uncategorized-items")) return Promise.resolve({ data: { items: [] } });
      if (url.includes("/shop/categories")) return Promise.resolve({ data: { categories: [
        { id: "cat-groom", name: "Grooming", section: "merch", is_department: false, active: true, item_count: 1 },
      ] } });
      return Promise.resolve({ data: {} });
    });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-categories").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(byTestId("sm-category-cat-groom")).toBeTruthy();

    await act(async () => { byTestId("sm-expand-category-cat-groom").click(); });
    expect(text()).toContain("No items in this category yet.");
    noReferenceErrors();
  });
});

describe("CSV import", () => {
  const pickFile = async (text = "name,price\nNew Treats,10.00\n") => {
    const input = byTestId("csv-import-file-input");
    const file = new File([text], "products.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  };

  const openModal = async () => {
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-import-csv").click(); });
  };

  test("the Import CSV button opens the modal", async () => {
    await openModal();
    noReferenceErrors();
    expect(byTestId("csv-import-modal")).toBeTruthy();
  });

  test("choosing a file and previewing posts commit=false and shows the row results", async () => {
    api.post.mockResolvedValue({ data: {
      committed: false,
      rows: [{ row: 2, action: "create", name: "New Treats", id: null, error: null }],
      summary: { ok: 1, skipped: 0, total: 1 },
    } });
    await openModal();
    await pickFile();
    await act(async () => { byTestId("csv-import-preview-btn").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    noReferenceErrors();
    expect(api.post).toHaveBeenCalledWith(
      "/pos/products/import.csv", expect.any(FormData), { params: { commit: false } });
    expect(byTestId("csv-import-rows").textContent).toContain("New Treats");
    expect(byTestId("csv-import-summary").textContent).toContain("1");
  });

  test("a skipped row shows its reason instead of a silent drop", async () => {
    api.post.mockResolvedValue({ data: {
      committed: false,
      rows: [{ row: 2, action: "skip", name: "Bad Row", id: null, error: "'nope' isn't a valid price." }],
      summary: { ok: 0, skipped: 1, total: 1 },
    } });
    await openModal();
    await pickFile();
    await act(async () => { byTestId("csv-import-preview-btn").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(byTestId("csv-import-rows").textContent).toContain("isn't a valid price");
    // Nothing to apply — the Apply button must not offer to commit a no-op.
    expect(byTestId("csv-import-apply-btn").disabled).toBe(true);
  });

  test("applying the import posts commit=true and refreshes the items list", async () => {
    api.post.mockResolvedValueOnce({ data: {
      committed: false,
      rows: [{ row: 2, action: "create", name: "New Treats", id: null, error: null }],
      summary: { ok: 1, skipped: 0, total: 1 },
    } }).mockResolvedValueOnce({ data: {
      committed: true,
      rows: [{ row: 2, action: "create", name: "New Treats", id: "new-id", error: null }],
      summary: { ok: 1, skipped: 0, total: 1 },
    } });
    api.get.mockClear();
    await openModal();
    await pickFile();
    await act(async () => { byTestId("csv-import-preview-btn").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byTestId("csv-import-apply-btn").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    noReferenceErrors();
    expect(api.post).toHaveBeenLastCalledWith(
      "/pos/products/import.csv", expect.any(FormData), { params: { commit: true } });
    // onApplied re-triggers the Items load, same as any other mutation here.
    expect(api.get).toHaveBeenCalledWith("/shop-manager/items", expect.anything());
  });

  test("a read failure says so instead of a blank preview", async () => {
    api.post.mockRejectedValue({ response: { data: { detail: "That file isn't valid UTF-8 text." } } });
    await openModal();
    await pickFile();
    await act(async () => { byTestId("csv-import-preview-btn").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector('[role="alert"]').textContent).toContain("UTF-8");
  });
});

describe("the analytics dashboard", () => {
  const show = async () => {
    await mount(<ShopAnalyticsDashboard />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };

  test("it shows the money, and says where it came from", async () => {
    await show();
    noReferenceErrors();
    expect(text()).toContain("$412.50");
    expect(text()).toContain("Completed orders, net of refunds");
  });

  test("every funnel step is readable as text, not only as a bar", async () => {
    await show();
    const funnel = byTestId("shop-analytics-funnel");
    expect(funnel.tagName).toBe("TABLE");
    expect(funnel.textContent).toContain("Shop visitors");
    expect(funnel.textContent).toContain("140");
    expect(funnel.textContent).toContain("37.1%");
  });

  test("the funnel table has a caption and row headers for a screen reader", async () => {
    await show();
    const funnel = byTestId("shop-analytics-funnel");
    expect(funnel.querySelector("caption")).toBeTruthy();
    expect(funnel.querySelectorAll('th[scope="row"]').length).toBeGreaterThan(0);
  });

  test("zero-result searches are their own list, because that is the useful one", async () => {
    await show();
    expect(byTestId("shop-analytics-zero-results").textContent).toContain("puppy pads");
  });

  test("best sellers state the rule rather than just the badge", async () => {
    await show();
    expect(text()).toContain("minimum 5 units");
    expect(byTestId("shop-analytics-best-sellers").textContent).toContain("Rope Leash");
  });

  test("date range controls are real buttons with pressed state", async () => {
    await show();
    const btn = byTestId("shop-analytics-range-30");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(byTestId("shop-analytics-range-7").getAttribute("aria-pressed")).toBe("true");
  });

  test("an empty period says so rather than printing zeroes everywhere", async () => {
    api.get.mockImplementation((url) => {
      if (url.includes("/analytics/overview")) {
        return Promise.resolve({ data: {
          ...OVERVIEW,
          sales: { revenue: 0, orders: 0, units: 0, average_order_value: null,
                   guest_orders: 0, account_orders: 0 },
          departments: [], top_products: [], viewed_not_bought: [], best_sellers: [],
          searches: { top_searches: [], zero_result_searches: [] },
        } });
      }
      return Promise.resolve({ data: {} });
    });
    await show();
    expect(text()).toContain("No completed orders yet");
    expect(text()).toContain("Not enough completed sales yet");
    expect(text()).toContain("Every search found something.");
    // An average of nothing is not zero — it is nothing.
    expect(text()).toContain("—");
  });

  test("a failure says so instead of showing an empty dashboard", async () => {
    api.get.mockImplementation(() => Promise.reject({ response: { data: { detail: "Nope" } } }));
    await show();
    expect(document.querySelector('[role="alert"]').textContent).toContain("Nope");
  });
});

describe("the register sales dashboard", () => {
  const show = async () => {
    await mount(<RegisterSalesDashboard />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };

  test("it shows register units/revenue, separately from the online Shop's own numbers", async () => {
    await show();
    noReferenceErrors();
    expect(text()).toContain("$100.00");
    expect(text()).toContain("Pre-tax, net of returns");
  });

  test("by-product table lists what actually sold at the register", async () => {
    await show();
    expect(byTestId("register-sales-products").textContent).toContain("Rope Leash");
  });

  test("not-moving table surfaces in-stock items with zero register sales", async () => {
    await show();
    expect(byTestId("register-sales-not-sold").textContent).toContain("Winter Coat — Large");
  });

  test("date range controls are real buttons with pressed state", async () => {
    await show();
    const btn = byTestId("register-sales-range-30");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(byTestId("register-sales-range-7").getAttribute("aria-pressed")).toBe("true");
  });

  test("an empty period says so rather than printing zeroes everywhere", async () => {
    api.get.mockImplementation((url) => {
      if (url.includes("/register/sales-by-product")) {
        return Promise.resolve({ data: {
          range: { start_date: "2026-09-15", end_date: "2026-09-21" },
          products: [], not_sold: [], totals: { units: 0, revenue: 0 },
        } });
      }
      return Promise.resolve({ data: {} });
    });
    await show();
    expect(text()).toContain("No register sales in this period.");
    expect(text()).toContain("everything in stock sold at least once");
  });

  test("a failure says so instead of showing an empty dashboard", async () => {
    api.get.mockImplementation(() => Promise.reject({ response: { data: { detail: "Nope" } } }));
    await show();
    expect(document.querySelector('[role="alert"]').textContent).toContain("Nope");
  });
});

describe("saving a training program from the Shop Manager (audit #52)", () => {
  const MOVE = { enrollment_id: "e1", dog_name: "Rex", rule: "next_in_module", from_lesson_name: "Hand target",
                 to_lesson_name: "Check-ins", to_module_name: "Foundations" };
  const PROGRAM = { id: "t1", name: "Rock Solid Recall", type: "private_lessons", format: { count: 1, unit: "modules" }, price: 119,
                    modules: [{ id: "m1", name: "Foundations", order: 0, goals: [], lessons: [{ id: "l-c", name: "Check-ins", order: 0 }] }] };

  test("the question lists who would move, and the result says who did", async () => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => {
      if (url === "/programs/t1") return Promise.resolve({ data: PROGRAM });
      if (url.includes("active-enrollments-count")) return Promise.resolve({ data: { count: 1 } });
      if (url.includes("/homework-templates")) return Promise.resolve({ data: [] });
      return base(url);
    });
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { students_on_removed_lessons: 1, lesson_moves: [MOVE] } });
    api.put.mockReset();
    api.put.mockResolvedValue({ data: { ...PROGRAM, _lesson_moves: [MOVE] } });
    const { toast } = require("sonner");
    toast.mockClear();
    await mount(<ShopManager />);
    const row = byTestId("sm-item-row-t1");
    const edit = [...row.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    await act(async () => { edit.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byTestId("prog-save").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/programs/t1/cascade-preview", expect.objectContaining({ modules: expect.any(Array) }));
    expect(byTestId("confirm-dialog").textContent).toContain('• Rex: "Hand target" → "Check-ins" (Foundations)');
    await act(async () => { byTestId("confirm-yes").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.put).toHaveBeenCalledWith("/programs/t1?cascade=true", expect.any(Object));
    expect(toast).toHaveBeenCalledWith("1 enrolled dog changed lesson because the course changed", expect.objectContaining({ duration: 20000 }));
    noReferenceErrors();
  });
});

describe("Shop Manager program save runs Publish's checks (audit #53)", () => {
  const PROGRAM = { id: "t1", name: "Rock Solid Recall", type: "private_lessons", format: { count: 1, unit: "modules" }, price: 119,
                    modules: [{ id: "m1", name: "Foundations", order: 0, goals: [], lessons: [] }] };
  const openEditor = async () => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => {
      if (url === "/programs/t1") return Promise.resolve({ data: PROGRAM });
      if (url.includes("active-enrollments-count")) return Promise.resolve({ data: { count: 0 } });
      if (url.includes("/homework-templates")) return Promise.resolve({ data: [] });
      return base(url);
    });
    await mount(<ShopManager />);
    const edit = [...byTestId("sm-item-row-t1").querySelectorAll("button")].find((b) => b.textContent === "Edit");
    await act(async () => { edit.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };
  const save = async () => {
    await act(async () => { byTestId("prog-save").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  };

  test("a refused save lists the problems in the editor, which stays open", async () => {
    const M = "This save would put a problem live that would stop students — fix it first. Nothing was saved.";
    api.put.mockReset();
    api.put.mockRejectedValue({ response: { status: 422, data: { detail: M, detail_object: { message: M, errors: [
      { code: "broken_prerequisite", plain: "Skill 'Down' has a prerequisite that no longer exists." }] } } } });
    await openEditor();
    await save();
    const box = byTestId("program-editor-err");
    expect(box.textContent).toContain(M);
    expect(box.textContent).toContain("• Skill 'Down' has a prerequisite that no longer exists.");
    expect(byTestId("prog-save")).not.toBeNull();
    noReferenceErrors();
  });

  test("a save over old problems goes through and says they're still there", async () => {
    api.put.mockReset();
    api.put.mockResolvedValue({ data: { ...PROGRAM, _live_problems: ["Lesson 'L1' has a timer block with no duration."] } });
    const { toast } = require("sonner");
    toast.mockClear();
    await openEditor();
    await save();
    expect(toast).toHaveBeenCalledWith("Saved. This course still has a problem from before this save", expect.objectContaining({ duration: 20000 }));
    noReferenceErrors();
  });
});

describe("Mark Ready tells staff what happened to the customer's email", () => {
  test("a sent email says who it went to", async () => {
    const ORDER = { id: "so-1", status: "paid", fulfillment_status: "fulfilled", pickup_status: "preparing",
                    client_name: "Dana", total: 40, created_at: "2026-10-01T12:00:00Z",
                    lines: [{ kind: "product", name: "Rope Leash", quantity: 2 }] };
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => (url.includes("/admin/shop-orders") ? Promise.resolve({ data: { orders: [ORDER] } }) : base(url)));
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { ...ORDER, pickup_status: "ready_for_pickup", ready_email: { state: "sent", to: "dana@example.com" } } });
    const { toast } = require("sonner");
    toast.success.mockClear();
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-orders").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    await act(async () => { byTestId("sm-order-mark-ready-so-1").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/admin/shop-orders/so-1/fulfillment", { action: "mark_ready" });
    expect(toast.success).toHaveBeenCalledWith("Marked ready — we emailed dana@example.com");
    noReferenceErrors();
  });
});

describe("Mark Shipped (shipping, Shop gap-list item 5)", () => {
  test("shows the ship-to address, takes a tracking number, and tells staff it's shipped", async () => {
    const ORDER = { id: "so-2", status: "paid", fulfillment_status: "fulfilled",
                    pickup_status: "not_applicable", shipping_status: "preparing",
                    shipping_address: { address1: "1 Main St", city: "Dayton", region: "OH", zip: "45402" },
                    client_name: "Dana", total: 58, created_at: "2026-10-01T12:00:00Z",
                    lines: [{ kind: "product", name: "Dog Bed", quantity: 1 }] };
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => (url.includes("/admin/shop-orders") ? Promise.resolve({ data: { orders: [ORDER] } }) : base(url)));
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { ...ORDER, shipping_status: "shipped", tracking_number: "1Z999" } });
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-orders").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("1 Main St");
    expect(text()).toContain("Dayton");

    const setInput = (id, value) => {
      const el = byTestId(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { setInput("sm-order-tracking-input-so-2", "1Z999"); });
    await act(async () => { byTestId("sm-order-mark-shipped-so-2").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/admin/shop-orders/so-2/mark-shipped", { tracking_number: "1Z999" });
    noReferenceErrors();
  });
});

// Owner, 2026-10-18: "do the labels and shit in the app so i dont have to
// jump around sites all the time" — a real FedEx label, created and
// reprinted without leaving the Shop Manager.
describe("Create FedEx Label (owner request, 2026-10-18)", () => {
  const ORDER = { id: "so-3", status: "paid", fulfillment_status: "fulfilled",
                  pickup_status: "not_applicable", shipping_status: "preparing",
                  shipping_address: { address1: "1 Main St", city: "Dayton", region: "OH", zip: "45402" },
                  client_name: "Dana", total: 58, created_at: "2026-10-01T12:00:00Z",
                  lines: [{ kind: "product", name: "Dog Bed", quantity: 1 }] };

  beforeEach(() => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => (url.includes("/admin/shop-orders") ? Promise.resolve({ data: { orders: [ORDER] } }) : base(url)));
    global.URL.createObjectURL = jest.fn(() => "blob:label-x");
    global.URL.revokeObjectURL = jest.fn();
  });

  test("creating a label opens it to print and swaps the button to View / Print Label", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue({});
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { tracking_number: "FDX-1", label_base64: "RkFLRQ==", label_content_type: "application/pdf" } });

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-orders").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(byTestId("sm-order-create-label-so-3")).toBeTruthy();
    expect(byTestId("sm-order-view-label-so-3")).toBeFalsy();

    await act(async () => { byTestId("sm-order-create-label-so-3").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });

    expect(api.post).toHaveBeenCalledWith("/admin/shop-orders/so-3/shipping-label");
    expect(open).toHaveBeenCalledWith("blob:label-x", "_blank", "noopener");
    // The server's own tracking number now shows and the button has
    // swapped — no second click should ever bill a second shipment.
    expect(byTestId("sm-order-view-label-so-3")).toBeTruthy();
    expect(byTestId("sm-order-create-label-so-3")).toBeFalsy();
    expect(byTestId("sm-order-tracking-input-so-3").value).toBe("FDX-1");
    noReferenceErrors();
    open.mockRestore();
  });

  test("a blocked pop-up is reported, not silently swallowed", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue(null);
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { tracking_number: "FDX-2", label_base64: "RkFLRQ==", label_content_type: "application/pdf" } });
    const { toast } = require("sonner");
    toast.error.mockClear();

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-orders").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    await act(async () => { byTestId("sm-order-create-label-so-3").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Pop-up blocked"));
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:label-x");
    noReferenceErrors();
    open.mockRestore();
  });

  test("a server refusal (e.g. FedEx not configured yet) is shown, not thrown", async () => {
    api.post.mockReset();
    api.post.mockRejectedValue({ response: { data: { detail: "FedEx shipping isn't configured yet — ship this one manually for now." } } });
    const { toast } = require("sonner");
    toast.error.mockClear();

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-orders").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    await act(async () => { byTestId("sm-order-create-label-so-3").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });

    expect(toast.error).toHaveBeenCalledWith("FedEx shipping isn't configured yet — ship this one manually for now.");
    expect(byTestId("sm-order-create-label-so-3")).toBeTruthy();  // still offered — nothing was created
    noReferenceErrors();
  });

  test("View / Print Label re-fetches and re-opens the label without creating a new one", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue({});
    const SHIPPED_ORDER = { ...ORDER, tracking_number: "FDX-3" };
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) => {
      if (url === "/admin/shop-orders/so-3/shipping-label") {
        return Promise.resolve({ data: { tracking_number: "FDX-3", label_base64: "UkVQUklOVA==", label_content_type: "application/pdf" } });
      }
      if (url.includes("/admin/shop-orders")) return Promise.resolve({ data: { orders: [SHIPPED_ORDER] } });
      return base(url);
    });
    api.post.mockReset();

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-orders").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    await act(async () => { byTestId("sm-order-view-label-so-3").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });

    expect(open).toHaveBeenCalledWith("blob:label-x", "_blank", "noopener");
    expect(api.post).not.toHaveBeenCalledWith("/admin/shop-orders/so-3/shipping-label");  // reprint, never a re-create
    noReferenceErrors();
    open.mockRestore();
  });
});

describe("Discount Codes tab", () => {
  const CODE = { id: "dc-1", code: "WELCOME10", kind: "percent", value: 10, active: true,
                 clients_only: true, max_uses_total: null, max_uses_per_client: null,
                 uses_total: 0, expires_at: null, created_at: "2026-10-01T12:00:00Z" };

  test("it renders the list and can create and toggle a code", async () => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) =>
      url.includes("/admin/shop-discount-codes") ? Promise.resolve({ data: { codes: [CODE] } }) : base(url));
    api.post.mockReset();
    api.post.mockImplementation((url, body) => {
      if (url === "/admin/shop-discount-codes") return Promise.resolve({ data: { ...CODE, ...body, id: "dc-2" } });
      return Promise.resolve({ data: {} });
    });
    api.put.mockReset();
    api.put.mockResolvedValue({ data: { ...CODE, active: false } });

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-discounts").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    noReferenceErrors();
    expect(text()).toContain("WELCOME10");
    expect(text()).toContain("10% off");

    // Create a second code.
    const setInput = (id, value) => {
      const el = byTestId(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { setInput("sm-discount-code-input", "SPRING15"); });
    await act(async () => { setInput("sm-discount-value-input", "15"); });
    await act(async () => { byTestId("sm-discount-create").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/admin/shop-discount-codes", expect.objectContaining({ code: "SPRING15", value: 15 }));

    // Toggle the existing one off.
    await act(async () => { byTestId("sm-discount-toggle-WELCOME10").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.put).toHaveBeenCalledWith("/admin/shop-discount-codes/dc-1", { active: false });
    noReferenceErrors();
  });
});

describe("Printify Orders tab", () => {
  const PENDING_ROW = {
    id: "pfo-1", source: "pos_sale", source_id: "sale-12345678", status: "pending",
    fulfillment_method: "pickup", printify_order_id: null, attempts: 0, last_error: null,
    line_items: [{ name: "Trail Dog Hoodie — Small", quantity: 1 }],
    created_at: "2026-10-14T12:00:00Z",
  };
  const STUCK_ROW = {
    id: "pfo-2", source: "pos_sale", source_id: "sale-99999999", status: "stuck",
    fulfillment_method: "ship", printify_order_id: null, attempts: 8,
    last_error: "Printify API error 422: variant not found",
    line_items: [{ name: "Trail Dog Hoodie — Medium", quantity: 2 }],
    created_at: "2026-10-13T09:00:00Z",
  };
  const SHIPPED_ROW = {
    id: "pfo-3", source: "pos_sale", source_id: "sale-55555555", status: "submitted",
    fulfillment_method: "ship", printify_order_id: "pf-order-9", printify_status: "shipped",
    tracking: { code: "usps", number: "9400111", url: "https://tools.usps.com/go/x" },
    line_items: [{ name: "Trail Dog Hoodie — Large", quantity: 1 }],
    created_at: "2026-10-12T09:00:00Z",
  };

  const mockOutbox = (rows, printifyEnabled = true) => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url, opts) =>
      url.includes("/admin/printify/outbox")
        ? Promise.resolve({ data: { rows, printify_enabled: printifyEnabled } })
        : base(url, opts));
  };

  const openTab = async () => {
    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-printify_orders").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  };

  test("lists queued, stuck and shipped rows with their status and tracking", async () => {
    mockOutbox([PENDING_ROW, STUCK_ROW, SHIPPED_ROW]);
    await openTab();
    noReferenceErrors();
    expect(text()).toContain("SALE-123");
    expect(text()).toContain("Trail Dog Hoodie — Small");
    expect(text()).toContain("Queued");
    expect(text()).toContain("Stuck");
    expect(byTestId("sm-printify-error-pfo-2").textContent).toContain("variant not found");
    expect(byTestId("sm-printify-tracking-pfo-3").textContent).toContain("9400111");
  });

  test("Retry posts to the retry endpoint and reloads the list", async () => {
    mockOutbox([STUCK_ROW]);
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { ok: true } });
    await openTab();
    await act(async () => { byTestId("sm-printify-retry-pfo-2").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/admin/printify/outbox/pfo-2/retry");
    noReferenceErrors();
  });

  test("shows a setup banner when Printify isn't connected yet", async () => {
    mockOutbox([], false);
    await openTab();
    expect(byTestId("sm-printify-not-configured")).toBeTruthy();
    expect(text()).toContain("PRINTIFY_API_KEY");
  });

  test("a filter button re-requests the list with that status", async () => {
    mockOutbox([PENDING_ROW]);
    await openTab();
    api.get.mockClear();
    await act(async () => { byTestId("sm-printify-filter-stuck").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.get).toHaveBeenCalledWith("/admin/printify/outbox", { params: { status: "stuck" } });
    noReferenceErrors();
  });

  test("Register Webhooks posts the setup action and reports what was subscribed", async () => {
    mockOutbox([]);
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { created: ["order:shipment:created", "order:shipment:delivered"], already_registered: ["order:created"] } });
    const { toast } = require("sonner");
    toast.success.mockClear();
    await openTab();
    await act(async () => { byTestId("sm-printify-register-webhooks").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/admin/printify/webhooks/register");
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("order:shipment:created"));
    noReferenceErrors();
  });
});

describe("Reviews tab", () => {
  const REVIEW = { id: "rv-1", product_id: "p1", product_name: "Rope Leash", client_name: "Sam Client",
                   rating: 2, text: "Not what I expected", status: "pending", created_at: "2026-10-10T12:00:00Z" };

  test("it renders pending reviews and can approve or reject one", async () => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url) =>
      url.includes("/admin/shop-reviews") ? Promise.resolve({ data: { reviews: [REVIEW] } }) : base(url));
    api.put.mockReset();
    api.put.mockResolvedValue({ data: { ...REVIEW, status: "published" } });

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-tab-reviews").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    noReferenceErrors();
    expect(text()).toContain("Rope Leash");
    expect(text()).toContain("Sam Client");
    expect(text()).toContain("Not what I expected");

    await act(async () => { byTestId("sm-review-approve-rv-1").click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(api.put).toHaveBeenCalledWith("/admin/shop-reviews/rv-1", { status: "published" });
    noReferenceErrors();
  });
});

// Owner, 2026-10-18: "click a price right in the table, type the new
// number, done — no opening the full edit screen for a quick price
// change." update_pos_product is a full-replace PUT (PosProductIn), not a
// patch — the real risk here was an inline edit that only sent {price}
// silently wiping every other field (category, variants, visibility, tax...)
// to its Pydantic default. These tests exist specifically to catch that.
describe("Inline price/stock editing (owner request, 2026-10-18)", () => {
  const typeInto = (id, value) => {
    const el = byTestId(id);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const pressEnter = (id) => {
    byTestId(id).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };

  test("editing a physical product's price inline sends the full product payload, not a partial one", async () => {
    const RAW_P1 = {
      id: "p1", name: "Rope Leash", sku: "RL-1", category: "Leashes", description: "A leash",
      price: 24, cost: 10, low_stock_threshold: 2, track_inventory: true, active: true,
      show_online: true, online_description: "", image_id: "img1", image_ids: ["img1"],
      online_sort_order: null, category_id: "cat1", subcategory_id: null, featured: true,
      show_at_register: true, sales_destination: "internal", shopify_product_url: null,
      shopify_display_price: null, shopify_from_price: false, printify_product_id: null,
      printify_blueprint_id: null, printify_print_provider_id: null, printify_print_areas: null,
      publicly_visible: false, guest_cart_allowed: false, show_public_price: true,
      requires_approval: false, requires_completed_onboarding: false, taxable: true,
      tax_exempt_reason: null, shippable: false, shipping_weight_lbs: null, variants: [],
      stock_on_hand: 24,
    };
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url, opts) => {
      if (url === "/pos/products" && opts?.params?.include_inactive) return Promise.resolve({ data: [RAW_P1] });
      return base(url, opts);
    });
    api.put.mockReset();
    api.put.mockResolvedValue({ data: { ok: true } });

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-price-p1").click(); });
    await act(async () => { typeInto("sm-price-input-p1", "29.99"); });
    await act(async () => { pressEnter("sm-price-input-p1"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(api.put).toHaveBeenCalledWith("/pos/products/p1", expect.objectContaining({
      name: "Rope Leash", sku: "RL-1", category: "Leashes", price: 29.99,
      category_id: "cat1", featured: true, show_online: true, image_id: "img1",
    }));
    noReferenceErrors();
  });

  test("editing a credit pack's price inline merges into its raw record, not a bare patch", async () => {
    const RAW_K1 = { id: "k1", name: "10 Visits", qty: 10, price: 280, service_type: "daycare", active: true };
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url, opts) => {
      if (url === "/credit-packs" && opts?.params?.include_inactive) return Promise.resolve({ data: [RAW_K1] });
      return base(url, opts);
    });
    api.put.mockReset();
    api.put.mockResolvedValue({ data: { ok: true } });

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-price-k1").click(); });
    await act(async () => { typeInto("sm-price-input-k1", "299"); });
    await act(async () => { pressEnter("sm-price-input-k1"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(api.put).toHaveBeenCalledWith("/credit-packs/k1", expect.objectContaining({
      id: "k1", name: "10 Visits", qty: 10, price: 299, service_type: "daycare",
    }));
    noReferenceErrors();
  });

  // Unlike price, stock is an audited movement — the backend requires a
  // reason for every adjust-stock call. Inline skips the modal, not the
  // reason requirement.
  test("inline stock edit requires a reason before it will call adjust-stock", async () => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url, opts) => {
      if (url.includes("/shop-manager/items")) {
        return Promise.resolve({ data: { items: ITEMS.map((it) => it.id === "p1" ? { ...it, track_inventory: true, stock_on_hand: 5 } : it) } });
      }
      return base(url, opts);
    });
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { stock_on_hand: 10 } });

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-inventory-p1").click(); });
    await act(async () => { typeInto("sm-stock-inline-qty-p1", "5"); });
    await act(async () => { byTestId("sm-stock-inline-save-p1").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.post).not.toHaveBeenCalledWith("/pos/products/p1/adjust-stock", expect.anything());

    await act(async () => { typeInto("sm-stock-inline-reason-p1", "Shipment received"); });
    await act(async () => { byTestId("sm-stock-inline-save-p1").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/pos/products/p1/adjust-stock",
      { quantity_delta: 5, reason: "Shipment received", source: "MANUAL_ADJUSTMENT" });
    noReferenceErrors();
  });

  // Same stale-closure gap as the modal's Save below, one row up: a state
  // flag alone isn't enough to stop two clicks dispatched before React
  // re-renders the disabled button.
  test("double-clicking Save on the inline stock edit only adjusts stock once", async () => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url, opts) => {
      if (url.includes("/shop-manager/items")) {
        return Promise.resolve({ data: { items: ITEMS.map((it) => it.id === "p1" ? { ...it, track_inventory: true, stock_on_hand: 5 } : it) } });
      }
      return base(url, opts);
    });
    let release;
    api.post.mockReset();
    api.post.mockImplementation(() => new Promise((r) => { release = () => r({ data: { stock_on_hand: 10 } }); }));

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-inventory-p1").click(); });
    await act(async () => { typeInto("sm-stock-inline-qty-p1", "5"); });
    await act(async () => { typeInto("sm-stock-inline-reason-p1", "Shipment received"); });
    await act(async () => { byTestId("sm-stock-inline-save-p1").click(); byTestId("sm-stock-inline-save-p1").click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await Promise.resolve(); });
    noReferenceErrors();
  });

  // A double-click (or a slow network) must not double the stock delta —
  // the inline Save above already guards this with disabled={stockDraftSaving};
  // the Receive/Adjust Stock modal's own Save button was missing the same guard.
  test("double-clicking Save in the Receive/Adjust Stock modal only adjusts stock once", async () => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url, opts) => {
      if (url.includes("/shop-manager/items")) {
        return Promise.resolve({ data: { items: ITEMS.map((it) => it.id === "p1" ? { ...it, track_inventory: true, stock_on_hand: 5 } : it) } });
      }
      return base(url, opts);
    });
    let release;
    api.post.mockReset();
    api.post.mockImplementation(() => new Promise((r) => { release = () => r({ data: { stock_on_hand: 10 } }); }));

    await mount(<ShopManager />);
    await act(async () => { byTestId("sm-row-p1-more").click(); });
    await act(async () => { byTestId("sm-adjust-stock-p1").click(); });
    await act(async () => { typeInto("sm-stock-qty-input", "5"); });
    await act(async () => { typeInto("sm-stock-reason-input", "Shipment received"); });
    await act(async () => { byTestId("sm-stock-save").click(); byTestId("sm-stock-save").click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await Promise.resolve(); });
    noReferenceErrors();
  });
});

// Owner, 2026-10-18: "it would be greatly helpful if these collapsed into
// the correct categories... this long ass list will get out of hand fast."
describe("Items grouped by category, collapsible (owner request, 2026-10-18)", () => {
  const GROUPED_ITEMS = [
    { kind: "physical_product", id: "p1", name: "Rope Leash", active: true, list_price: 24, category_name: "Care" },
    { kind: "physical_product", id: "p2", name: "Nail Clippers", active: true, list_price: 12, category_name: "Care" },
    { kind: "physical_product", id: "p3", name: "Custom Tag", active: true, list_price: 8, category_name: "Customizable Tags" },
    { kind: "credit_pack", id: "k1", name: "10 Visits", active: true, list_price: 280 },
  ];

  beforeEach(() => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url, opts) => {
      if (url.includes("/shop-manager/items")) return Promise.resolve({ data: { items: GROUPED_ITEMS } });
      return base(url, opts);
    });
  });

  test("items are grouped under their real category, collapsed by default, uncategorized last", async () => {
    await mountRaw(<ShopManager />);
    noReferenceErrors();

    const careHeader = byTestId("sm-category-group-Care");
    const tagsHeader = byTestId("sm-category-group-Customizable Tags");
    const uncatHeader = byTestId("sm-category-group-Uncategorized");
    expect(careHeader).toBeTruthy();
    expect(tagsHeader).toBeTruthy();
    expect(uncatHeader).toBeTruthy();
    expect(careHeader.textContent).toContain("(2)");
    expect(tagsHeader.textContent).toContain("(1)");

    // Uncategorized sorts after the real categories, not alphabetically
    // first — it's a fallback bucket, not a filed-under category.
    const rows = Array.prototype.slice.call(document.querySelectorAll("tbody > tr"));
    const order = [careHeader, tagsHeader, uncatHeader].map((el) => rows.indexOf(el));
    expect(order[2]).toBeGreaterThan(order[0]);
    expect(order[2]).toBeGreaterThan(order[1]);

    // Every category starts collapsed — no item row is visible yet.
    expect(byTestId("sm-item-row-p1")).toBeFalsy();
    expect(byTestId("sm-item-row-p2")).toBeFalsy();
    expect(byTestId("sm-item-row-p3")).toBeFalsy();
    expect(byTestId("sm-item-row-k1")).toBeFalsy();

    await expandAllCategories();
    expect(byTestId("sm-item-row-p1")).toBeTruthy();
    expect(byTestId("sm-item-row-p2")).toBeTruthy();
    expect(byTestId("sm-item-row-p3")).toBeTruthy();
    expect(byTestId("sm-item-row-k1")).toBeTruthy();
    noReferenceErrors();
  });

  test("clicking a collapsed category header expands its rows, and clicking again collapses them", async () => {
    await mountRaw(<ShopManager />);

    expect(byTestId("sm-item-row-p1")).toBeFalsy();
    expect(byTestId("sm-item-row-p3")).toBeFalsy();

    await act(async () => { byTestId("sm-category-group-Care").click(); });
    expect(byTestId("sm-item-row-p1")).toBeTruthy();
    expect(byTestId("sm-item-row-p2")).toBeTruthy();
    // Expanding "Care" never touches the unrelated "Customizable Tags" rows.
    expect(byTestId("sm-item-row-p3")).toBeFalsy();
    noReferenceErrors();

    await act(async () => { byTestId("sm-category-group-Care").click(); });
    expect(byTestId("sm-item-row-p1")).toBeFalsy();
    expect(byTestId("sm-item-row-p2")).toBeFalsy();
    noReferenceErrors();
  });
});
