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

let container, root, errors;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  errors = [];
  jest.spyOn(console, "error").mockImplementation((...a) => errors.push(String(a[0])));
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url.includes("/analytics/overview")) return Promise.resolve({ data: OVERVIEW });
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
