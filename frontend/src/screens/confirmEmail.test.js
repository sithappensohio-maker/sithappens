/**
 * The emailed link confirms a new address once, under StrictMode's double effect (audit #27).
 * A second request would find the link used and show an error after success. Mounted.
 */
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import ConfirmEmail from "./ConfirmEmail";

jest.mock("axios", () => ({ post: jest.fn() }));
jest.mock("../components/PublicBrandShell", () => ({ children, title }) => (
  <div data-testid="shell"><h1>{title}</h1>{children}</div>
));
jest.mock("../components/premium", () => ({
  PremiumButton: ({ children, ...rest }) => <button {...rest}>{children}</button>,
  SectionCard: ({ children }) => <section>{children}</section>,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  axios.post.mockReset();
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("the link is sent once under StrictMode and the new address is confirmed", async () => {
  axios.post.mockResolvedValueOnce({ data: { ok: true, email: "new@example.com" } });
  await act(async () => {
    root = createRoot(container);
    root.render(<StrictMode><ConfirmEmail token="tok-abcdefghijk" /></StrictMode>);
  });
  await flush();
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1]).toEqual({ token: "tok-abcdefghijk" });
  expect(q("confirm-email-done").textContent).toContain("new@example.com");
  expect(q("confirm-email-invalid")).toBeNull();
});

test("an expired or used link says so and changes nothing", async () => {
  axios.post.mockRejectedValueOnce({ response: { data: { detail: "This confirmation link has expired. Change your email again." } } });
  await act(async () => {
    root = createRoot(container);
    root.render(<ConfirmEmail token="tok-abcdefghijk" />);
  });
  await flush();
  expect(q("confirm-email-error").textContent).toBe("This confirmation link has expired. Change your email again.");
  expect(q("confirm-email-done")).toBeNull();
});

test("a link with no code is refused without a request", async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<ConfirmEmail token="" />);
  });
  await flush();
  expect(axios.post).not.toHaveBeenCalled();
  expect(q("confirm-email-error").textContent).toContain("missing its code");
});
