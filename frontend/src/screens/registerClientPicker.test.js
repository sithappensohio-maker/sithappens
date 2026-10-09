/**
 * Register tab client picker — EntitySearchPicker swap.
 *
 * clientSelect() (Staff.jsx) is one shared helper reused by four manual
 * financial-entry modals (New Sale, Sell Credits, Record Payment, Issue
 * Refund). It used to be a plain long <select>; this proves the swap to
 * EntitySearchPicker (search box + tappable result cards, collapsing into a
 * selected-item card) actually drives the SAME state/handlers/validation in
 * all four modals, with zero other behavior change. Mounted test (not a
 * source-pin) per house convention — see RegisterTabPermissions.test.js.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RegisterTab } from "./Staff";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, ConfirmProvider: ({ children }) => children }));

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENTS = [
  { id: "c1", name: "Alex Morgan", account_balance: 0 },
  { id: "c2", name: "Jamie Lee", account_balance: 42.5 },
];
const PACKS = [
  { id: "pk1", name: "5-Pack Daycare", qty: 5, service_type: "daycare", price: 150, active: true },
];

let container, root, posted;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  posted = [];
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((path) => {
    const byPath = {
      "/clients/options": CLIENTS,
      "/credit-packs": PACKS,
      "/expenses": [],
      "/expenses/categories": { categories: [] },
      "/admin/register/day": { totals: { expected_cash: 100 }, activity: [], register_closed: false, incoming_by_method: {}, incoming_sources: {} },
    };
    if (path in byPath) return Promise.resolve({ data: byPath[path] });
    return Promise.resolve({ data: [] });
  });
  api.post.mockImplementation((path, body) => { posted.push({ path, body }); return Promise.resolve({ data: {} }); });
  useAuth.mockReturnValue({ can: () => true });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

async function mount() {
  root = createRoot(container);
  await act(async () => { root.render(<RegisterTab />); });
}
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.click(); }); };
const goTo = async (tab) => { await click(q(`register-mode-${tab}`)); };
const buttonWithText = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const labelField = (text) => {
  const span = [...container.querySelectorAll("label > span")].find((s) => s.textContent.trim() === text);
  if (!span) throw new Error(`no label "${text}" found`);
  return span.parentElement.querySelector("input,select");
};
const setFieldValue = async (el, value) => {
  const isSelect = el.tagName.toLowerCase() === "select";
  const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  await act(async () => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event(isSelect ? "change" : "input", { bubbles: true }));
  });
};
const searchAndPickClient = async (query, clientId) => {
  await setFieldValue(q("register-client-search-input"), query);
  const result = q(`register-client-result-${clientId}`);
  if (!result) throw new Error(`no search result for client ${clientId} (query "${query}")`);
  await click(result);
};

test("New Sale: client field is the search+cards picker, not a plain dropdown, and the picked client reaches the sale payload", async () => {
  await mount();
  await goTo("sale");
  // The old plain <select> for client is gone — EntitySearchPicker is there instead.
  expect(q("register-client")).not.toBeNull();
  expect(q("register-client-search-input")).not.toBeNull();
  await searchAndPickClient("Jamie", "c2");
  // Selecting collapses into the selected-item card showing that client.
  expect(q("register-client-selected-card").textContent).toContain("Jamie Lee");

  await setFieldValue(labelField("Description"), "Leash");
  await setFieldValue(labelField("Amount collected"), "25");
  await click(buttonWithText("Log sale"));

  const sale = posted.find((p) => p.path === "/retail-sales");
  expect(sale).toBeTruthy();
  expect(sale.body.client_id).toBe("c2");
});

test("Sell Credits: no 'walk-in' option (client required) and the picked client drives the sell-packs endpoint", async () => {
  await mount();
  await goTo("pack");
  expect(q("register-client-results").textContent).not.toContain("No client / walk-in");
  await searchAndPickClient("Alex", "c1");
  expect(q("register-client-selected-card").textContent).toContain("Alex Morgan");

  await setFieldValue(labelField("Credit pack / single-day credit"), "pk1");
  await click(buttonWithText("Sell credit order"));

  const packCall = posted.find((p) => p.path === "/clients/c1/sell-packs");
  expect(packCall).toBeTruthy();
});

test("Record Payment: no 'walk-in' option and the picked client drives the payment endpoint", async () => {
  await mount();
  await goTo("payment");
  expect(q("register-client-results").textContent).not.toContain("No client / walk-in");
  await searchAndPickClient("Jamie", "c2");
  expect(q("register-client-selected-card").textContent).toContain("Jamie Lee");

  await setFieldValue(labelField("Amount paid"), "50");
  await click(buttonWithText("Record payment"));

  const paymentCall = posted.find((p) => p.path === "/clients/c2/payment");
  expect(paymentCall).toBeTruthy();
  expect(paymentCall.body.amount).toBe(50);
});

test("Issue Refund: blank/walk-in stays available, and a picked client drives the refund endpoint", async () => {
  await mount();
  await goTo("refund");
  expect(q("register-client-results").textContent).toContain("No client / walk-in");
  await searchAndPickClient("Jamie", "c2");
  expect(q("register-client-selected-card").textContent).toContain("Jamie Lee");

  await setFieldValue(labelField("Refund amount"), "10");
  await setFieldValue(labelField("Reason"), "Overcharge");
  await click(q("refund-not-against-sale"));
  await click(buttonWithText("Record refund"));

  const refundCall = posted.find((p) => p.path === "/admin/register/refund");
  expect(refundCall).toBeTruthy();
  expect(refundCall.body.client_id).toBe("c2");
});
