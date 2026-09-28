/**
 * A family's page and friends & family bookings (owner request 2026-09-28).
 * Mounted, not source-pinned.
 *
 * The paying family's page lists the friends' dogs it pays for and says when
 * dogs are waiting for their one bill (payments on the account wait until the
 * bill is made); staff who take payments can close the bill now, after a
 * warning. Each booking row says who pays.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ClientHub from "./ClientHub";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("./IntakeFormsSection", () => () => null);
jest.mock("./CommunicationLog", () => () => null);
jest.mock("./TrophyWall", () => () => null);
jest.mock("./AdminClientPaymentPlans", () => () => null);
jest.mock("./BillFixModal", () => () => null);
jest.mock("./Avatar", () => () => null);

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const PAT = { id: "c-pat", name: "Pat", dogs: [], account_balance: 15 };
let container, root, ff;

const respond = (url) => {
  if (url === "/bookings") return Promise.resolve({ data: [
    { id: "bk-luna", dog_name: "Luna", service_type: "daycare", date: "2026-09-28", status: "completed",
      bill_to_client_id: "c-pat", bill_to_client_name: "Pat", client_id: "c-pat" }] });
  if (url === "/clients/c-pat/friends-family") return Promise.resolve({ data: ff });
  if (url === "/clients/c-pat/visits") return Promise.resolve({ data: false });
  return Promise.resolve({ data: [] });
};

beforeEach(() => {
  ff = { waiting_for_bill: true, groups: [{ group_id: "g-1", waiting: true, dogs: [
    { dog_id: "d-luna", dog_name: "Luna", client_id: "c-pat", client_name: "Pat", date: "2026-09-28", status: "completed" },
    { dog_id: "d-rex", dog_name: "Rex", client_id: "c-sam", client_name: "Sam", date: "2026-09-28", status: "approved" }] }] };
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset(); api.post.mockResolvedValue({ data: { id: "inv-1", total: 45 } });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (props = {}) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<ClientHub client={PAT} onClose={() => {}} can={() => true} {...props} />);
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

test("the paying family's page lists the friends' dogs it pays for and says a bill is waiting", async () => {
  await mount();
  expect(q("hub-ff-waiting").textContent).toContain("take the payment on the bill");
  expect(q("hub-ff-group-g-1").textContent).toMatch(/Rex \(Sam\).*waiting for the bill/);
  expect(q("hub-ff-group-g-1").textContent).not.toContain("Luna");
});

test("staff close the bill now only after the warning", async () => {
  await mount();
  await click("hub-ff-close-bill-g-1");
  expect(q("hub-ff-close-warning")).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  await click("hub-ff-close-bill-g-1");
  expect(api.post).toHaveBeenCalledWith("/bookings/group/g-1/close-bill");
  expect(q("hub-ff-bill-msg").textContent).toContain("$45.00");
});

test("no close button for someone who can't take payments", async () => {
  await mount({ can: (k) => k !== "take_payments" });
  expect(q("hub-ff-group-g-1")).toBeTruthy();
  expect(q("hub-ff-close-bill-g-1")).toBeFalsy();
});

test("a family paying for nobody sees nothing new", async () => {
  ff = { waiting_for_bill: false, groups: [] };
  await mount();
  expect(q("hub-ff-waiting")).toBeFalsy();
  expect(q("hub-ff-paying-for")).toBeFalsy();
});

test("each booking row says who pays", async () => {
  await mount({ initialTab: "bookings" });
  expect(q("hub-booking-paid-by-bk-luna").textContent).toBe("Friends & family · paying");
});

test("'make the bill now' runs once, however fast it is pressed", async () => {
  let release;
  api.post.mockImplementation(() => new Promise((r) => { release = () => r({ data: { id: "inv-1", total: 45 } }); }));
  await mount();
  await click("hub-ff-close-bill-g-1");
  const btn = q("hub-ff-close-bill-g-1");
  await act(async () => { btn.click(); btn.click(); });
  await act(async () => { release(); });
  await flush();
  expect(api.post).toHaveBeenCalledTimes(1);
});
