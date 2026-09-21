// Sit Happens Online School Phase 5 — Shop/POS commerce source-level
// regression guards, matching this repo's established convention (see
// onlineSchoolEntryPoints.test.js's docstring): no React Testing Library
// rendering — behaviors are verified by asserting the source contains the
// exact pattern that implements them. Live interaction is verified in the
// browser as part of the release report.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const detailSrc = read("ShopItemDetail.jsx");
const shopSrc = read("PortalShop.jsx");
const portalSrc = read("..", "screens", "Portal.jsx");
const programStudioSrc = read("ProgramStudio.jsx");

// ---------------------------------------------------------------------------
// ShopItemDetail — dog selection + real ownership state, never guessed
// ---------------------------------------------------------------------------

test("online_school detail state is gated on the program's real purchase_fulfillment field", () => {
  expect(detailSrc).toMatch(/item\?\.kind === "training_program" && item\.purchase_fulfillment === "online_school"/);
});

test("dog ownership state is fetched from the real portal/school endpoint, never invented client-side", () => {
  expect(detailSrc).toMatch(/api\.get\("\/portal\/school"\)/);
  expect(detailSrc).toMatch(/schoolEnrollments\.find\(\(e\) => e\.dog_id === selectedDogId && e\.program_id === itemId\)/);
});

test("a single-dog client gets a convenience default, but selection is real client state, not guessed for multi-dog clients", () => {
  expect(detailSrc).toMatch(/setSelectedDogId\(dogs\.length === 1 \? dogs\[0\]\.id : null\)/);
});

test("all three CTA states are real branches, not a repeated Buy button", () => {
  expect(detailSrc).toMatch(/Buy Course/);
  expect(detailSrc).toMatch(/Go to Online School/);
  expect(detailSrc).toMatch(/View Completed Course/);
  expect(detailSrc).toMatch(/selectedDogEnrollment\?\.status === "completed"/);
  expect(detailSrc).toMatch(/selectedDogEnrollment\?\.status === "active"/);
});

test("purchase is blocked until a dog is actually chosen", () => {
  expect(detailSrc).toMatch(/!selectedDogId \? \(/);
  expect(detailSrc).toMatch(/Choose a Dog to Continue/);
});

test("handlePurchase threads the selected dog into the cart line for online_school programs", () => {
  expect(detailSrc).toMatch(/if \(isOnlineSchoolProgram\) \{\s*\n\s*onAddToCart\(item, 1, selectedDogId\);/);
});

// ---------------------------------------------------------------------------
// PortalShop — cart/checkout dog-awareness, never collapsing two dogs'
// identical-program lines into one
// ---------------------------------------------------------------------------

// These two were pinned to the EXACT source line, which made them fail the
// moment gift-card recipients joined the same cart-line identity — even
// though the dog behaviour they protect was untouched and extended. Pinned
// to the rule instead of the punctuation: the identity must still consider
// the dog, and the checkout must still send it.

test("cart line identity is dog-aware so two dogs buying the same program stay separate lines", () => {
  const sameLine = shopSrc.match(/const sameLine = \(c\) =>[\s\S]{0,240}?;/);
  expect(sameLine).toBeTruthy();
  expect(sameLine[0]).toMatch(/c\.dog_id === dogId/);
  expect(sameLine[0]).toMatch(/c\.kind === item\.kind/);
  expect(sameLine[0]).toMatch(/c\.ref_id === item\.id/);
});

test("changing a quantity or removing a line is dog-aware too", () => {
  // Otherwise a quantity change on one dog's course moves the other dog's.
  for (const fn of ["changeQty", "removeFromCart"]) {
    const at = shopSrc.indexOf(`const ${fn} = (`);
    expect(at).toBeGreaterThan(-1);
    const body = shopSrc.slice(at, at + 400);
    expect(body).toMatch(/dog_id === dogId/);
  }
});

test("checkout posts dog_id per line to the server", () => {
  const payload = shopSrc.match(/items: cart\.map\([\s\S]{0,400}?\)\),/);
  expect(payload).toBeTruthy();
  expect(payload[0]).toMatch(/kind: c\.kind/);
  expect(payload[0]).toMatch(/ref_id: c\.ref_id/);
  expect(payload[0]).toMatch(/quantity: c\.quantity/);
  expect(payload[0]).toMatch(/dog_id: c\.dog_id/);
});

test("PortalShop fetches only the authenticated client's own dogs, the same scoped endpoint used elsewhere in the portal", () => {
  expect(shopSrc).toMatch(/if \(mode !== "authenticated"\) return;\s*\n\s*api\.get\("\/dogs"\)/);
});

test("Portal.jsx wires Go-to-Online-School to close Shop and open the native School route, not a dead link", () => {
  expect(portalSrc).toMatch(/onGoToOnlineSchool=\{\(\) => \{ setShopOpen\(false\); openSchool\(\); \}\}/);
  expect(portalSrc).toMatch(/const openSchool = \(\) => \{ window\.history\.pushState\(\{\}, "", "\/school"\); setSchoolPath\("\/school"\); \}/);
});

// ---------------------------------------------------------------------------
// ProgramStudio — purchase_fulfillment authoring control
// ---------------------------------------------------------------------------

test("Program Studio exposes purchase_fulfillment as a control separate from Delivery Mode capability", () => {
  expect(programStudioSrc).toMatch(/purchase_fulfillment: "credits_only"/);
  expect(programStudioSrc).toMatch(/purchase_fulfillment: "online_school"/);
});

test("Online School fulfillment is disabled in the UI until Delivery Mode actually supports self-guided delivery", () => {
  expect(programStudioSrc).toMatch(/const canOnlineSchool = \["self_guided", "both"\]\.includes\(program\.delivery_mode \|\| "trainer_led"\);/);
  expect(programStudioSrc).toMatch(/disabled=\{!canOnlineSchool\}/);
});
