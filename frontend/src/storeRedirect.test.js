/**
 * /store isn't a route anywhere in the app — "store" is the word a visitor
 * naturally guesses for the shop, but the real URL is /shop everywhere else
 * (item links, the cart, GuestOrderStatus). Before this, an unmatched
 * /store fell through to the generic catch-all Gate(), which for a guest
 * renders Login — not the storefront, with no clue why.
 *
 * Mounted with a real MemoryRouter + real Navigate, not a source-text match
 * (see feedback_source_pinned_tests_cannot_catch_crashes) — this proves the
 * redirect actually fires and actually preserves the rest of the URL,
 * not just that the word "store" appears in App.js somewhere.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { StoreRedirect } from "./App";

global.IS_REACT_ACT_ENVIRONMENT = true;

function ShopLanding() {
  const location = useLocation();
  return <div data-testid="landed-on">{location.pathname}{location.search}{location.hash}</div>;
}

function mountAt(initialPath) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/store/*" element={<StoreRedirect />} />
          <Route path="/shop/*" element={<ShopLanding />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  const text = host.querySelector('[data-testid="landed-on"]')?.textContent;
  act(() => { root.unmount(); });
  host.remove();
  return text;
}

test("bare /store lands on /shop", () => {
  expect(mountAt("/store")).toBe("/shop");
});

test("a deep link like /store/item/product/abc lands on the equivalent /shop URL", () => {
  expect(mountAt("/store/item/product/abc")).toBe("/shop/item/product/abc");
});

test("a query string survives the redirect", () => {
  expect(mountAt("/store?section=online_school")).toBe("/shop?section=online_school");
});
