/**
 * The guest checkout no longer promises a receipt that is only sent when the shop's
 * automatic receipts are on (audit #72). Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import GuestCheckoutPanel from "./GuestCheckoutPanel";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/goTo", () => ({ goTo: jest.fn() }));
jest.mock("../lib/shopGuestCart", () => ({ rememberGuestOrderToken: jest.fn() }));
jest.mock("../lib/shopPolish", () => ({ isCheckoutRestart: () => false }));
jest.mock("./premium/PremiumButton", () => (props) => <button {...props}>{props.children}</button>);
const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container);
  api.post.mockReset().mockResolvedValue({ data: { lines: [{ kind: "product", ref_id: "p1", quantity: 1, name: "Bag of food", unit_price: 10, line_total: 10, taxable: false }], subtotal: 10, total: 10, blocked: null } });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

test("the guest checkout does not promise a receipt the shop may not send", async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<GuestCheckoutPanel cart={[{ kind: "product", ref_id: "p1", quantity: 1, name: "Bag of food", price: 10 }]} onClose={() => {}} onSignIn={() => {}} onRemoveLines={() => {}} />);
  });
  const text = document.body.textContent;   // the panel renders through a portal
  expect(text).not.toContain("send your receipt");
  expect(text).not.toContain("Email for your receipt");
});
