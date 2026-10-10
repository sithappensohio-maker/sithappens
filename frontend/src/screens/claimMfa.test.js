/**
 * The password-reset page asks for the authenticator code when the account
 * has two-step sign-in (audit #6) — mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

// get/post are mocked for this test's own direct axios calls; create is the
// REAL axios.create so lib/api.js (now pulled in transitively via
// NeonEdge -> lib/theme -> lib/api, since NeonEdge reads theme context for
// the Card Frame asset) gets a real, fully-featured instance to attach its
// interceptors to — it never actually fires a request during this test.
jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { get: jest.fn(), post: jest.fn(), create: actual.create };
});
jest.mock("../components/PublicBrandShell", () => ({
  __esModule: true,
  default: ({ children, title }) => <div data-testid="shell"><h1>{title}</h1>{children}</div>,
}));

const axios = require("axios");
const Claim = require("./Claim").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  axios.get.mockReset(); axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { token: "t", user: {} } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
const type = async (id, value) => {
  const el = q(id);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const submit = async () => {
  await act(async () => { q("claim-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
};

async function open(info) {
  axios.get.mockResolvedValue({ data: { valid: true, is_reset: true, email: "owner@example.com", ...info } });
  act(() => root.render(<Claim token="tok-1" />));
  await flush();
}

test("an account with two-step sign-in is asked for its code, and the code is sent", async () => {
  await open({ is_client: false, mfa_required: true });
  expect(q("claim-mfa")).toBeTruthy();
  await type("claim-password-input", "new-password-456");
  await type("claim-confirm-input", "new-password-456");
  await submit();
  expect(axios.post).not.toHaveBeenCalled();
  expect(q("claim-error").textContent).toMatch(/authenticator/i);
  await type("claim-mfa-input", "123456");
  await submit();
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining("/claim/tok-1"),
                                          { password: "new-password-456", mfa_code: "123456" });
});

test("a client link for an account with two-step sign-in offers no passwordless way in", async () => {
  await open({ is_client: true, mfa_required: true });
  expect(q("claim-continue-passwordless")).toBeFalsy();
  expect(q("claim-back-to-passwordless")).toBeFalsy();
  expect(q("claim-mfa")).toBeTruthy();
});

test("an account without two-step sign-in resets exactly as before", async () => {
  await open({ is_client: false, mfa_required: false });
  expect(q("claim-mfa")).toBeFalsy();
  await type("claim-password-input", "new-password-456");
  await type("claim-confirm-input", "new-password-456");
  await submit();
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining("/claim/tok-1"), { password: "new-password-456" });
});

test("a validation error shows as a sentence and never crashes the page", async () => {
  await open({ is_client: false, mfa_required: true });
  axios.post.mockRejectedValue({ response: { status: 422, data: { detail: [{ msg: "String should have at most 32 characters" }] } } });
  await type("claim-password-input", "new-password-456");
  await type("claim-confirm-input", "new-password-456");
  await type("claim-mfa-input", "123456");
  await submit();
  expect(q("claim-error").textContent).toMatch(/at most 32 characters/);
  expect(q("claim-form")).toBeTruthy();
  expect(q("claim-mfa-input").maxLength).toBe(32);
});

test("if the server asks for a code the page did not expect, the code box appears", async () => {
  await open({ is_client: false, mfa_required: false });
  axios.post.mockRejectedValue({ response: { status: 401, data: { detail: "This account uses two-step sign-in. Enter the 6-digit code." } } });
  await type("claim-password-input", "new-password-456");
  await type("claim-confirm-input", "new-password-456");
  await submit();
  expect(q("claim-error").textContent).toMatch(/two-step/);
  expect(q("claim-mfa")).toBeTruthy();
});
