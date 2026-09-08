// Public "Tell us about your dog" questionnaire, end to end: landing page →
// saved inquiry → Action Required → Inquiries screen → marked contacted.
// Admin login uses the operator account the disposable backend seeds from backend/.env.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");
const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

test("contact questionnaire: landing page → Inquiries → contacted", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-inquiry-card")).toBeVisible();
  await page.getByTestId("landing-hero-inquiry-cta").click();
  await expect(page.getByTestId("contact-inquiry-modal")).toBeVisible();
  await H.snap(page, "27-inquiry-01-form");
  await page.getByTestId("ci-name").fill("Probe Person");
  await page.getByTestId("ci-phone").fill("614-555-0142");
  await page.getByTestId("ci-email").fill("probe.person@example.com");
  await page.getByTestId("ci-dog-name").fill("Waffles");
  await page.getByTestId("ci-breed").fill("Golden mix");
  await page.getByTestId("ci-age").fill("5 months");
  await page.getByTestId("ci-interest-daycare").click();
  await page.getByTestId("ci-interest-not_sure").click();
  await page.getByTestId("ci-concern-leash_pulling").click();
  await page.getByTestId("ci-message").fill("Sweet but pulls like a freight train.");
  await page.getByTestId("ci-more-toggle").click();
  await page.getByTestId("ci-start-asap").click();
  await page.getByTestId("ci-zip").fill("43201");
  await H.snap(page, "27-inquiry-01b-form-filled");
  await page.getByTestId("contact-inquiry-submit").click();
  await expect(page.getByTestId("contact-inquiry-success")).toBeVisible();
  await H.snap(page, "27-inquiry-02-success");

  // Admin side, via the API first.
  const login = await request.post(`${H.API}/auth/login`, { data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const j = await login.json();
  const auth = { Authorization: `Bearer ${j.token}` };
  const inq = await request.get(`${H.API}/inquiries?status=new`, { headers: auth });
  expect(inq.ok(), await inq.text()).toBeTruthy();
  const mine = (await inq.json()).items.find((i) => i.email === "probe.person@example.com");
  expect(mine).toBeTruthy();
  const pa = await request.get(`${H.API}/admin/pending-actions`, { headers: auth });
  expect((await pa.json()).items.some((a) => a.type === "contact_inquiry" && a.dog_name === "Waffles")).toBeTruthy();
  const counts = await (await request.get(`${H.API}/admin/pending-actions/count`, { headers: auth })).json();
  expect(counts.contact_inquiries).toBeGreaterThanOrEqual(1);

  // Admin UI: Action Required card, then the Inquiries screen.
  await page.addInitScript(({ t, u }) => {
    localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
    localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
  }, { t: j.token, u: j.user || { role: "admin", email: env.ADMIN_EMAIL } });
  await page.goto("/");
  await page.waitForTimeout(2500);
  await H.snap(page, "27-inquiry-03-admin-home");
  const burger = page.locator("header button").first(); await burger.click(); await page.waitForTimeout(400);
  const navBtn = page.getByRole("button", { name: /Inquiries/ }).filter({ visible: true }).first();
  await navBtn.scrollIntoViewIfNeeded(); await navBtn.click();
  await expect(page).toHaveURL(/\/admin\/inquiries$/);
  await expect(page.getByTestId("inquiries-screen")).toBeVisible();
  await expect(page.getByTestId(`inquiry-${mine.id}`)).toBeVisible();
  await H.snap(page, "27-inquiry-04-admin-inquiries");
  await page.getByTestId(`inquiry-${mine.id}-mark-contacted`).click();
  await expect(page.getByTestId(`inquiry-${mine.id}`)).toHaveCount(0); // leaves the New list
  await page.getByTestId("inquiries-filter-contacted").click();
  await expect(page.getByTestId(`inquiry-${mine.id}-status`)).toContainText(/contacted/i);
  await H.snap(page, "27-inquiry-05-admin-contacted");
});
