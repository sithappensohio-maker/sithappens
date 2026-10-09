/**
 * The Shop Manager's product editor round-trips the sales-tax flag.
 *
 * A product correctly marked tax-exempt (unchecked "Charge sales tax") still
 * got taxed at the register, because this editor's form never loaded
 * `taxable`/`tax_exempt_reason` from the product it was editing, and never
 * sent them back on save. The checkbox looked right and did nothing: the
 * backend's own default (taxable=true) won every time, on every save, even
 * one where the admin never touched the box. Mounted — a source-pin on the
 * payload text would have missed this, since the bug was an OMITTED field,
 * not a wrong default value.
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

const ITEMS = [{ kind: "physical_product", id: "p1", name: "Nail Trim", active: true, list_price: 10 }];

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
const taxCheckbox = () => document.querySelector('[data-testid="product-taxable"]');
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

test("a genuinely taxable product shows checked when opened for edit", async () => {
  mockProductsList({ id: "p1", name: "Nail Trim", price: 10, active: true, show_at_register: true, taxable: true, tax_exempt_reason: null });
  await openEditor();
  expect(taxCheckbox().checked).toBe(true);
});

test("saving an untouched exempt product keeps it exempt — the server is told, not just the screen", async () => {
  mockProductsList({ id: "p1", name: "Nail Trim", price: 10, active: true, show_at_register: true, taxable: false, tax_exempt_reason: "Service — not sales-taxable" });
  await openEditor();
  expect(taxCheckbox().checked).toBe(false);
  api.put.mockResolvedValue({ data: {} });
  await act(async () => { saveButton().click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.put).toHaveBeenCalledWith("/pos/products/p1", expect.objectContaining({ taxable: false }));
});
