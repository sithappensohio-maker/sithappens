// A daycare dog still checked in from yesterday: checkout asks "forgotten
// checkout or stayed the night?" and never decides on its own.
//
// The seed (e2e_school_seed.build_late_daycare) leaves one such visit per
// project, checked in yesterday and never checked out.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");

const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const seed = JSON.parse(fs.readFileSync("e2e/.seed.json", "utf8"));

test.use({ viewport: { width: 1440, height: 900 } });

test("checking out yesterday's daycare dog asks first, and the answer can be changed", async ({ page, request }, testInfo) => {
  const late = seed.late_daycare[testInfo.project.name];
  const login = await request.post(`${H.API}/auth/login`, { data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const j = await login.json();
  const admin = { Authorization: `Bearer ${j.token}` };
  // The e2e database has no catalogue: one daycare and one boarding service.
  const made = [];
  for (const [service_type, base_price] of [["daycare", 40], ["boarding", 60]]) {
    const r = await request.post(`${H.API}/services`, { headers: admin, data: {
      name: `Late ${service_type} ${testInfo.project.name}`, service_type, base_price, active: true } });
    expect(r.ok(), await r.text()).toBeTruthy();
    made.push(await r.json());
  }
  try {
    await page.addInitScript(({ t, u }) => {
      localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
      localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
    }, { t: j.token, u: j.user || { role: "admin", email: env.ADMIN_EMAIL } });

    await page.goto("/admin/today");
    const checkout = page.getByTestId(`today-checkout-${late.booking_id}`);
    await expect(checkout).toBeVisible({ timeout: 45_000 });
    await checkout.click();

    // 1. The question comes first — no checkout form, nothing priced.
    const question = page.getByTestId("checkout-late-day");
    await expect(question).toBeVisible();
    await expect(page.getByTestId("checkout-late-day-message")).toContainText(late.dog_name);
    await expect(page.getByTestId("checkout-late-day-stayed")).toContainText(/1 night/);
    await expect(page.getByTestId("checkout-modal")).toHaveCount(0);
    await H.snap(page, `late-day-question-${testInfo.project.name}`);

    // 2. Stayed the night → the checkout opens as boarding, with the answer shown.
    await page.getByTestId("checkout-late-day-stayed").click();
    await expect(page.getByTestId("checkout-modal")).toBeVisible();
    await expect(page.getByTestId("checkout-modal")).toContainText(/boarding/i);
    await expect(page.getByTestId("checkout-late-day-banner")).toContainText(/Stayed the night/);
    await H.snap(page, `late-day-stayed-${testInfo.project.name}`);

    // 3. Change answer → asked again; Forgotten checkout keeps it daycare.
    await page.getByTestId("checkout-late-day-change").click();
    await expect(question).toBeVisible();
    await page.getByTestId("checkout-late-day-forgotten").click();
    await expect(page.getByTestId("checkout-late-day-banner")).toContainText(/Forgotten checkout/);
    await expect(page.getByTestId("checkout-modal")).toContainText(/daycare/i);

    const row = await (await request.get(`${H.API}/bookings/${late.booking_id}`, { headers: admin })).json();
    expect(row.service_type).toBe("daycare");
    expect(row.late_day_resolution).toBe("forgotten");
  } finally {
    await request.post(`${H.API}/bookings/${late.booking_id}/late-day-checkout`, { headers: admin, data: { resolution: "undo" } });
    for (const s of made) await request.delete(`${H.API}/services/${s.id}`, { headers: admin });
  }
});
