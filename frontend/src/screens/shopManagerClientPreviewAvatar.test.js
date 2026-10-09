/**
 * Shop Manager → Client Preview tab — client search result rows get the
 * same small initial-circle avatar EntitySearchPicker's no-photo fallback
 * uses (clients have no stored photo field, so it's always the initial).
 * This is cosmetic only: the search/debounce/selection logic is untouched,
 * so this test does not touch it either — it only proves the avatar renders
 * next to each existing result row.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "../lib/useConfirm";
import ShopManager from "./ShopManager";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(),
         defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
// PortalShop (the actual preview surface) is irrelevant to this avatar test
// and pulls in its own heavy catalog/pricing fetches — stub it out.
jest.mock("../components/PortalShop", () => () => <div data-testid="portal-shop-stub" />);

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENTS = [
  { id: "c1", name: "Alex Morgan" },
  { id: "c2", name: "Jamie Lee" },
];

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url.includes("/shop-manager/items")) return Promise.resolve({ data: { items: [] } });
    if (url.includes("/clients/options")) return Promise.resolve({ data: CLIENTS });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);

const mount = async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter><ConfirmProvider><ShopManager /></ConfirmProvider></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("each client search result row shows an initial-circle avatar, same style as EntitySearchPicker's no-photo fallback", async () => {
  await mount();
  await act(async () => { byTestId("sm-tab-preview").click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  const input = container.querySelector('input[placeholder="Search a client to preview their exact pricing…"]');
  expect(input).not.toBeNull();
  await setValue(input, "al");
  // the debounce in ClientPreviewTab is 200ms
  await act(async () => { await new Promise((r) => setTimeout(r, 250)); });

  const rows = [...container.querySelectorAll("button")].filter((b) => b.textContent.includes("Morgan") || b.textContent.includes("Lee"));
  expect(rows.length).toBe(2);
  for (const row of rows) {
    const avatar = row.querySelector(".rounded-full.bg-shPrimary\\/20");
    expect(avatar).not.toBeNull();
  }
  const alexRow = rows.find((r) => r.textContent.includes("Morgan"));
  expect(alexRow.querySelector(".rounded-full.bg-shPrimary\\/20").textContent).toBe("A");
  const jamieRow = rows.find((r) => r.textContent.includes("Lee"));
  expect(jamieRow.querySelector(".rounded-full.bg-shPrimary\\/20").textContent).toBe("J");

  // the search/selection logic itself is untouched: picking still works.
  await act(async () => { alexRow.click(); });
  expect(container.textContent).toContain("Alex Morgan");
});
