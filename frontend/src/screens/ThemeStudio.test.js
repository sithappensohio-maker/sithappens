import { pickThemeToEdit } from "./ThemeStudio";

// Regression for a real bug a user hit: Theme Studio always re-defaulted to
// the ACTIVE theme on every fresh load, silently switching away from
// whatever non-active theme the admin was actually editing. The theme's
// edits were never lost server-side — Save always round-trips through the
// real API — but the page looked like it had forgotten them, because a
// reload quietly swapped in a different theme's empty slots. Fixed by
// remembering the last-edited theme id and preferring it over the active
// one, as long as it still exists.

const THEMES = [
  { id: "classic", name: "Classic Sit Happens" },
  { id: "halloween", name: "Halloween" },
  { id: "christmas", name: "Christmas" },
];

test("prefers the remembered theme over the active one", () => {
  const picked = pickThemeToEdit({ list: THEMES, rememberedId: "halloween", activeThemeId: "classic" });
  expect(picked.id).toBe("halloween");
});

test("falls back to the active theme when nothing is remembered", () => {
  const picked = pickThemeToEdit({ list: THEMES, rememberedId: null, activeThemeId: "christmas" });
  expect(picked.id).toBe("christmas");
});

test("falls back to the active theme when the remembered one no longer exists", () => {
  const picked = pickThemeToEdit({ list: THEMES, rememberedId: "deleted-theme-id", activeThemeId: "classic" });
  expect(picked.id).toBe("classic");
});

test("falls back to the first theme when nothing is remembered or active", () => {
  const picked = pickThemeToEdit({ list: THEMES, rememberedId: null, activeThemeId: null });
  expect(picked.id).toBe("classic");
});

test("returns null for an empty list rather than throwing", () => {
  const picked = pickThemeToEdit({ list: [], rememberedId: "halloween", activeThemeId: "classic" });
  expect(picked).toBeNull();
});
