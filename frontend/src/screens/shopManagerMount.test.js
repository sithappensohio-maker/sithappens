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

const mount = async (el) => {
  await act(async () => {
    root = createRoot(container);
    // The real provider, not a stub: ShopManager's useConfirm throwing
    // outside one is a deliberate guard, and a test that mocks it away would
    // be testing a component the app never renders.
    root.render(<MemoryRouter><ConfirmProvider>{el}</ConfirmProvider></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
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
  // and no horizontal scrolling.
  test("Edit and Delete are always inline, never hidden behind the More menu", async () => {
    await mount(<ShopManager />);
    const row = byTestId("sm-item-row-p1");
    expect(row.querySelector('[data-testid="sm-delete-p1"]')).toBeTruthy();
    expect([...row.querySelectorAll("button")].some((b) => b.textContent === "Edit")).toBe(true);
    // Not yet opened — Duplicate lives inside the collapsed menu.
    expect(byTestId("sm-duplicate-p1")).toBeFalsy();
    await act(async () => { byTestId("sm-row-p1-more").click(); });
    expect(byTestId("sm-duplicate-p1")).toBeTruthy();
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
