/**
 * The client record shows a family's marketing opt-out and lets staff clear it, after a
 * confirm, when they have the communications permission (audit #38). Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ClientMarketingOptOut from "./ClientMarketingOptOut";

jest.mock("../lib/api", () => ({
  api: { put: jest.fn() },
  formatErr: (e) => String(e),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const mockConfirm = jest.fn(async () => true);
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => mockConfirm }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const OPTED_OUT = { id: "c-1", marketing_email_opt_out: true, marketing_email_opt_out_source: "unsubscribe_link", marketing_email_opt_out_at: "2031-06-09T12:00:00+00:00" };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mockConfirm.mockReset().mockImplementation(async () => true);
  api.put.mockReset().mockResolvedValue({ data: { opted_out: false } });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const mount = async (el) => {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await flush();
};

test("a family that is not opted out shows nothing", async () => {
  await mount(<ClientMarketingOptOut client={{ id: "c-2", marketing_email_opt_out: false }} canClear />);
  expect(q("client-marketing-optout")).toBeNull();
});

test("an opted-out family says why, and staff with the permission can clear it after a confirm", async () => {
  await mount(<ClientMarketingOptOut client={OPTED_OUT} canClear />);
  expect(q("client-marketing-optout").textContent).toContain("Family unsubscribed from an email");

  await act(async () => { q("client-marketing-optout-clear").click(); });
  await flush();

  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(api.put).toHaveBeenCalledWith("/admin/clients/c-1/marketing-email-preference", { opted_out: false });
  expect(q("client-marketing-optout")).toBeNull();
});

test("a declined confirm changes nothing", async () => {
  mockConfirm.mockImplementation(async () => false);
  await mount(<ClientMarketingOptOut client={OPTED_OUT} canClear />);
  await act(async () => { q("client-marketing-optout-clear").click(); });
  await flush();
  expect(api.put).not.toHaveBeenCalled();
  expect(q("client-marketing-optout")).not.toBeNull();
});

test("without the permission the reason shows and there is no clear button", async () => {
  await mount(<ClientMarketingOptOut client={{ ...OPTED_OUT, marketing_email_opt_out_source: "staff", marketing_email_opt_out_by: "Sam" }} canClear={false} />);
  expect(q("client-marketing-optout").textContent).toContain("Opted out by staff by Sam");
  expect(q("client-marketing-optout-clear")).toBeNull();
});
