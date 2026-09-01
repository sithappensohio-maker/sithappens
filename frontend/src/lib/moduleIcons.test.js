// Module icons — behavioural tests for the resolution order (upload beats
// pick beats derivation beats paw) and the content-derived matching.
import { moduleIconFor, moduleHue, MODULE_ICON_CHOICES, MODULE_HUES } from "./moduleIcons";

test("an admin's uploaded image always wins", () => {
  expect(moduleIconFor({ name: "Leash walking", icon: { kind: "image", image_id: "img-1" } }))
    .toEqual({ type: "image", imageId: "img-1" });
});

test("an admin-picked built-in beats derivation", () => {
  expect(moduleIconFor({ name: "Leash walking", icon: { kind: "builtin", builtin: "tricks" } }).key).toBe("tricks");
});

test("a broken builtin key falls through to derivation instead of rendering nothing", () => {
  expect(moduleIconFor({ name: "Leash walking", icon: { kind: "builtin", builtin: "not-a-key" } }).key).toBe("leash");
});

test("auto derivation reads what the module actually teaches", () => {
  expect(moduleIconFor({ name: "Getting Started" }).key).toBe("foundations");
  expect(moduleIconFor({ name: "Focus & Engagement" }).key).toBe("focus");
  expect(moduleIconFor({ name: "Everyday Manners", description: "Sit, down, and settle." }).key).toBe("manners");
  expect(moduleIconFor({ name: "Loose-Leash Walking" }).key).toBe("leash");
  expect(moduleIconFor({ name: "Rock-Solid Recall" }).key).toBe("recall");
  expect(moduleIconFor({ name: "Crate comfort", description: "Potty routine." }).key).toBe("home");
  expect(moduleIconFor({ name: "Out in Public", description: "Store outings." }).key).toBe("public");
});

test("the description is a signal too, not just the name", () => {
  expect(moduleIconFor({ name: "Week 3", description: "Building confidence around scary noises" }).key).toBe("confidence");
});

test("nothing matching still yields the paw — never a blank tile", () => {
  const icon = moduleIconFor({ name: "Miscellaneous" });
  expect(icon).toEqual({ type: "fa", key: "foundations", fa: "fa-paw" });
  expect(moduleIconFor(null).fa).toBe("fa-paw");
});

test("every choice uses a Font Awesome 6 free-solid name and unique key", () => {
  const keys = MODULE_ICON_CHOICES.map((c) => c.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const c of MODULE_ICON_CHOICES) expect(c.fa).toMatch(/^fa-[a-z-]+$/);
});

test("hues cycle by 1-based module position so any program length works", () => {
  expect(moduleHue(1).key).toBe("cyan");
  expect(moduleHue(2).key).toBe("lime");
  expect(moduleHue(3).key).toBe("orange");
  expect(moduleHue(4).key).toBe("purple");
  expect(moduleHue(5).key).toBe("cyan");
  expect(moduleHue(undefined).key).toBe(MODULE_HUES[0].key);
});
