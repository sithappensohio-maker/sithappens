// A refused booking tells the client WHAT is stopping them and HOW to fix it.
//
// Drives the real portal and the real public Photo Specials page on a phone:
//  - a required agreement blocks a daycare booking at Confirm → the reason is
//    on screen next to Confirm, with an "Open agreements" button that closes
//    the wizard and takes them to the agreement;
//  - a portrait time taken by someone else while the form is open → back to
//    fresh times with the reason shown there, never "AxiosError: … 409".
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");

const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

async function adminToken(request) {
  const r = await request.post(`${H.API}/auth/login`, { data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).token;
}

/** A weekday a few days out, as YYYY-MM-DD in local time. */
function weekdayAhead(minDays) {
  const d = new Date();
  d.setDate(d.getDate() + minDays);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test.describe("booking refusals explain themselves", () => {
  test("an unsigned agreement: the reason sits by Confirm and its button opens the agreement", async ({ page, request }, testInfo) => {
    const admin = { Authorization: `Bearer ${await adminToken(request)}` };
    const stamp = Date.now().toString(36);
    const title = `Daycare Rules ${testInfo.project.name} ${stamp}`;
    const tplRes = await request.post(`${H.API}/admin/agreement-templates`, { headers: admin, data: {
      name: `e2e-daycare-rules-${stamp}`, title, body: "Play nicely.", scope_type: "service_type", scope_value: "daycare", required: true,
    } });
    expect(tplRes.ok(), await tplRes.text()).toBeTruthy();
    const tpl = await tplRes.json();
    // The e2e seed has no service catalog; add the daycare service being booked.
    const svcRes = await request.post(`${H.API}/services`, { headers: admin, data: {
      name: `Daycare E2E ${stamp}`, service_type: "daycare", base_price: 35, active: true,
    } });
    expect(svcRes.ok(), await svcRes.text()).toBeTruthy();
    const svc = await svcRes.json();
    try {
      const client = H.clientFor(testInfo, 13);
      const token = await H.loginInBrowser(page, request, client);
      // Finish the portal's own setup (emergency contact) so the wizard opens.
      const me = await request.put(`${H.API}/portal/me`, { headers: { Authorization: `Bearer ${token}` }, data: {
        name: `E2E Client ${client.index}`, phone: "5555550100", email: client.email, emerg: "Pat 555-0100",
      } });
      expect(me.ok(), await me.text()).toBeTruthy();

      // This shared test client can earn a trophy from another spec's training;
      // its celebration covers the page until tapped, exactly as for a real client.
      await page.addLocatorHandler(page.getByTestId("trophy-celebration"), async () => {
        await page.getByTestId("trophy-celebration-dismiss").click();
      });
      await page.goto("/");
      const book = page.getByTestId("portal-book-button");
      await expect(book).toBeVisible({ timeout: 45_000 });
      await book.click();
      await expect(page.getByTestId("portal-book-wizard")).toBeVisible();
      await page.getByTestId("wiz-cat-daycare").click();
      await page.getByTestId(`wiz-svc-${svc.id}-select`).click();
      await page.getByTestId("wiz-step1-next").click();
      await page.getByTestId("wiz-date").fill(weekdayAhead(4));
      await expect(page.getByTestId("wiz-daycare-availability")).toBeVisible();
      await page.getByTestId("wiz-step2-next").click();
      await page.getByTestId("wiz-confirm").click();

      const notice = page.getByTestId("wiz-error");
      await expect(notice).toContainText(`Please sign ${title}`);
      await expect(notice).toHaveAttribute("data-block-code", "agreement_unsigned");
      await expect(notice).toBeInViewport();
      await H.snap(page, "booking-block-agreement");
      await page.getByTestId("wiz-error-fix").click();
      await expect(page.getByTestId("portal-book-wizard")).toHaveCount(0);
      await expect(page.getByTestId("portal-agreements-card")).toBeInViewport({ timeout: 10_000 });
      await expect(page.getByTestId("portal-agreements-card")).toContainText(title);
    } finally {
      await request.delete(`${H.API}/services/${svc.id}`, { headers: admin });
      await request.put(`${H.API}/admin/agreement-templates/${tpl.id}`, { headers: admin, data: {
        name: tpl.name, title: tpl.title, body: tpl.body, scope_type: "service_type", scope_value: "daycare", required: false, active: false,
      } });
    }
  });

  test("a portrait time taken while the form is open: back to fresh times, reason shown", async ({ page, request }, testInfo) => {
    const admin = { Authorization: `Bearer ${await adminToken(request)}` };
    const date = weekdayAhead(testInfo.project.name === "phone-320" ? 75 : 70);
    const r = await request.post(`${H.API}/admin/photo-specials`, { headers: admin, data: {
      name: `Taken Slot E2E ${testInfo.project.name}-${Date.now()}`, headline: "Portraits", description: "A portrait.",
      location_name: "Sit Happens", dates: [date], start_time: "10:00", end_time: "11:00", slot_minutes: 15,
      booking_open: true, published: true,
    } });
    expect(r.ok(), await r.text()).toBeTruthy();
    const special = await r.json();

    await page.goto(`/photo-specials/${special.slug}`);
    await page.getByTestId(`photo-special-date-${date}`).click();
    await page.getByTestId("photo-special-slot-10:00").click();
    await expect(page.getByTestId("photo-special-details-hint")).toContainText(/first name/);
    await page.getByTestId("photo-special-first-name").fill("Amy");
    await page.getByTestId("photo-special-phone").fill("614-555-0199");
    await page.getByTestId("photo-special-email").fill(`e2e.taken.${Date.now()}@example.com`);
    await page.getByTestId("photo-special-dog-name").fill("Luna");
    await expect(page.getByTestId("photo-special-details-hint")).toHaveCount(0);
    await page.getByTestId("photo-special-to-review").click();

    // Somebody else books 10:00 first.
    const other = await request.post(`${H.API}/public/photo-specials/${special.slug}/reserve`, { data: {
      date, time: "10:00", first_name: "Other", email: `e2e.other.${Date.now()}@example.com`, phone: "614-555-0100", dog_name: "Rex",
    } });
    expect(other.ok(), await other.text()).toBeTruthy();

    await page.getByTestId("photo-special-reserve").click();
    const timeStep = page.getByTestId("photo-special-step-time");
    await expect(timeStep.getByTestId("photo-special-error")).toContainText("That time has just been taken");
    await expect(page.locator("body")).not.toContainText("AxiosError");
    await expect(page.getByTestId("photo-special-slot-10:00")).toBeDisabled();
    await H.snap(page, "booking-block-photo-taken");
    // Pick another time: their details are still filled in.
    await page.getByTestId("photo-special-slot-10:15").click();
    await expect(page.getByTestId("photo-special-first-name")).toHaveValue("Amy");
  });
});
