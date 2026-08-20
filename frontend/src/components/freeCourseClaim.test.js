// Free Online School course claim — client coverage.
//
// The eligibility/CTA/intent logic is pure, so it is tested BEHAVIOURALLY.
// The React wiring is pinned the way this repo does elsewhere. The whole flow
// was also exercised in a browser against the real imported teaser course.
//
// The invariant: a deliberately free course never enters the cart, and a $0
// program that is NOT explicitly free never looks claimable.
import fs from "fs";
import path from "path";
import {
  isFreeClaimable, freePriceLabel, freeCourseCta,
  rememberFreeClaimIntent, consumeFreeClaimIntent, clearFreeClaimIntent, FREE_CLAIM_INTENT_KEY,
} from "../lib/freeCourseClaim";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
/* Assertions about what the UI must NOT contain run against code with
   comments and user-facing strings removed. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const logicOnly = (src) => code(src).replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, "``");

const detailSrc = read("ShopItemDetail.jsx");
const shopSrc = read("PortalShop.jsx");
const studioSrc = read("ProgramStudio.jsx");
const libSrc = read("..", "lib", "freeCourseClaim.js");
const portalSrc = read("..", "screens", "Portal.jsx");
const completionSrc = read("school", "student", "CourseCompletionCard.jsx");

const FREE = { kind: "training_program", id: "prog-free", name: "FREE Mini Course: Sit & Down", price: 0, free_claim_available: true };
const UNPRICED = { ...FREE, id: "prog-draft", free_claim_available: false };
const PAID = { kind: "training_program", id: "prog-paid", name: "Level 1", price: 199, free_claim_available: false };

beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });

// ---------------------------------------------------------------------------
// Eligibility is the server's call, never inferred from price
// ---------------------------------------------------------------------------

test("only an explicitly free-enabled program is claimable", () => {
  expect(isFreeClaimable(FREE)).toBe(true);
  expect(isFreeClaimable(PAID)).toBe(false);
});

test("a $0 program that is NOT free-enabled is never treated as free", () => {
  // The whole point: imported drafts and unpriced programs also sit at $0.
  expect(UNPRICED.price).toBe(0);
  expect(isFreeClaimable(UNPRICED)).toBe(false);
  expect(freePriceLabel(UNPRICED)).toBeNull();
  expect(freeCourseCta({ item: UNPRICED, isGuest: false, dogs: [{ id: "d1" }], selectedDogId: "d1" })).toBeNull();
});

test("the client never decides eligibility from price on its own", () => {
  // No local price test may stand in for the server's computed flag.
  expect(logicOnly(libSrc)).not.toMatch(/price\s*===\s*0|price\s*<=\s*0|!item\.price/);
  expect(libSrc).toMatch(/item\.free_claim_available === true/);
});

test("non-programs are never claimable", () => {
  expect(isFreeClaimable({ kind: "product", free_claim_available: true })).toBe(false);
  expect(isFreeClaimable({ kind: "credit_pack", free_claim_available: true })).toBe(false);
  expect(isFreeClaimable(null)).toBe(false);
});

// ---------------------------------------------------------------------------
// FREE badge, and no $0 checkout CTA anywhere
// ---------------------------------------------------------------------------

test("a claimable course shows FREE rather than $0.00", () => {
  expect(freePriceLabel(FREE)).toBe("FREE");
  expect(detailSrc).toMatch(/data-testid="shop-detail-free-price"/);
  expect(shopSrc).toMatch(/data-testid=\{`shop-free-badge-\$\{item\.id\}`\}/);
});

test("a free course never renders a cart or checkout CTA", () => {
  // The grid card opens the detail view; the detail view claims. Neither
  // reaches addToCart for a free course.
  const gridStart = shopSrc.indexOf("isFreeClaimable(item) ? (");
  const grid = shopSrc.slice(gridStart, shopSrc.indexOf("isShopifyMerch ? (", gridStart));
  expect(grid).toMatch(/Start Free Course/);
  expect(grid).not.toMatch(/onAdd\(|addToCart/);
  const detailBranch = detailSrc.slice(detailSrc.indexOf("{freeClaim ? (() => {"), detailSrc.indexOf(") : isShopifyMerch ? ("));
  expect(detailBranch).not.toMatch(/onAddToCart|handlePurchase/);
  expect(detailBranch).toMatch(/onClaimFreeCourse/);
});

test("the free branch is evaluated BEFORE every purchase CTA", () => {
  // Otherwise a free course could fall through to a $0 checkout.
  const freeIdx = detailSrc.indexOf("{freeClaim ? (() => {");
  expect(freeIdx).toBeGreaterThan(-1);
  expect(freeIdx).toBeLessThan(detailSrc.indexOf("isShopifyMerch ? ("));
  expect(freeIdx).toBeLessThan(detailSrc.indexOf('data-testid="shop-detail-purchase"'));
});

test("the claim posts to its own endpoint, never to checkout", () => {
  expect(shopSrc).toMatch(/api\.post\("\/shop\/free-course\/claim"/);
  const handler = shopSrc.slice(shopSrc.indexOf("const claimFreeCourse"), shopSrc.indexOf("const claimFreeCourse") + 800);
  expect(handler).not.toMatch(/shop\/checkout|idempotency_key|stripe/i);
});

// ---------------------------------------------------------------------------
// Logged-out continuation
// ---------------------------------------------------------------------------

test("a logged-out visitor gets a sign-in CTA, not a claim", () => {
  expect(freeCourseCta({ item: FREE, isGuest: true }).type).toBe("sign_in");
  expect(freeCourseCta({ item: FREE, isGuest: true }).label).toBe("Start Free Course");
});

test("the guest CTA remembers the intent and uses the existing account flow", () => {
  expect(rememberFreeClaimIntent(FREE)).toBe(true);
  expect(JSON.parse(sessionStorage.getItem(FREE_CLAIM_INTENT_KEY)).program_id).toBe("prog-free");
  // routed through onRequireAccount — the existing sign-in/create-account
  // path, never a second authentication system
  expect(detailSrc).toMatch(/rememberFreeClaimIntent\(item\); onRequireAccount\?\.\(item, "free_course"\)/);
  expect(logicOnly(shopSrc + detailSrc)).not.toMatch(/signIn\(|createAccount\(|api\.post\("\/auth\//);
});

test("an intent is consumed exactly once", () => {
  rememberFreeClaimIntent(FREE);
  expect(consumeFreeClaimIntent().program_id).toBe("prog-free");
  expect(consumeFreeClaimIntent()).toBeNull();   // a second read must not re-trigger a claim
});

test("a non-claimable item never stores an intent", () => {
  expect(rememberFreeClaimIntent(UNPRICED)).toBe(false);
  expect(rememberFreeClaimIntent(PAID)).toBe(false);
  expect(sessionStorage.getItem(FREE_CLAIM_INTENT_KEY)).toBeNull();
});

test("a corrupt intent is discarded rather than thrown", () => {
  sessionStorage.setItem(FREE_CLAIM_INTENT_KEY, "{not json");
  expect(consumeFreeClaimIntent()).toBeNull();
  sessionStorage.setItem(FREE_CLAIM_INTENT_KEY, JSON.stringify({ nope: 1 }));
  expect(consumeFreeClaimIntent()).toBeNull();
  clearFreeClaimIntent();
});

test("Portal resumes the intent after authentication", () => {
  expect(portalSrc).toMatch(/const intent = consumeFreeClaimIntent\(\)/);
  expect(portalSrc).toMatch(/\/shop\/item\/training_program\/\$\{encodeURIComponent\(intent\.program_id\)\}/);
});

// ---------------------------------------------------------------------------
// Dog selection
// ---------------------------------------------------------------------------

test("one dog gets a confirmation naming that dog", () => {
  const cta = freeCourseCta({ item: FREE, isGuest: false, dogs: [{ id: "d1", name: "Bella" }], selectedDogId: "d1" });
  expect(cta.type).toBe("claim");
  expect(cta.label).toBe("Start this course with Bella");
});

test("multiple dogs must pick one before claiming", () => {
  const dogs = [{ id: "d1", name: "Bella" }, { id: "d2", name: "Rex" }];
  expect(freeCourseCta({ item: FREE, isGuest: false, dogs, selectedDogId: null }).type).toBe("choose_dog");
  expect(freeCourseCta({ item: FREE, isGuest: false, dogs, selectedDogId: "d2" }).label).toBe("Start this course with Rex");
});

test("no dog routes into the real add-dog workflow, never a placeholder", () => {
  const cta = freeCourseCta({ item: FREE, isGuest: false, dogs: [], selectedDogId: null });
  expect(cta.type).toBe("add_dog");
  expect(detailSrc).toMatch(/data-testid="shop-detail-free-add-dog"/);
  expect(detailSrc).toMatch(/onClick=\{\(\) => onAddDog\?\.\(\)\}/);
  expect(portalSrc).toMatch(/onAddDog=\{\(\) => \{ setShopOpen\(false\); setDogModal\(\{ open: true, dog: null \}\); \}\}/);
  // nothing anywhere fabricates a dog to get past the requirement
  expect(logicOnly(libSrc + detailSrc)).not.toMatch(/placeholder.?dog|createDog\(|dog_id:\s*""/i);
});

// ---------------------------------------------------------------------------
// Already enrolled → Continue, never a duplicate claim
// ---------------------------------------------------------------------------

test("an active enrollment offers Continue rather than a second claim", () => {
  const cta = freeCourseCta({
    item: FREE, isGuest: false, dogs: [{ id: "d1", name: "Bella" }], selectedDogId: "d1",
    enrollments: [{ dog_id: "d1", program_id: "prog-free", status: "active" }],
  });
  expect(cta.type).toBe("continue");
  expect(cta.label).toBe("Continue Free Course");
});

test("a completed or withdrawn enrollment never offers a fresh claim", () => {
  const base = { item: FREE, isGuest: false, dogs: [{ id: "d1" }], selectedDogId: "d1" };
  expect(freeCourseCta({ ...base, enrollments: [{ dog_id: "d1", program_id: "prog-free", status: "completed" }] }).type).toBe("completed");
  expect(freeCourseCta({ ...base, enrollments: [{ dog_id: "d1", program_id: "prog-free", status: "withdrawn" }] }).type).toBe("blocked");
});

test("another dog's enrollment does not block this dog", () => {
  const cta = freeCourseCta({
    item: FREE, isGuest: false, dogs: [{ id: "d1", name: "Bella" }, { id: "d2", name: "Rex" }], selectedDogId: "d2",
    enrollments: [{ dog_id: "d1", program_id: "prog-free", status: "active" }],
  });
  expect(cta.type).toBe("claim");
});

test("an enrollment in a DIFFERENT program does not block this one", () => {
  const cta = freeCourseCta({
    item: FREE, isGuest: false, dogs: [{ id: "d1", name: "Bella" }], selectedDogId: "d1",
    enrollments: [{ dog_id: "d1", program_id: "some-other-program", status: "active" }],
  });
  expect(cta.type).toBe("claim");
});

test("a double click cannot fire two claims", () => {
  expect(shopSrc).toMatch(/if \(claiming\) return;/);
  expect(shopSrc).toMatch(/setClaiming\(true\)/);
});

// ---------------------------------------------------------------------------
// Success state → School, never a $0 receipt
// ---------------------------------------------------------------------------

test("a successful claim lands in School, not in a receipt", () => {
  expect(shopSrc).toMatch(/data-testid="free-course-success"/);
  expect(shopSrc).toMatch(/data-testid="free-course-start-lesson"/);
  expect(shopSrc).toMatch(/onGoToOnlineSchool\?\.\(\)/);
  const success = shopSrc.slice(shopSrc.indexOf('data-testid="free-course-success"'), shopSrc.indexOf('data-testid="free-course-back-to-shop"'));
  expect(success).not.toMatch(/receipt|\$0|order number|total/i);
  expect(success).toMatch(/You're in!/);
});

test("a converged claim says so rather than pretending it just happened", () => {
  expect(shopSrc).toMatch(/freeClaim\.created \? "You're in!" : "Already yours"/);
});

// ---------------------------------------------------------------------------
// Paid programs unchanged
// ---------------------------------------------------------------------------

test("a paid program keeps its existing purchase CTA untouched", () => {
  expect(freeCourseCta({ item: PAID, isGuest: false, dogs: [{ id: "d1" }], selectedDogId: "d1" })).toBeNull();
  expect(detailSrc).toMatch(/data-testid="shop-detail-purchase"/);
  expect(detailSrc).toMatch(/Buy Course/);
  expect(shopSrc).toMatch(/data-testid=\{`shop-buy-\$\{item\.kind\}-\$\{item\.id\}`\}/);
});

test("the checkout path is not referenced by any free-course code", () => {
  expect(logicOnly(libSrc)).not.toMatch(/checkout|cart/i);
});

// ---------------------------------------------------------------------------
// Staff configuration
// ---------------------------------------------------------------------------

test("Program Studio exposes free enrollment as an explicit opt-in", () => {
  expect(studioSrc).toMatch(/data-testid="prog-free-enrollment-enabled"/);
  expect(studioSrc).toMatch(/Free client enrollment/);
  expect(studioSrc).toMatch(/Allow clients to start this program without payment/);
  expect(studioSrc).toMatch(/set\(\{ free_enrollment_enabled: e\.target\.checked \}\)/);
});

test("the toggle is only selectable for an Online School-capable program", () => {
  expect(studioSrc).toMatch(/const canBeFree = program\.purchase_fulfillment === "online_school" && canOnlineSchool/);
  expect(studioSrc).toMatch(/disabled=\{!canBeFree \|\| priced\}/);
  expect(studioSrc).toMatch(/data-testid="prog-free-enrollment-needs-school"/);
});

test("Program Studio distinguishes FREE from price not configured", () => {
  // The distinction that matters: $0 + opt-in is free; $0 without it is
  // simply unpriced, and staff must be able to tell at a glance.
  expect(studioSrc).toMatch(/data-testid="prog-free-enrollment-state"/);
  expect(studioSrc).toMatch(/clients can start this course themselves without paying/);
  expect(studioSrc).toMatch(/Price not configured — \$0 but NOT claimable/);
});

// ---------------------------------------------------------------------------
// Course completion → next step, via the existing mechanism
// ---------------------------------------------------------------------------

test("the next-step card uses the existing program recommendation mechanism", () => {
  // No new field, no second resolver, and no hardcoded program id in React.
  expect(completionSrc).toMatch(/home\?\.program\?\.recommended_next_programs/);
  expect(libSrc).not.toMatch(/export function recommendedNextProgram/);
  expect(logicOnly(completionSrc)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
});
