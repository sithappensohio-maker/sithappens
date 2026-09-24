// Schedule → Day Roster quick-add: extra household dogs + add-ons.
//
// An admin opens a day on the Schedule calendar, picks a dog whose owner has
// more than one dog, adds the sibling, ticks an add-on for each dog, and
// saves. Both dogs must land as one group booking carrying their add-ons.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");

const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

test.use({ viewport: { width: 1440, height: 900 } });

test("day roster quick-add books a second household dog with per-dog add-ons", async ({ page, request }) => {
  const login = await request.post(`${H.API}/auth/login`, { data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const j = await login.json();
  const headers = { Authorization: `Bearer ${j.token}` };

  // Household with two dogs: clone an existing dog (vaccines included) onto the same owner.
  const dogs = await (await request.get(`${H.API}/dogs`, { headers })).json();
  const primary = dogs.find((d) => d.owner_id);
  expect(primary, "seed has a dog with an owner").toBeTruthy();
  const stamp = Date.now().toString(36);
  const sibRes = await request.post(`${H.API}/dogs`, { headers, data: {
    owner_id: primary.owner_id, name: `Sibling ${stamp}`, breed: "Beagle", vaccines: primary.vaccines || {},
  } });
  expect(sibRes.ok(), await sibRes.text()).toBeTruthy();
  const sibling = await sibRes.json();

  const addonRes = await request.post(`${H.API}/services`, { headers, data: {
    name: `Nail Trim ${stamp}`, base_price: 15, is_addon: true, addon_for: ["daycare"], active: true,
  } });
  expect(addonRes.ok(), await addonRes.text()).toBeTruthy();
  const addon = await addonRes.json();

  await page.addInitScript(({ t, u }) => {
    localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
    localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
  }, { t: j.token, u: j.user || { role: "admin", email: env.ADMIN_EMAIL } });

  // A weekday later this month (falls back to today near month end) keeps the cell on the visible grid.
  const now = new Date();
  const d = new Date(now);
  for (let i = 1; i <= 6; i++) {
    const c = new Date(now); c.setDate(now.getDate() + i);
    if (c.getMonth() !== now.getMonth()) break;
    if (c.getDay() !== 0 && c.getDay() !== 6) { d.setTime(c.getTime()); break; }
  }
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  await page.goto("/admin/schedule");
  const cell = page.locator(`td.fc-daygrid-day[data-date="${iso}"]`);
  await expect(cell).toBeVisible({ timeout: 45_000 });
  await cell.click({ position: { x: 20, y: 60 } });
  await page.getByTestId("day-roster-new-btn").click();

  await page.getByTestId("day-roster-dog-select").selectOption(primary.id);
  // Add-ons for the first dog.
  await page.getByTestId(`day-roster-addon-${addon.id}`).click();
  // Sibling row appears only for multi-dog households.
  await expect(page.getByTestId("day-roster-multidog")).toBeVisible();
  await page.getByTestId("day-roster-add-dog").click();
  await page.getByTestId("day-roster-extra-dog-select-0").selectOption(sibling.id);
  await page.getByTestId(`day-roster-extra-addon-0-${addon.id}`).click();
  await expect(page.getByTestId("day-roster-group-count")).toContainText("2 dogs");
  await H.snap(page, "day-roster-multidog-form");

  await expect(page.getByTestId("day-roster-save-btn")).toHaveText(/Add 2 appointments/i);
  await page.getByTestId("day-roster-save-btn").click();
  await expect(page.getByTestId("day-roster-new-form")).toBeHidden({ timeout: 20_000 });

  const all = await (await request.get(`${H.API}/bookings`, { headers })).json();
  const rows = (Array.isArray(all) ? all : all.items || []).filter((b) => b.date === iso && [primary.id, sibling.id].includes(b.dog_id));
  expect(rows.length, JSON.stringify(rows)).toBe(2);
  expect(rows[0].group_id).toBeTruthy();
  expect(rows[0].group_id).toBe(rows[1].group_id);
  for (const b of rows) expect(JSON.stringify(b), `add-on on ${b.dog_id}`).toContain(addon.id);
});
