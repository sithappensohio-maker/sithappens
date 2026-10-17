/**
 * The Shop Manager's product editor round-trips printify_print_areas.
 *
 * A Printify product with real personalization placeholders (Name/Phone/
 * Address text layers) never showed those input fields anywhere — not at
 * the register, not on the online Shop's product page — because this
 * editor's form never loaded `printify_print_areas` from the product it
 * was editing, and never sent it back on save. The backend derives
 * personalization_fields from THIS field alone, so every save silently
 * reset it to empty, no matter what "Fetch Sizes" had just fetched.
 * Mounted, same shape as shopManagerProductTax.test.js's own regression
 * for the identical class of bug (a field loaded-but-never-saved).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "../lib/useConfirm";
import ShopManager from "./ShopManager";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS = [{ kind: "physical_product", id: "p1", name: "Shut Your Bark Hole Tag", active: true, list_price: 15.99 }];
const PRINT_AREAS = [{ placeholders: [{ images: [{ layerType: "text", name: "Name" }, { layerType: "text", name: "Phone" }] }] }];

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.put.mockReset();
});
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });

const mount = async (el) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter><ConfirmProvider>{el}</ConfirmProvider></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const saveButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save");

function mockProductsList(raw) {
  api.get.mockImplementation((url) => {
    if (url.includes("/shop-manager/items")) return Promise.resolve({ data: { items: ITEMS } });
    if (url.includes("/pos/products")) return Promise.resolve({ data: [raw] });
    if (url.includes("/programs/meta")) return Promise.resolve({ data: { types: [], focuses: [] } });
    if (url.includes("/programs")) return Promise.resolve({ data: [] });
    if (url.includes("/email-templates")) return Promise.resolve({ data: [] });
    if (url.includes("/shop/categories")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
}

async function openEditor() {
  await mount(<ShopManager />);
  const row = byTestId("sm-item-row-p1");
  const edit = [...row.querySelectorAll("button")].find((b) => b.textContent === "Edit");
  await act(async () => { edit.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

test("saving an untouched Printify product keeps its real print_areas — the server is told, not just held in memory", async () => {
  mockProductsList({
    id: "p1", name: "Shut Your Bark Hole Tag", price: 15.99, active: true, show_at_register: true,
    sales_destination: "printify", printify_product_id: "pf-tag-1",
    printify_blueprint_id: 6, printify_print_provider_id: 99,
    printify_print_areas: PRINT_AREAS,
    variants: [{ id: "v1", name: "1\"", printify_variant_id: "pf-var-1" }],
  });
  await openEditor();
  api.put.mockResolvedValue({ data: {} });
  await act(async () => { saveButton().click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.put).toHaveBeenCalledWith("/pos/products/p1", expect.objectContaining({ printify_print_areas: PRINT_AREAS }));
});

test("a non-Printify product never sends print_areas, even if some stray value is on the form", async () => {
  mockProductsList({
    id: "p1", name: "Shut Your Bark Hole Tag", price: 15.99, active: true, show_at_register: true,
    sales_destination: "internal", printify_print_areas: PRINT_AREAS, // stray leftover, must not leak through
  });
  await openEditor();
  api.put.mockResolvedValue({ data: {} });
  await act(async () => { saveButton().click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.put).toHaveBeenCalledWith("/pos/products/p1", expect.objectContaining({ printify_print_areas: null }));
});
