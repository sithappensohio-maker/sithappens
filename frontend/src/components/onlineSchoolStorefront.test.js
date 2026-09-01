// Online School storefront — the rich landing on the Shop's Online School
// tab. Unit tests for the honesty thresholds plus source-level regression
// guards (repo convention) for the wiring.
//
// The feature's hard rule: NOTHING is fabricated. Stats, stars, and quotes
// come from /public/school/storefront and the catalog; anything missing or
// under threshold renders as nothing.
import fs from "fs";
import path from "path";
import { dogsTrainedLabel, ratingSummary, programRating, courseCardChips, RATING_MIN_COUNT } from "../lib/schoolStorefront";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const storefrontSrc = read("OnlineSchoolStorefront.jsx");
const portalShopSrc = read("PortalShop.jsx");
const publicShopSrc = read("..", "screens", "PublicShop.jsx");
const studioSrc = read("ProgramStudio.jsx");
const adminFeedbackSrc = read("school", "SchoolExperienceFeedbackAdmin.jsx");
const serverSrc = read("..", "..", "..", "backend", "server.py");
const feedbackSrc = read("..", "..", "..", "backend", "school_experience_feedback.py");

// ---------------------------------------------------------------------------
// 1. Honesty thresholds — real unit tests, these are the no-fake-data rules
// ---------------------------------------------------------------------------

test("dogs-trained hides below 10 and always rounds DOWN to an N+ claim", () => {
  expect(dogsTrainedLabel(0)).toBeNull();
  expect(dogsTrainedLabel(9)).toBeNull();
  expect(dogsTrainedLabel(10)).toBe("10+");
  expect(dogsTrainedLabel(249)).toBe("240+");
  expect(dogsTrainedLabel(undefined)).toBeNull();
});

test("a rating never shows until enough people have rated", () => {
  expect(ratingSummary({ average_rating: 5, rating_count: RATING_MIN_COUNT - 1 })).toBeNull();
  expect(ratingSummary({ average_rating: 4.9, rating_count: 7 })).toEqual({ average: 4.9, count: 7 });
  expect(ratingSummary(null)).toBeNull();
  expect(programRating({ p1: { average: 5, count: 2 } }, "p1")).toBeNull();
  expect(programRating({ p1: { average: 4.7, count: 12 } }, "p1")).toEqual({ average: 4.7, count: 12 });
  expect(programRating({}, "missing")).toBeNull();
});

test("card chips derive only from real fields — nothing invents a chip", () => {
  expect(courseCardChips({})).toEqual([]);
  expect(courseCardChips({ module_count: 3, lesson_count: 8, estimated_weeks: 6, min_age_months: 2 }))
    .toEqual(["3 modules · 8 lessons", "~6 weeks", "2+ months"]);
  expect(courseCardChips({ module_count: 1, lesson_count: 1 })).toEqual(["1 module · 1 lesson"]);
});

// ---------------------------------------------------------------------------
// 2. Storefront component — populate-when-real wiring
// ---------------------------------------------------------------------------

