// Photo Specials — a member of the public books a portrait session on a phone.
//
// The whole point of this feature is that somebody who is not a client, on a
// phone, can reserve a fifteen-minute slot without help. So this runs at the
// two phone sizes the suite already uses and drives the real page end to end:
// pick a date, pick a time, fill in the short form, reserve, and check the
// slot is actually gone afterwards.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");

const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function adminToken(request) {
  const r = await request.post(`${H.API}/auth/login`, {
    data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).token;
}

/** Each run gets its own special on its own dates, so parallel projects never
 *  compete for the same portrait slot. */
async function makeSpecial(request, label) {
  const token = await adminToken(request);
  const d1 = day(60 + label);
  const r = await request.post(`${H.API}/admin/photo-specials`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: `Howl-O-Ween Portraits E2E ${label}-${Date.now()}`,
      headline: "Professional portraits — not cell-phone snapshots",
      description: "A proper studio portrait of your dog.",
      location_name: "Sit Happens",
      what_to_expect: ["Fifteen minutes, one dog"],
      packages_blurb: "Packages are shown at your session.",
      arrival_notes: "Arrive five minutes early.",
      cancellation_notes: "Call us to move your time.",
      dates: [d1],
      start_time: "10:00", end_time: "11:00", slot_minutes: 15,
      booking_open: true, published: true,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return { special: await r.json(), date: d1, token };
}

test.describe("photo specials — public booking", () => {
  test("a stranger books a portrait slot on a phone, and the slot then disappears", async ({ page, request }, testInfo) => {
    const { special, date } = await makeSpecial(request, testInfo.project.name === "phone-320" ? 2 : 1);

    await page.goto(`/photo-specials/${special.slug}`);

    // The page sells the session before it asks for anything.
    await expect(page.getByTestId("photo-special-hero")).toContainText(/professional/i);
    await expect(page.getByTestId("photo-special-facts")).toContainText("15 min per dog");

    // Nothing may scroll sideways on a phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // 1 — date
    await page.getByTestId(`photo-special-date-${date}`).click();

    // 2 — time. Every slot must be a comfortable tap target.
    const slot = page.getByTestId("photo-special-slot-10:30");
    await expect(slot).toBeVisible();
    const box = await slot.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    await slot.click();

    // 3 — details
    const stamp = `${Date.now()}${testInfo.project.name}`;
    await page.getByTestId("photo-special-first-name").fill("Amy");
    await page.getByTestId("photo-special-last-name").fill("Brown");
    await page.getByTestId("photo-special-phone").fill("614-555-0199");
    await page.getByTestId("photo-special-email").fill(`e2e.portrait.${stamp}@example.com`);
    await page.getByTestId("photo-special-dog-name").fill("Luna");
    await page.getByTestId("photo-special-breed").fill("Husky");
    await page.getByTestId("photo-special-dog-notes").fill("Nervous around strangers");
    await page.getByTestId("photo-special-to-review").click();

    // 4 — review, then reserve
    await expect(page.getByTestId("photo-special-step-review")).toContainText("10:30 AM");
    await expect(page.getByTestId("photo-special-step-review")).toContainText(/pay at your session/i);
    await page.getByTestId("photo-special-reserve").click();

    // Confirmation leads with when.
    const when = page.getByTestId("photo-special-when");
    await expect(when).toBeVisible({ timeout: 15000 });
    await expect(when).toContainText("10:30 AM");
    await expect(when).toContainText(/luna/i);
    await expect(page.getByTestId("photo-special-confirmed")).toContainText(/pay at your session/i);
    await expect(page.getByTestId("photo-special-arrival")).toBeVisible();

    // The slot is genuinely gone for the next visitor.
    const avail = await request.get(`${H.API}/public/photo-specials/${special.slug}/availability?date=${date}`);
    const body = await avail.json();
    const taken = body.slots.find((s) => s.time === "10:30");
    expect(taken.available).toBe(false);
    // and the public feed still says nothing about who took it
    expect(JSON.stringify(body)).not.toContain("Luna");
    expect(JSON.stringify(body)).not.toContain("Amy");
  });

  test("a closed special says so instead of showing an empty grid", async ({ page, request }, testInfo) => {
    const { special, token } = await makeSpecial(request, testInfo.project.name === "phone-320" ? 12 : 11);
    await request.put(`${H.API}/admin/photo-specials/${special.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { ...special, booking_open: false },
    });
    await page.goto(`/photo-specials/${special.slug}`);
    await expect(page.getByTestId("photo-special-closed")).toContainText(/booking closed/i);
    await expect(page.getByTestId("photo-special-slots")).toHaveCount(0);
  });
});
