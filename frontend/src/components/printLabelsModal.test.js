/* PrintLabelsModal — the barcode label print sheet.
 *
 * A product/option with no barcode yet gets one generated server-side the
 * moment this opens (never invented client-side); one that already has one
 * is shown immediately with no network call at all. Covers both paths, the
 * copies count, onSkuResolved reaching the caller's own form state, and the
 * failure path (a broken generate call must not leave a blank print sheet
 * open — it closes with a toast instead).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PrintLabelsModal } from "./ManageProductsPanel";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

let host, root;

function mount(ui) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root.render(ui); });
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  jest.clearAllMocks();
  window.print = undefined;
});

const text = () => host.textContent || "";
const byTestId = (id) => host.querySelector(`[data-testid="${id}"]`);

test("a product with no sku gets one generated on open, and onSkuResolved fires with it", async () => {
  api.post.mockResolvedValue({ data: { sku: "2123456789" } });
  const onSkuResolved = jest.fn();
  mount(
    <PrintLabelsModal productId="prod-1" itemName="Rope Leash" initialSku="" price={12}
                       onClose={() => {}} onSkuResolved={onSkuResolved} />
  );
  expect(text()).toMatch(/generating a barcode/i);
  await flush();
  expect(api.post).toHaveBeenCalledWith("/pos/products/prod-1/generate-sku");
  expect(onSkuResolved).toHaveBeenCalledWith("2123456789");
  expect(text()).not.toMatch(/generating a barcode/i);
  expect(text()).toContain("Rope Leash");
  expect(text()).toContain("$12.00");
});

test("a variant with no sku calls the variant-scoped generate endpoint", async () => {
  api.post.mockResolvedValue({ data: { sku: "2987654321" } });
  mount(
    <PrintLabelsModal productId="prod-1" variantId="var-1" itemName="Shirt — Small" initialSku="" price={20}
                       onClose={() => {}} onSkuResolved={() => {}} />
  );
  await flush();
  expect(api.post).toHaveBeenCalledWith("/pos/products/prod-1/variants/var-1/generate-sku");
});

test("an item that already has a barcode never calls generate-sku at all", async () => {
  mount(
    <PrintLabelsModal productId="prod-1" itemName="Rope Leash" initialSku="EXISTING-123" price={12}
                       onClose={() => {}} onSkuResolved={() => {}} />
  );
  await flush();
  expect(api.post).not.toHaveBeenCalled();
  expect(text()).not.toMatch(/generating a barcode/i);
});

test("the copies count renders that many label cards", async () => {
  mount(
    <PrintLabelsModal productId="prod-1" itemName="Rope Leash" initialSku="EXISTING-123" price={12}
                       onClose={() => {}} onSkuResolved={() => {}} />
  );
  await flush();
  expect(byTestId("print-labels-sheet").querySelectorAll(".print-label").length).toBe(1);
  const copiesInput = byTestId("print-labels-copies");
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    nativeSetter.call(copiesInput, "4");
    copiesInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
  expect(byTestId("print-labels-sheet").querySelectorAll(".print-label").length).toBe(4);
});

test("Print calls window.print()", async () => {
  window.print = jest.fn();
  mount(
    <PrintLabelsModal productId="prod-1" itemName="Rope Leash" initialSku="EXISTING-123" price={12}
                       onClose={() => {}} onSkuResolved={() => {}} />
  );
  await flush();
  await act(async () => { byTestId("print-labels-print-btn").click(); });
  expect(window.print).toHaveBeenCalled();
});

test("a failed generate call shows a toast and closes instead of leaving a blank sheet", async () => {
  api.post.mockRejectedValue({ response: { data: { detail: "boom" } } });
  const onClose = jest.fn();
  mount(
    <PrintLabelsModal productId="prod-1" itemName="Rope Leash" initialSku="" price={12}
                       onClose={onClose} onSkuResolved={() => {}} />
  );
  await flush();
  expect(toast.error).toHaveBeenCalledWith("boom");
  expect(onClose).toHaveBeenCalled();
});

test("a null price never renders a dollar amount on the label", async () => {
  mount(
    <PrintLabelsModal productId="prod-1" itemName="Rope Leash" initialSku="EXISTING-123" price={null}
                       onClose={() => {}} onSkuResolved={() => {}} />
  );
  await flush();
  expect(text()).not.toContain("$");
});
