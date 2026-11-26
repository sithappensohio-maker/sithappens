/**
 * When a prepaid visit actually comes off the balance, as the Shop tells it.
 *
 * The Shop used to promise clients that a prepaid visit comes off "at
 * check-in". It does not: nothing is taken at drop-off, the visit is taken
 * when staff finish the visit at checkout. A client who read the old line
 * and looked at their balance while the dog was still with us saw a number
 * that contradicted what the Shop had just told them.
 *
 * These mount the real card and the real product-page facts and read the
 * words a client reads, in both places the sentence appears.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ValueCard, ShopCard } from "./ShopCards";
import ProductFacts from "./ProductFacts";

jest.mock("../../lib/api", () => ({
  api: { get: jest.fn(() => Promise.resolve({ data: [] })), post: jest.fn(() => Promise.resolve({ data: {} })), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });

const mount = (el) => act(() => { root = createRoot(container); root.render(el); });
const text = () => container.textContent || "";
const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);

// Any spelling of it: "check-in", "check in", "checkin", "checked in".
const CHECK_IN = /check(ed)?[\s-]?in/i;

const pack = { kind: "credit_pack", id: "k1", name: "10 Daycare Visits", price: 280, qty: 10,
               display_quantity: 10, display_unit: "visits", service_type: "daycare",
               account_required: true };
const trainingPack = { ...pack, id: "k2", name: "5 Training Sessions", price: 400, qty: 5,
                       display_quantity: 5, display_unit: "sessions", service_type: "training" };

describe("the credit-pack card", () => {
  test("says a visit comes off after each visit, never at check-in", () => {
    mount(<ValueCard item={pack} mode="authenticated" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(text()).toMatch(/come off\s+your balance automatically after each visit/i);
    expect(text()).not.toMatch(CHECK_IN);
  });

  test("the same wording reaches the grid through ShopCard", () => {
    // The storefront never mounts ValueCard directly — it goes through the
    // kind switch, so that is the path a client's screen takes.
    mount(<ShopCard item={pack} mode="guest" onOpenDetail={() => {}} onRequireAccount={() => {}} />);
    expect(text()).toContain("after each visit");
    expect(text()).not.toMatch(CHECK_IN);
  });

  test("a training pack card does not mention check-in either", () => {
    mount(<ValueCard item={trainingPack} mode="authenticated" onOpenDetail={() => {}} onAdd={() => {}} />);
    expect(text()).toContain("after each visit");
    expect(text()).not.toMatch(CHECK_IN);
  });
});

describe("the credit-pack product page facts", () => {
  test("What's included says after each visit, never at check-in", () => {
    mount(<ProductFacts item={pack} mode="authenticated" />);
    const included = [...byTestId("pdp-included-list").querySelectorAll("li")].map((li) => li.textContent);
    expect(included).toContain("Taken off your balance automatically after each visit");
    // The whole facts panel, closed sections included — textContent reads
    // through `hidden`, so nothing collapsed can still be carrying the old line.
    expect(byTestId("pdp-facts").textContent).not.toMatch(CHECK_IN);
  });

  test("a guest and a training pack get the same answer", () => {
    mount(<ProductFacts item={trainingPack} mode="guest" />);
    expect(byTestId("pdp-included-list").textContent).toContain("automatically after each visit");
    expect(byTestId("pdp-facts").textContent).not.toMatch(CHECK_IN);
  });
});
