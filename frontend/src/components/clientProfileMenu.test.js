/**
 * The client account menu (Logout / Install App / How to Use).
 *
 * Found while making the client guide: on a phone the open menu was painted
 * BEHIND the home cards, so Logout could not be seen or tapped, and a tap
 * outside the menu did not close it (its full-screen close layer sat inside
 * the header, which traps fixed-position children).
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "fs";
import path from "path";
import ClientProfileMenu from "./ClientProfileMenu";

jest.mock("./InstallAppButton", () => () => null);
global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(props = {}) {
  const outside = document.createElement("button");
  outside.setAttribute("data-testid", "a-home-card");
  document.body.appendChild(outside);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onLogout = jest.fn();
  act(() => { root.render(<ClientProfileMenu name="Sample Family" showHelp onHelp={() => {}} onLogout={onLogout} {...props} />); });
  const q = (id) => document.querySelector(`[data-testid="${id}"]`);
  const fire = (el, type, init = {}) => act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init })); });
  return { q, fire, outside, onLogout, done: () => { act(() => root.unmount()); host.remove(); outside.remove(); } };
}

describe("client account menu", () => {
  test("opens, and a tap anywhere outside closes it", () => {
    const m = mount();
    expect(m.q("client-profile-menu")).toBeNull();
    m.fire(m.q("client-profile-menu-button"), "click");
    expect(m.q("client-profile-menu")).not.toBeNull();
    // A tap inside the menu must not close it before the button acts.
    m.fire(m.q("logout-button"), "pointerdown");
    expect(m.q("client-profile-menu")).not.toBeNull();
    m.fire(m.outside, "pointerdown");
    expect(m.q("client-profile-menu")).toBeNull();
    m.done();
  });

  test("Escape closes it, and Logout still logs out", () => {
    const m = mount();
    m.fire(m.q("client-profile-menu-button"), "click");
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(m.q("client-profile-menu")).toBeNull();
    m.fire(m.q("client-profile-menu-button"), "click");
    m.fire(m.q("logout-button"), "click");
    expect(m.onLogout).toHaveBeenCalledTimes(1);
    expect(m.q("client-profile-menu")).toBeNull();
    m.done();
  });

  test("the header it drops out of sits above the page (the menu was hidden behind the home cards)", () => {
    // Layering cannot be measured in jsdom, so this pins the one class that fixes it;
    // the real check was done in a phone-sized browser.
    const src = fs.readFileSync(path.join(__dirname, "..", "screens", "Portal.jsx"), "utf8");
    const header = src.match(/<header className="([^"]*sh-theme-hero-client[^"]*)"/);
    expect(header).not.toBeNull();
    expect(header[1]).toMatch(/\brelative\b/);
    expect(header[1]).toMatch(/\bz-30\b/);
  });
});
