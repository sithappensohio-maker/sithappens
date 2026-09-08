// Settings → Public Website edits what the logged-out website shows.
// Admin login uses the operator account the disposable backend seeds from backend/.env.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");
const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

test("admin edits the hero headline and service area; the public homepage shows them", async ({ page, request, browser }) => {
  const login = await request.post(`${H.API}/auth/login`, { data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const j = await login.json();
  await page.addInitScript(({ t, u }) => {
    localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
    localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
  }, { t: j.token, u: j.user || { role: "admin", email: env.ADMIN_EMAIL } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // Settings deep link: /admin/settings/<section> opens that subsection directly.
  await page.goto("/admin/settings/public_site");
  const panel = page.getByTestId("public-website-panel");
  await expect(panel, errors.join(" | ")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("public-website-phone")).toHaveValue(/\(330\) 978-5575/);
  await H.snap(page, "32-settings-public-website");

  const headline = `Calm dogs, happy people. ${Date.now() % 1000}`;
  await page.getByTestId("public-website-hero_headline").fill(headline);
  await page.getByTestId("public-website-service_area").fill("Trumbull County");
  await page.getByTestId("public-website-save").click();
  await expect.poll(async () => (await (await request.get(`${H.API}/public/site`)).json()).site.hero_headline, { timeout: 10_000 }).toBe(headline);

  // A guest (a fresh browser context, no token) now sees the new words on the homepage.
  const guestCtx = await browser.newContext({ viewport: page.viewportSize() });
  const guest = await guestCtx.newPage();
  await guest.addInitScript(() => { try { localStorage.setItem("sh_install_dismissed_at", String(Date.now())); } catch {} });
  await guest.goto("/");
  await expect(guest.getByTestId("public-home")).toBeVisible();
  await expect(guest.getByTestId("site-hero-headline")).toHaveText(headline);
  await expect(guest.getByTestId("site-hero-facts")).toContainText("Trumbull County");
  await H.snap(guest, "33-public-home-after-settings");
  await guestCtx.close();

  // Put the seed values back so other specs keep their assertions.
  await request.put(`${H.API}/settings`, { headers: { Authorization: `Bearer ${j.token}` }, data: { public_site: {} } });
});
