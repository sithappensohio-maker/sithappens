/**
 * Shop image URLs and galleries.
 *
 * The rule these protect: a surface must request the derivative it is
 * actually drawing. A 44-pixel row asking for the 1600px file is how the
 * Shop ended up downloading 3.12 MB to draw a postage stamp.
 */
import {
  SHOP_IMAGE_SIZES, shopImageUrl, shopImageSrcSet, shopImageProps,
  galleryIds, primaryImageId,
} from "./shopImage";

test("every surface has a size, and they are ordered smallest to largest", () => {
  expect(Object.keys(SHOP_IMAGE_SIZES)).toEqual(["thumb", "card", "pdp", "zoom"]);
  const px = Object.values(SHOP_IMAGE_SIZES);
  expect([...px].sort((a, b) => a - b)).toEqual(px);
});

test("a url points at the derivative, never the whole original", () => {
  expect(shopImageUrl("m1", "card")).toMatch(/\/shop\/media\/m1\/card$/);
  expect(shopImageUrl("m1", "thumb")).toMatch(/\/thumb$/);
});

test("a guest gets the public route", () => {
  expect(shopImageUrl("m1", "card", { public: true })).toMatch(/\/public\/shop\/media\/m1\/card$/);
  expect(shopImageUrl("m1", "card")).not.toMatch(/\/public\//);
});

test("no image means no url, so nothing requests a broken asset", () => {
  expect(shopImageUrl(null)).toBeNull();
  expect(shopImageUrl("")).toBeNull();
  expect(shopImageProps(null, "card")).toBeNull();
});

test("an id with awkward characters is encoded rather than pasted into a path", () => {
  expect(shopImageUrl("../../etc/passwd", "card")).toContain("..%2F..%2Fetc%2Fpasswd");
  expect(shopImageUrl("a b", "card")).toContain("a%20b");
});

test("an unknown size falls back to card instead of building a broken url", () => {
  expect(shopImageUrl("m1", "enormous")).toMatch(/\/card$/);
});

test("a card offers the browser the small files, never the zoom file", () => {
  // The whole defect in one assertion.
  const set = shopImageSrcSet("m1", ["thumb", "card"]);
  expect(set).toContain("128w");
  expect(set).toContain("400w");
  expect(set).not.toContain("1600w");
});

test("a list row asks for the smallest file", () => {
  expect(shopImageProps("m1", "thumb").src).toMatch(/\/thumb$/);
});

test("a cart line uses a thumbnail, not a product-page image", () => {
  const p = shopImageProps("m1", "thumb");
  expect(p.src).toMatch(/\/thumb$/);
  expect(p.src).not.toMatch(/\/(pdp|zoom)$/);
});

test("the product page hero is eager, because it is the largest paint", () => {
  // Lazy-loading the hero makes the page measurably slower to feel ready.
  const p = shopImageProps("m1", "pdp");
  expect(p.loading).toBe("eager");
  expect(p.fetchPriority).toBe("high");
  expect(p.src).toMatch(/\/pdp$/);
});

test("everything else is lazy", () => {
  for (const surface of ["thumb", "card"]) {
    expect(shopImageProps("m1", surface).loading).toBe("lazy");
  }
});

test("the zoom file is only ever requested by the zoom surface", () => {
  for (const surface of ["thumb", "card", "pdp"]) {
    const p = shopImageProps("m1", surface);
    expect(p.src).not.toMatch(/\/zoom$/);
    expect(p.srcSet || "").not.toContain("/zoom");
  }
  expect(shopImageProps("m1", "zoom").src).toMatch(/\/zoom$/);
});

test("every surface tells the browser how wide the image will be", () => {
  for (const surface of ["thumb", "card", "pdp", "zoom"]) {
    expect(shopImageProps("m1", surface).sizes).toBeTruthy();
  }
});

// ────────────────────────────────────────────────────────── galleries

test("a legacy one-image product reads as a one-image gallery", () => {
  // The compatibility promise: nothing to migrate, nothing to redo.
  expect(galleryIds({ image_id: "a" })).toEqual(["a"]);
  expect(primaryImageId({ image_id: "a" })).toBe("a");
});

test("a product with no image is an empty gallery, not a broken one", () => {
  expect(galleryIds({})).toEqual([]);
  expect(galleryIds(null)).toEqual([]);
  expect(primaryImageId({})).toBeNull();
});

test("a gallery keeps the order the admin chose", () => {
  expect(galleryIds({ image_ids: ["c", "a", "b"] })).toEqual(["c", "a", "b"]);
  expect(primaryImageId({ image_ids: ["c", "a", "b"] })).toBe("c");
});

test("the gallery wins over a stale primary field", () => {
  expect(galleryIds({ image_ids: ["x"], image_id: "old" })).toEqual(["x"]);
});

test("the same image twice shows once", () => {
  expect(galleryIds({ image_ids: ["a", "b", "a"] })).toEqual(["a", "b"]);
});

test("the frontend and the server agree on what a gallery is", () => {
  // Both read image_ids first and fall back to image_id — if these ever
  // drift, the page shows a different primary image than the receipt does.
  const cases = [
    { image_ids: ["a", "b"], image_id: "a" },
    { image_id: "solo" },
    {},
  ];
  const expected = [["a", "b"], ["solo"], []];
  cases.forEach((c, i) => expect(galleryIds(c)).toEqual(expected[i]));
});
