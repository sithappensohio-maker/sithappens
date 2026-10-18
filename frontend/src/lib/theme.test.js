/**
 * Theme decoration assets — the derivative a slot requests must match
 * where it's actually drawn.
 *
 * heroBackground/eventBanner/loginBackground are full-bleed backgrounds
 * at "pdp" (900px), not small fixed-size tiles — sectionHeaderBackground
 * (the Shop/Photography page header) is too, but its own upload panel
 * (ThemeStudio.jsx) tells the admin to supply a 1600×300 image, so "pdp"
 * alone still undersampled it. It gets the one size bigger than its
 * full-bleed siblings — "zoom" (1600px) — matching that stated native
 * resolution exactly rather than guessing (owner, 2026-10-18: "still
 * isnt right its blurry").
 */
import { THEME_ASSET_SLOT_CONFIG, themeAssetUrl, themeAssetLayeredValue } from "./theme";

test("full-bleed background slots all request at least the larger derivative", () => {
  for (const slot of ["heroBackground", "eventBanner", "loginBackground"]) {
    expect(THEME_ASSET_SLOT_CONFIG[slot].size).toBe("pdp");
  }
});

test("sectionHeaderBackground requests its own stated 1600px native resolution", () => {
  expect(THEME_ASSET_SLOT_CONFIG.sectionHeaderBackground.size).toBe("zoom");
});

test("small fixed-size slots stay on the smaller derivative", () => {
  for (const slot of ["sidebarAccentTop", "sidebarAccentBottom", "dashboardCardOverlay", "cornerSticker"]) {
    expect(THEME_ASSET_SLOT_CONFIG[slot].size).toBe("card");
  }
});

test("themeAssetUrl points at the configured size, not a hardcoded one", () => {
  const url = themeAssetUrl("asset-1", THEME_ASSET_SLOT_CONFIG.sectionHeaderBackground.size);
  expect(url).toMatch(/\/theme-assets\/asset-1\/zoom$/);
});

test("the layered CSS value still carries the directional scrim ahead of the image", () => {
  const value = themeAssetLayeredValue("sectionHeaderBackground", "asset-1", THEME_ASSET_SLOT_CONFIG.sectionHeaderBackground.size);
  expect(value.startsWith("var(--theme-decoration-scrim-directional), url(")).toBe(true);
  expect(value).toContain("/theme-assets/asset-1/zoom");
});
