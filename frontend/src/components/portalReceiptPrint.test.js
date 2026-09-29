/**
 * The portal's printed receipt writes every value as text, never as HTML
 * (friends & family step 10 review). The print page runs in the app's own
 * origin, and a bill line can carry a name another family chose: a friends &
 * family bill names each dog ("Rex: Daycare"). Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : e ? JSON.stringify(e) : ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("./ReceiptLogo", () => ({ __esModule: true, default: () => null,
  fetchReceiptLogoDataUrl: () => Promise.resolve("data:image/png;base64,iVBORw0KGgo=") }));

const { api } = require("../lib/api");
const PortalInvoices = require("./PortalInvoices").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const EVIL = "<img src=x onerror=\"window.__pwned=1\">";
const RECEIPT = {
  business_name: "Sit & Stay <b>Co</b>", receipt_number: "R-1\"><script>window.__pwned=2</script>",
  client_name: `Pat ${EVIL}`, test_receipt: true, test_label: "<i>TEST</i>", total: 45,
  line_items: [{ description: `Rex${EVIL}: Daycare`, qty: 2, amount: 30 }, { description: "Luna: Daycare", qty: 1, amount: 15 }],
};

let container; let root; let written; let opened;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  written = "";
  opened = { document: { write: (h) => { written += h; }, close: jest.fn() }, focus: jest.fn(), print: jest.fn() };
  jest.spyOn(window, "open").mockImplementation(() => opened);
  api.get.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/portal/invoices"
    ? { invoices: [{ id: "i-1", invoice_number: "7", total: 45, amount_paid: 45, balance: 0, status: "PAID" }] }
    : url === "/receipts/invoice/i-1" ? RECEIPT : {} }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); window.open.mockRestore(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });

test("every value on the printed receipt is written as text", async () => {
  act(() => root.render(<PortalInvoices />)); await flush();
  const button = container.querySelector('[data-testid="portal-print-receipt-i-1"]');
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
  expect(window.open).toHaveBeenCalled();
  const doc = new DOMParser().parseFromString(written, "text/html");
  expect(doc.querySelector("script")).toBeNull();
  expect(doc.querySelector("b")).toBeNull();
  expect(doc.querySelector("i")).toBeNull();
  expect([...doc.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["data:image/png;base64,iVBORw0KGgo="]);
  expect([...doc.querySelectorAll("[onerror]")]).toHaveLength(0);
  const text = doc.body.textContent;
  for (const shown of [`Rex${EVIL}: Daycare`, "Luna: Daycare", `Client: Pat ${EVIL}`, "Sit & Stay <b>Co</b>",
    "Receipt #R-1\"><script>window.__pwned=2</script>", "<i>TEST</i>", "$45.00", "× 2"]) {
    expect(text).toContain(shown);
  }
});
