/**
 * "View Receipt" on a bill that is not paid yet must not read like proof of
 * payment. The portal lets a client open the receipt for any bill, paid or
 * not, and the modal used to show only the lines and a Total. Now a bill says
 * what has been paid so far and what is still due, or "Paid in full".
 * Mounted, not source-pinned.
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
const { receiptPrintHtml, billStanding } = require("./PortalInvoices");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container; let root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });

// Mounts the bills list with one bill, taps "View Receipt", and returns the modal.
const openReceipt = async (receipt, status = "OPEN") => {
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/portal/invoices"
    ? { invoices: [{ id: "i-1", invoice_number: "7", total: 45, amount_paid: 0, balance: 45, status }] }
    : url === "/receipts/invoice/i-1" ? receipt : {} }));
  act(() => root.render(<PortalInvoices />)); await flush();
  const button = container.querySelector('[data-testid="portal-view-receipt-i-1"]');
  expect(button).not.toBeNull();
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
  const modal = container.querySelector('[data-testid="portal-receipt-view-modal"]');
  expect(modal).not.toBeNull();
  return modal;
};

const owed = (modal) => modal.querySelector('[data-testid="portal-receipt-owed"]');
const paid = (modal) => modal.querySelector('[data-testid="portal-receipt-paid"]');
// Each money row is a label span and an amount span; read them as "label|amount".
const rows = (block) => [...block.querySelectorAll("div")].map((row) => [...row.querySelectorAll("span")].map((s) => s.textContent).join("|"));

const BILL = {
  kind: "invoice", business_name: "Sit Happens", receipt_number: "INV-7", client_name: "Pat",
  line_items: [{ description: "Daycare", qty: 1, amount: 12.5 }],
};

test("a bill with nothing paid shows $0.00 paid so far and the whole amount due", async () => {
  const modal = await openReceipt({ ...BILL, total: 12.5, invoice_total: 12.5, remaining_balance: 12.5 });
  const block = owed(modal);
  expect(block).not.toBeNull();
  expect(rows(block)).toEqual(["Paid so far|$0.00", "Amount due|$12.50"]);
  expect(block.textContent).toContain("This bill is not paid in full yet.");
  expect(paid(modal)).toBeNull();
  expect(modal.textContent).not.toContain("Paid in full");
});

test("a part-paid bill shows what was paid and what is still due", async () => {
  const modal = await openReceipt({ ...BILL, total: 40, invoice_total: 40, remaining_balance: 15,
    line_items: [{ description: "Boarding", qty: 1, amount: 40 }] });
  const block = owed(modal);
  expect(block).not.toBeNull();
  expect(rows(block)).toEqual(["Paid so far|$25.00", "Amount due|$15.00"]);
  expect(block.textContent).toContain("This bill is not paid in full yet.");
  expect(paid(modal)).toBeNull();
});

test("a fully paid bill says Paid in full and shows no amount due", async () => {
  const modal = await openReceipt({ ...BILL, total: 12.5, invoice_total: 12.5, remaining_balance: 0 });
  expect(paid(modal)).not.toBeNull();
  expect(paid(modal).textContent).toBe("Paid in full");
  expect(owed(modal)).toBeNull();
  expect(modal.textContent).not.toContain("Amount due");
  expect(modal.textContent).not.toContain("not paid in full");
});

test("a receipt that is not a bill shows neither the owed lines nor Paid in full", async () => {
  // A register-sale style payload: no kind "invoice", no balance fields.
  const sale = await openReceipt({ kind: "sale", business_name: "Sit Happens", receipt_number: "S-3",
    total: 9, line_items: [{ description: "Chew toy", qty: 1, amount: 9 }] });
  expect(sale.textContent).toContain("$9.00");
  expect(owed(sale)).toBeNull();
  expect(paid(sale)).toBeNull();
  expect(sale.textContent).not.toContain("Paid so far");
  expect(sale.textContent).not.toContain("Paid in full");
});

test("a bill payload missing its balance fields claims nothing either way", async () => {
  const modal = await openReceipt({ ...BILL, total: 12.5 });
  expect(owed(modal)).toBeNull();
  expect(paid(modal)).toBeNull();
});

test("a refunded bill does not say Paid in full (a refund leaves the balance at 0)", async () => {
  const modal = await openReceipt({ ...BILL, total: 12.5, invoice_total: 12.5, remaining_balance: 0 }, "REFUNDED");
  expect(paid(modal)).toBeNull();
  expect(owed(modal)).toBeNull();
  expect(modal.querySelector('[data-testid="portal-receipt-refunded"]').textContent).toBe("Refunded");
});

test("a partly refunded bill says so", async () => {
  const modal = await openReceipt({ ...BILL, total: 12.5, invoice_total: 12.5, remaining_balance: 0 }, "PARTIALLY_REFUNDED");
  expect(paid(modal)).toBeNull();
  expect(modal.querySelector('[data-testid="portal-receipt-refunded"]').textContent).toBe("Partly refunded");
});

test("a visit covered by a prepaid visit with an add-on still owed: the prepaid visit is not counted as paid", async () => {
  const modal = await openReceipt({ ...BILL, total: 60, invoice_total: 60, remaining_balance: 20, credits_applied: 40,
    line_items: [{ description: "Daycare", qty: 1, amount: 40 }, { description: "Bath", qty: 1, amount: 20 }] });
  expect(rows(owed(modal))).toEqual(["Prepaid visits used|$40.00", "Paid so far|$0.00", "Amount due|$20.00"]);
});

describe("the printed receipt says the same thing as the one on screen", () => {
  const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  test("an unpaid bill prints what is paid and what is due", () => {
    const text = strip(receiptPrintHtml({ ...BILL, invoice_total: 40, remaining_balance: 15 }, null));
    expect(text).toContain("Paid so far $25.00");
    expect(text).toContain("Amount due $15.00");
    expect(text).toContain("This bill is not paid in full yet.");
    expect(text).not.toContain("Paid in full");
  });
  test("a paid bill prints Paid in full; a refunded one prints Refunded; a register receipt prints neither", () => {
    expect(strip(receiptPrintHtml({ ...BILL, invoice_total: 40, remaining_balance: 0 }, null))).toContain("Paid in full");
    const refunded = strip(receiptPrintHtml({ ...BILL, invoice_total: 40, remaining_balance: 0, invoice_status: "REFUNDED" }, null));
    expect(refunded).toContain("Refunded");
    expect(refunded).not.toContain("Paid in full");
    const sale = strip(receiptPrintHtml({ kind: "pos_sale", business_name: "Sit Happens", receipt_number: "R1", total: 9, line_items: [] }, null));
    expect(sale).not.toMatch(/Paid in full|Amount due|Refunded/);
    expect(billStanding({ kind: "pos_sale", total: 9 })).toBeNull();
  });
});
