/**
 * Theme decoration assets — the derivative a slot requests must match
 * where it's actually drawn. sectionHeaderBackground (the Shop/Photography
 * page header) is a full-bleed background the same way heroBackground/
 * eventBanner/loginBackground are, not a small fixed-size tile — it just
 * never got bumped to "pdp" (900px) when those did, so it stayed on "card"
 * (400px) and read as visibly blurry stretched across a full page width
 * (owner, 2026-10-18: "still isnt right its blurry").
 */
import { THEME_ASSET_SLOT_CONFIG, themeAssetUrl, themeAssetLayeredValue } from "./theme";

test("full-bleed background slots all request the same, larger derivative", () => {
  for (const slot of ["heroBackground", "eventBanner", "loginBackground", "sectionHeaderBackground"]) {
    expect(THEME_ASSET_SLOT_CONFIG[slot].size).toBe("pdp");
  }
});

test("small fixed-size slots stay on the smaller derivative", () => {
  for (const slot of ["sidebarAccentTop", "sidebarAccentBottom", "dashboardCardOverlay", "cornerSticker"]) {
    expect(THEME_ASSET_SLOT_CONFIG[slot].size).toBe("card");
  }
});

test("themeAssetUrl points at the configured size, not a hardcoded one", () => {
  const url = themeAssetUrl("asset-1", THEME_ASSET_SLOT_CONFIG.sectionHeaderBackground.size);
  expect(url).toMatch(/\/theme-assets\/asset-1\/pdp$/);
});

test("the layered CSS value still carries the directional scrim ahead of the image", () => {
  const value = themeAssetLayeredValue("sectionHeaderBackground", "asset-1", THEME_ASSET_SLOT_CONFIG.sectionHeaderBackground.size);
  expect(value.startsWith("var(--theme-decoration-scrim-directional), url(")).toBe(true);
  expect(value).toContain("/theme-assets/asset-1/pdp");
});
