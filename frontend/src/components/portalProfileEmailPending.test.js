/**
 * Saving a new email in My Profile says the change waits for the link (audit #27):
 * the modal stays open with the notice, and the email field goes back to the
 * address the family still has. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PortalProfileModal from "./PortalProfileModal";

jest.mock("../lib/api", () => ({
  api: { put: jest.fn() },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ user: { needs_password: false }, reloadUser: jest.fn() }) }));
jest.mock("./SetPasswordForm", () => () => null);
jest.mock("./premium/PremiumButton", () => ({ children, ...rest }) => <button {...rest}>{children}</button>);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT = { name: "Sam Owner", email: "old@example.com", address: "1 Main St", phone: "555-0100", emerg: "Jo 555-0101" };
let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.put.mockReset();
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const typeInto = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};

test("a changed address shows the pending notice and keeps the modal open", async () => {
  api.put.mockResolvedValueOnce({ data: { client: {}, email_change_pending: true } });
  const onClose = jest.fn();
  const onSaved = jest.fn();
  await act(async () => {
    root = createRoot(container);
    root.render(<PortalProfileModal client={CLIENT} onClose={onClose} onSaved={onSaved} />);
  });
  await flush();
  typeInto(q("pp-email"), "new@example.com");
  await act(async () => { q("pp-submit").click(); });
  await flush();

  expect(api.put).toHaveBeenCalledWith("/portal/me", expect.objectContaining({ email: "new@example.com" }));
  expect(q("pp-email-pending").textContent).toContain("new@example.com");
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(q("pp-email").value).toBe("old@example.com");
  expect(q("pp-submit")).toBeNull();
  expect(q("pp-done")).not.toBeNull();
});

test("an unchanged address saves and closes as before", async () => {
  api.put.mockResolvedValueOnce({ data: { client: {}, email_change_pending: false } });
  const onClose = jest.fn();
  await act(async () => {
    root = createRoot(container);
    root.render(<PortalProfileModal client={CLIENT} onClose={onClose} onSaved={jest.fn()} />);
  });
  await flush();
  await act(async () => { q("pp-submit").click(); });
  await flush();
  expect(q("pp-email-pending")).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
});