test("every dynamic section is conditional: stats chips, testimonials, per-card stars, free CTAs", () => {
  expect(storefrontSrc).toMatch(/\{dogsLabel && <StatChip/);
  expect(storefrontSrc).toMatch(/\{overall && <StatChip/);
  expect(storefrontSrc).toMatch(/\{testimonials\.length > 0 && \(/);
  expect(storefrontSrc).toMatch(/\{rating && <Stars/);
  expect(storefrontSrc).toMatch(/\{freeItem && \(/);
});

test("an empty catalog shows the check-back-soon state, not placeholder courses", () => {
  expect(storefrontSrc).toMatch(/items\.length === 0/);
  expect(storefrontSrc).toMatch(/New courses are being prepared — check back soon\./);
});

test("cards have ONE action — open the detail route — so purchase/claim gating is never duplicated", () => {
  expect(storefrontSrc).toMatch(/onOpenDetail\(item\)/);
  expect(storefrontSrc).not.toMatch(/addToCart|onAdd\b/);
});

test("PortalShop routes the Online School tab to the storefront, and a live search still wins", () => {
  expect(portalShopSrc).toMatch(/const onlineSchoolLanding = tab === "online_school" && !searching/);
  expect(portalShopSrc).toMatch(/onlineSchoolLanding && \(\s*<OnlineSchoolStorefront/);
  expect(portalShopSrc).toMatch(/!onlineSchoolLanding && showIndexScreen/);
  expect(portalShopSrc).toMatch(/!onlineSchoolLanding && !showIndexScreen/);
});

test("guests don't get two stacked heroes — PublicShop keeps its hero, the embedded storefront drops its own", () => {
  expect(portalShopSrc).toMatch(/showHero=\{mode !== "guest"\}/);
  expect(publicShopSrc).toMatch(/public-online-school-hero/);
});

test("the public hero upgrades its pills to REAL stat chips only when thresholds clear", () => {
  expect(publicShopSrc).toMatch(/dogsTrainedLabel\(schoolStats\?\.dogs_trained\)/);
  expect(publicShopSrc).toMatch(/if \(!dogs && !rating\)/);
  expect(publicShopSrc).toMatch(/public-school-stat-dogs/);
});

// ---------------------------------------------------------------------------
// 3. Authoring + curation surfaces
// ---------------------------------------------------------------------------

test("Program Studio authors the storefront card bullets (helps_with) beside welcome outcomes", () => {
  expect(studioSrc).toMatch(/data-testid="prog-helps-with"/);
  expect(studioSrc).toMatch(/helps_with: e\.target\.value\.split\("\\n"\)/);
});

test("admin can feature only permission-granted quotes, and the button says where the quote goes", () => {
  expect(adminFeedbackSrc).toMatch(/r\.testimonial_permission && r\.liked_most && \(/);
  expect(adminFeedbackSrc).toMatch(/school-client-feedback-feature-/);
  expect(adminFeedbackSrc).toMatch(/appears on the public Online School page/);
});

test("Shop Manager's section editor includes online_school, so its cover image/label are actually settable", () => {
  const shopManagerSrc = read("..", "screens", "ShopManager.jsx");
  expect(shopManagerSrc).toMatch(/SHOP_SETTINGS_SECTION_KEYS = \["merch", "prepaid_visits", "training", "online_school"\]/);
});

// ---------------------------------------------------------------------------
// 4. Backend contract
// ---------------------------------------------------------------------------

test("public program items now carry card fields plus the discriminators whose absence emptied the public tab", () => {
  const allowlist = serverSrc.slice(serverSrc.indexOf("_PUBLIC_FIELDS_PROGRAM = {"), serverSrc.indexOf("_PUBLIC_SECTION_FLAG_FOR_SECTION"));
  for (const f of ["helps_with", "welcome_outcomes", "module_count", "lesson_count", "purchase_fulfillment", "free_claim_available"]) {
    expect(allowlist).toContain(`"${f}"`);
  }
});

test("catalog derives counts server-side so the storefront never needs curriculum names", () => {
  expect(serverSrc).toMatch(/"module_count": len\(prog\.get\("modules"\) or \[\]\)/);
  expect(serverSrc).toMatch(/"lesson_count": sum\(len\(_effective_lessons\(m\)\)/);
});

test("testimonials publish only with BOTH client permission and admin featuring, first-name only", () => {
  expect(feedbackSrc).toMatch(/\{"testimonial_permission": True, "storefront_featured": True\}/);
  expect(feedbackSrc).toMatch(/def _first_name/);
  expect(feedbackSrc).toMatch(/status_code=422, detail="This client has not given testimonial permission\."/);
  // The private improvement feedback never rides the public payload.
  const publicFn = feedbackSrc.slice(feedbackSrc.indexOf("async def public_school_storefront"));
  expect(publicFn).not.toMatch(/"improve"/);
});
