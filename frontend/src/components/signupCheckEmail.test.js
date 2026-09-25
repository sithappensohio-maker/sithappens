/**
 * Sign-up with an email that is already on file.
 *
 * The server no longer signs anyone in for that case: it emails a one-time
 * link to the address on file and answers { status: "check_email" }. These
 * mount the real AuthProvider with the real sign-up screens and prove:
 *   - no token is stored and nobody is signed in;
 *   - the shop modal stays open and says "check your email" (it used to
 *     close on any truthy result);
 *   - the landing/login card says the same and hides the form;
 *   - a brand-new email still signs in and closes exactly as before.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "../lib/auth";
import GuestAuthModal from "./GuestAuthModal";
import Login from "../screens/Login";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  clearSharedApiCache: jest.fn(),
  formatErr: (e) => String(e || ""),
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CHECK_EMAIL = {
  status: "check_email",
  email: "owner@example.com",
  message: "You're already in our system, so we've emailed a link to owner@example.com.",
};

let container, root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation(() => Promise.resolve({ data: [] }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const $ = (id) => container.querySelector(`[data-testid="${id}"]`);

function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(form) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function mount(ui) {
  await act(async () => { root.render(<AuthProvider>{ui}</AuthProvider>); });
}

async function fillGuestRegister() {
  await act(async () => { $("guest-auth-tab-register").click(); });
  act(() => {
    type($("guest-auth-name"), "Somebody");
    type($("guest-auth-email"), "owner@example.com");
    type($("guest-auth-password"), "long-enough-1");
  });
}

test("shop modal: an on-file email keeps the modal open, says check your email, stores no token", async () => {
  api.post.mockResolvedValue({ data: CHECK_EMAIL });
  const onClose = jest.fn();
  await mount(<GuestAuthModal open onClose={onClose} />);
  await fillGuestRegister();
  await submit($("guest-auth-submit").closest("form"));

  expect(api.post).toHaveBeenCalledWith("/auth/register", expect.objectContaining({ email: "owner@example.com" }));
  expect(onClose).not.toHaveBeenCalled();
  expect($("guest-auth-check-email").textContent).toContain("emailed a link to owner@example.com");
  expect($("guest-auth-submit").closest("form").hidden).toBe(true);
  expect(localStorage.getItem("sh_token")).toBeNull();
});

test("shop modal: a brand-new email still signs in and closes", async () => {
  api.post.mockResolvedValue({ data: { token: "tok-new", user: { id: "u1", email: "new@example.com", role: "client" } } });
  const onClose = jest.fn();
  await mount(<GuestAuthModal open onClose={onClose} />);
  await fillGuestRegister();
  await submit($("guest-auth-submit").closest("form"));

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("sh_token")).toBe("tok-new");
  expect($("guest-auth-check-email")).toBeNull();
});

test("shop modal: a refused sign-up still shows the error and stays open", async () => {
  api.post.mockRejectedValue({ response: { data: { detail: "Email already registered" } } });
  const onClose = jest.fn();
  await mount(<GuestAuthModal open onClose={onClose} />);
  await fillGuestRegister();
  await submit($("guest-auth-submit").closest("form"));

  expect(onClose).not.toHaveBeenCalled();
  expect($("guest-auth-error").textContent).toContain("Email already registered");
  expect($("guest-auth-check-email")).toBeNull();
});

test("login card: an on-file email shows the check-your-email notice and hides the form", async () => {
  api.post.mockResolvedValue({ data: CHECK_EMAIL });
  await mount(<Login focus />);
  await act(async () => { $("tab-register").click(); });
  act(() => {
    type($("register-name-input"), "Somebody");
    type($("login-email-input"), "owner@example.com");
    type($("login-password-input"), "long-enough-1");
  });
  await submit($("login-submit-button").closest("form"));

  expect($("register-check-email").textContent).toContain("emailed a link to owner@example.com");
  expect($("login-submit-button").closest("form").hidden).toBe(true);
  expect(localStorage.getItem("sh_token")).toBeNull();
  expect($("login-password-input").value).toBe("");

  // Switching tabs puts the ordinary form back.
  await act(async () => { $("tab-login").click(); });
  expect($("register-check-email")).toBeNull();
  expect($("login-submit-button").closest("form").hidden).toBe(false);
});
