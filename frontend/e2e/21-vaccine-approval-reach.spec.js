// "N vaccine uploads awaiting approval" must lead to an Approve button.
//
// A client uploads a certificate; the owner sees the alert in Today's
// "Do This Now". Open used to navigate to the page it was already on (a dead
// button) and the dog's own page had no way to approve. Now: Open scrolls to
// the Vaccine Reviews box, and the dog's Vaccines tab can approve too.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");

const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test.use({ viewport: { width: 1440, height: 900 } });

test("the vaccine alert's Open reaches Approve, and the dog page can approve too", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "phone-320", "desktop owner flow; runs once");
  // A client uploads two certificates for their dog.
  const client = H.clientFor(testInfo, 12);
  const ctoken = await H.apiLogin(request, client);
  const ch = { Authorization: `Bearer ${ctoken}` };
  const dogs = await (await request.get(`${H.API}/dogs`, { headers: ch })).json();
  const dog = dogs[0];
  expect(dog, "seed client has a dog").toBeTruthy();
  for (const [vaccine, expires_on] of [["rabies", "2031-03-01"], ["dhpp", "2031-04-01"]]) {
    const r = await request.post(`${H.API}/portal/dogs/${dog.id}/vaccine-update`, { headers: ch, data: { vaccine, expires_on, photos: [PNG] } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }

  const login = await request.post(`${H.API}/auth/login`, { data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const j = await login.json();
  await page.addInitScript(({ t, u }) => {
    localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
    localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
  }, { t: j.token, u: j.user || { role: "admin", email: env.ADMIN_EMAIL } });

  // 1. Today → Do This Now → Open lands on the review box with Approve buttons.
  await page.goto("/admin/today");
  const row = page.locator('[data-testid^="action-center-row-vax-upload-review"]');
  await expect(row).toBeVisible({ timeout: 45_000 });
  await row.getByRole("button", { name: /open/i }).last().click();
  const box = page.getByTestId("today-pending-vax-reviews");
  await expect(box).toBeInViewport({ timeout: 10_000 });
  await expect(box).toContainText(dog.name);
  await H.snap(page, "vax-open-lands-on-reviews");

  // 2. The dog's own page shows the uploads and approves one.
  await page.goto(`/admin/dogs/${dog.id}`);
  await expect(page.getByTestId("dog-pending-vax-banner")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("dog-pending-vax-banner").click();
  await expect(page.getByTestId("dog-pending-vax-rabies")).toBeVisible();
  await H.snap(page, "vax-dog-page-approve");
  await page.getByTestId("dog-pending-vax-approve-rabies").click();
  await expect(page.getByTestId("dog-pending-vax-rabies")).toHaveCount(0);
  // The form now shows the approved date, so saving the dog can't undo it.
  await expect(page.getByTestId("dog-rabies-input")).toHaveValue("2031-03-01");

  // The approval really landed on the dog.
  const full = await (await request.get(`${H.API}/dogs/${dog.id}`, { headers: { Authorization: `Bearer ${j.token}` } })).json();
  expect(full.vaccines.rabies).toBe("2031-03-01");
});
