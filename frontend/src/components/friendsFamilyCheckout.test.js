/**
 * Checking out a friends & family dog (owner request 2026-09-28).
 *
 * Dogs of different families on one booking, one family paying ONE bill that
 * is made when the last dog leaves. Nothing is paid at a friends & family
 * pickup: the server refuses money offered there, so the screen must not
 * offer any (no tender, no gift card, no merchandise, no one-time discount,
 * no credits on a friend's dog), must say whose account the visit goes on,
 * must let a dog leave on its own, and afterwards must say where the visit
 * went instead of "Payment recorded".
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CheckoutModal } from "./CheckoutModal";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn() }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("../lib/posAgent", () => ({ printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("./ReceiptLogo", () => () => null);
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// Signed in as someone who may change prices (checkoutPricePermission.test.js covers staff who may not).
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-28";
const FF = { bill_to_client_id: "c-pat", bill_to_client_name: "Pat", group_kind: "friends_family", group_id: "g-1",
             service_type: "daycare", service_id: "svc-1", date: TODAY, status: "approved", checked_in_at: `${TODAY}T08:00:00Z` };
const REX = { ...FF, id: "bk-rex", dog_id: "d-rex", dog_name: "Rex", client_id: "c-sam", client_name: "Sam",
              estimated_price: 15, multi_dog_discount: { pre_applied: true, amount: 15 },
              pricing_snapshot: { group_dog_index: 1, group_dog_count: 2, unit_price: 30 } };
const LUNA = { ...FF, id: "bk-luna", dog_id: "d-luna", dog_name: "Luna", client_id: "c-pat", client_name: "Pat",
               estimated_price: 30, pricing_snapshot: { group_dog_index: 0, group_dog_count: 2, unit_price: 30 } };
const SERVICES = [{ id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true }];
const PRODUCTS = { items: [{ kind: "product", id: "p-1", name: "Treats", effective_price: 5, in_stock: true, taxable: false }] };

let container, root, preview;

const respond = (url) => {
  if (url.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: preview } });
  if (url.includes("/pos/catalog")) return Promise.resolve({ data: PRODUCTS });
  // The dog's own family (Sam) holds prepaid credits: never used for a dog someone else pays for.
  if (url.startsWith("/clients/")) return Promise.resolve({ data: url.endsWith("credit-lots") ? [] : { credits: 5, account_balance: 0 } });
  if (url.includes("money-modifier-preview")) return Promise.resolve({ data: { sales_tax: { enabled: false } } });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  preview = [LUNA, REX];
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (booking = REX, onClose = () => {}) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={booking} services={SERVICES} onClose={onClose} />);
  });
  await flush();
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
  await flush();
};
const checkoutPost = () => api.post.mock.calls.find(([path]) => String(path).includes("/check-out"));

test("the screen says who pays and offers no way to take money", async () => {
  await mount();
  expect(q("checkout-ff-billed-to").textContent).toBe("Billed to Pat");
  expect(q("checkout-ff-billing").textContent).toContain("Pat's account");
  for (const gone of ["checkout-pay-method", "checkout-gift-tender", "checkout-pay-mode-section", "checkout-shop",
                      "checkout-discount-panel", "opt-credit-at-checkout", "group-checkout-summary"]) {
    expect(q(gone)).toBeFalsy();
  }
  expect(q("checkout-ff-shop-note").textContent).toContain("Register for Pat");
  expect(container.textContent).toContain("On Pat's account");
});

test("both dogs leaving together: one combined checkout that offers no money", async () => {
  await mount();
  expect(q("checkout-ff-summary").textContent).toContain("Luna (Pat) + Rex (Sam)");
  expect(container.textContent).toContain("Friends & Family Check Out · 2 Dogs");
  await click("confirm-checkout");
  const [path, body] = checkoutPost();
  expect(path).toBe("/bookings/bk-rex/check-out-group");
  expect(body).toMatchObject({ use_credits: false, payment_status: "paid_partial", amount_paid: 0 });
  for (const k of ["payment_method", "retail_payment_method", "payment_notes", "gift_card_code", "retail_lines", "tendered_amount"]) expect(body[k]).toBeUndefined();
});

test("a dog can leave on its own — the rest of the group stays", async () => {
  await mount();
  await click("checkout-ff-only-this");
  await click("confirm-checkout");
  expect(checkoutPost()[0]).toBe("/bookings/bk-rex/check-out");
});

test("a dog of another family is on the checkout, whatever its family", async () => {
  // (Picked by the booking, not the family: Sam's dog sees Pat's dog as its group.)
  await mount();
  expect(q("confirm-checkout").textContent).toContain("Check Out All 2");
});

test("after the last dog leaves the screen shows the one bill, never 'Payment recorded'", async () => {
  const onClose = jest.fn();
  api.post.mockResolvedValue({ data: { friends_family: true, bookings: [{ dog_name: "Luna" }, { dog_name: "Rex" }],
    invoice: { id: "inv-9", client_name: "Pat", total: 45, dog_names: ["Luna", "Rex"], status: "OPEN" } } });
  await mount(REX, onClose);
  await click("confirm-checkout");
  expect(q("checkout-ff-result")).toBeTruthy();
  expect(q("checkout-ff-bill").textContent).toContain("$45.00");
  expect(q("checkout-hw-status")).toBeFalsy();
  expect(container.textContent).not.toContain("Payment recorded");
  expect(onClose).not.toHaveBeenCalled();
  await click("checkout-ff-done");
  expect(onClose).toHaveBeenCalled();
});

test("a dog leaving first goes on the account; staff can close the bill now", async () => {
  api.post.mockImplementation((path) => String(path).includes("close-bill")
    ? Promise.resolve({ data: { id: "inv-3", client_name: "Pat", total: 15, dog_names: ["Rex"] } })
    : Promise.resolve({ data: { dog_name: "Rex", group_bill: null } }));
  await mount();
  await click("checkout-ff-only-this");
  await click("confirm-checkout");
  expect(q("checkout-ff-on-account").textContent).toContain("Pat's account");
  await click("checkout-ff-close-bill");               // asks first: the others won't be on this bill
  expect(q("checkout-ff-close-warning")).toBeTruthy();
  expect(api.post.mock.calls.some(([p]) => String(p).includes("close-bill"))).toBe(false);
  await click("checkout-ff-close-bill");
  expect(api.post.mock.calls.some(([p]) => p === "/bookings/group/g-1/close-bill")).toBe(true);
  expect(q("checkout-ff-bill").textContent).toContain("$15.00");
});

test("a refusal to close the bill is shown, not swallowed", async () => {
  api.post.mockImplementation((path) => String(path).includes("close-bill")
    ? Promise.reject({ response: { data: { detail: "No dog of this group is waiting to be billed." } } })
    : Promise.resolve({ data: { dog_name: "Rex" } }));
  await mount();
  await click("checkout-ff-only-this");
  await click("confirm-checkout");
  await click("checkout-ff-close-bill");
  await click("checkout-ff-close-bill");
  expect(q("checkout-ff-error").textContent).toContain("No dog of this group");
});

test("the paying family's own dog goes on the one bill too — no credits (first release)", async () => {
  preview = [LUNA];
  await mount(LUNA);
  expect(q("checkout-ff-billed-to").textContent).toBe("Pays for the group");
  expect(q("opt-credit-at-checkout")).toBeFalsy();
  await click("confirm-checkout");
  const [, body] = checkoutPost();
  expect(body).toMatchObject({ use_credits: false, payment_status: "paid_partial", amount_paid: 0 });
  expect(body.payment_method).toBeUndefined();
});

test("a family's own booking checks out exactly as before", async () => {
  const own = { ...LUNA, bill_to_client_id: undefined, bill_to_client_name: undefined, group_kind: undefined, group_id: undefined,
                client_id: "c-dana", client_name: "Dana" };
  preview = [own];
  await mount(own);
  expect(q("checkout-ff-billed-to")).toBeFalsy();
  expect(q("checkout-ff-billing")).toBeFalsy();
  expect(q("opt-credit-at-checkout")).toBeTruthy();     // the family's credits, as always
  expect(q("checkout-discount-panel")).toBeTruthy();
  expect(q("checkout-shop")).toBeTruthy();
});

// ------------------------------------------------------------- review fixes

test("the checkout tells the server which way it expects to go", async () => {
  await mount();
  await click("confirm-checkout");
  expect(checkoutPost()[1].expect_friends_family).toBe(true);
});

test("an ordinary checkout says it is not friends & family", async () => {
  const own = { ...LUNA, bill_to_client_id: undefined, bill_to_client_name: undefined, group_kind: undefined, group_id: undefined,
                client_id: "c-dana", client_name: "Dana" };
  preview = [own];
  await mount(own);
  await click("confirm-checkout");
  expect(checkoutPost()[1].expect_friends_family).toBe(false);
});

test("extra nights on a friends & family stay never come off anyone's credits — the screen charges every night", async () => {
  const stay = { ...REX, service_type: "boarding", date: TODAY, end_date: TODAY };
  preview = [stay];
  await mount(stay);
  await click("extra-nights-plus");
  expect(q("extra-nights-use-credits")).toBeFalsy();        // Sam's own credits are not offered
  expect(q("extra-nights-rate")).toBeTruthy();
  await click("confirm-checkout");
  expect(checkoutPost()[1]).toMatchObject({ extra_nights: 1, extra_nights_use_credits: false });
});

test("a combined checkout that fails part-way shows the dogs as they are now", async () => {
  api.post.mockRejectedValueOnce({ response: { data: { detail: "You don't have permission to override the checkout price." } } });
  await mount();
  const before = api.get.mock.calls.filter(([url]) => String(url).includes("checkout-group-preview")).length;
  preview = [REX];                                   // Luna already left
  await click("confirm-checkout");
  const after = api.get.mock.calls.filter(([url]) => String(url).includes("checkout-group-preview")).length;
  expect(after).toBe(before + 1);
  expect(q("checkout-ff-summary")).toBeFalsy();       // one dog left: no "all leaving" choice
  expect(q("confirm-checkout").textContent).toContain("Check Out · on Pat's account");
});

// ------------------------------------------------------------- final review fixes

test("a failed 'only this dog' checkout is retried as only this dog — never the whole group", async () => {
  api.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Checkout is already in progress. Wait a moment and refresh." } } });
  await mount();
  await click("checkout-ff-only-this");
  await click("confirm-checkout");
  await click("confirm-checkout");
  const paths = api.post.mock.calls.map(([p]) => p).filter((p) => String(p).includes("/check-out"));
  expect(paths).toEqual(["/bookings/bk-rex/check-out", "/bookings/bk-rex/check-out"]);
});

test("an ordinary checkout refused because the booking just changed reads it again", async () => {
  const own = { ...LUNA, bill_to_client_id: undefined, bill_to_client_name: undefined, group_kind: undefined, group_id: undefined,
                client_id: "c-dana", client_name: "Dana" };
  preview = [own];
  api.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "This booking was just changed. Refresh and try again." } } });
  await mount(own);
  preview = [{ ...own, bill_to_client_id: "c-dana", bill_to_client_name: "Dana", group_kind: "friends_family", group_id: "g-9" }];
  await click("confirm-checkout");
  expect(q("checkout-ff-billed-to")).toBeTruthy();        // now shown as friends & family
  await click("confirm-checkout");
  expect(api.post.mock.calls.at(-1)[1].expect_friends_family).toBe(true);
});

test("if this dog already left in a checkout that failed part-way, the screen says so and offers no checkout", async () => {
  api.post.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Something went wrong." } } });
  await mount();                                     // Rex's checkout, both dogs here
  preview = [LUNA];                                  // Rex went; Luna's failed
  await click("confirm-checkout");
  expect(q("checkout-anchor-gone").textContent).toMatch(/Rex has already been checked out.*Luna/);
  expect(q("confirm-checkout").disabled).toBe(true);
});

test("the early-checkout price is asked again before checking out — a changed price is shown, not charged", async () => {
  const stay = { ...LUNA, bill_to_client_id: undefined, bill_to_client_name: undefined, group_kind: undefined, group_id: undefined,
                 client_id: "c-dana", client_name: "Dana", service_type: "boarding", date: "2026-09-26", end_date: "2026-09-30" };
  preview = [stay];
  let early = 100;
  api.get.mockImplementation((url) => (String(url).includes("early-checkout-quote")
    ? Promise.resolve({ data: { applicable: true, base_price: early, units: 2 } }) : respond(String(url))));
  await mount(stay);                                 // (no boarding credits: paid at the desk)
  early = 140;                                       // the pickup time passed the checkout time
  await click("confirm-checkout");
  expect(checkoutPost()).toBeUndefined();
  expect(q("checkout-error").textContent).toContain("$140.00");
  await click("confirm-checkout");
  expect(checkoutPost()[1].base_price).toBe(140);
});

test("a discount typed before the booking turned out to be friends & family is never sent", async () => {
  // The screen opened on the family's own visit; meanwhile the visit joined a
  // friends & family group. The refused checkout reloads it, and the discount
  // typed earlier (its box now hidden) must not ride along or block it.
  const own = { ...LUNA, bill_to_client_id: undefined, bill_to_client_name: undefined, group_kind: undefined, group_id: undefined };
  preview = [own];
  await mount(own);
  await click("opt-no-credit-at-checkout");               // paid today (the family's credits stay)
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  for (const [id, value] of [["checkout-discount-amount", "5"], ["checkout-discount-reason", "loyal family"]]) {
    const el = q(id);
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  await flush();
  api.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "This booking just changed. Check it and try again." } } });
  preview = [LUNA, REX];                                   // it is friends & family now
  await click("confirm-checkout");
  expect(q("checkout-discount-panel")).toBeFalsy();
  await click("confirm-checkout");
  const posts = api.post.mock.calls.filter(([path]) => String(path).includes("/check-out"));
  const last = posts[posts.length - 1][1];
  expect(last.checkout_discount_amount).toBeUndefined();
  expect(last.checkout_discount_reason).toBeUndefined();
  expect(q("checkout-error")).toBeFalsy();
});

