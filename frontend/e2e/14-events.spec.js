// Public event preregistration end to end: a guest preregisters from the
// permanent URL with no account, a signed-in client is prefilled and picks
// their own dog without any record being duplicated, and staff run the door
// from the admin Events screen (totals, search, check-in + undo, walk-in,
// costume roster, CSV). Admin login uses the operator account the disposable
// backend seeds from backend/.env.
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const SLUG = "trunk-or-treat-2026";
const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // A full navigation aborts whatever the previous page still had in flight
  // (ERR_ABORTED); that is the browser moving on, not a failed request.
  page.on("requestfailed", (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || "")) errors.push(`requestfailed ${r.url()}`); });
  // The homepage's free-course card asks /public/shop/catalog, which the
  // disposable e2e database answers 404 (no storefront seeded). That is the
  // homepage's existing behaviour, not part of events — keep it out of the tally.
  const ignore = (url) => url.includes("/api/public/shop/catalog");
  // Vite's dev-only "Outdated Optimize Dep" 504 is the dev server re-bundling
  // a dependency mid-run (it retries by itself); it does not exist in a build.
  page.on("console", (m) => { if (m.type() === "error" && !/404|Outdated Optimize Dep/.test(m.text())) errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/") && !ignore(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  return errors;
}
async function noOverflow(page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(o.sw, `no horizontal overflow (${o.sw} > ${o.iw})`).toBeLessThanOrEqual(o.iw + 1);
}
async function adminToken(request) {
  const login = await request.post(`${H.API}/auth/login`, { data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  return login.json();
}
async function adminInBrowser(page, request) {
  const j = await adminToken(request);
  await page.addInitScript(({ t, u }) => {
    localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
    localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
  }, { t: j.token, u: j.user || { role: "admin", email: env.ADMIN_EMAIL } });
  return j.token;
}

test.describe("public event preregistration", () => {
  test("a logged-out visitor preregisters from the permanent URL and sees only their own confirmation", async ({ page, request }) => {
    const errors = watchErrors(page);
    const tag = `${Date.now()}-${test.info().project.name}`;
    await page.addInitScript(() => { try { localStorage.setItem("sh_install_dismissed_at", String(Date.now())); } catch {} });
    // From the homepage: the banner under the hero, and Events in the drawer.
    await page.goto("/");
    // first navigation of the run: the dev server may still be optimizing deps
    await expect(page.getByTestId("public-home")).toBeVisible({ timeout: 30_000 });
    const banner = page.getByTestId("site-event-banner");
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("site-event-banner-name")).toContainText(/trunk or treat/i);
    await expect(page.getByTestId("site-event-banner-when")).toContainText(/October 24, 2026/);
    await expect(page.getByTestId("site-event-banner-cta")).toHaveAttribute("href", `/events/${SLUG}`);
    // a strip at the very top: under the header, above the hero, on the first screen
    const bannerBox = await banner.boundingBox();
    const heroBox = await page.getByTestId("site-hero").boundingBox();
    expect(bannerBox.y).toBeLessThan(140);
    expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(heroBox.y + 1);
    await H.snap(page, "39-home-event-banner");
    await page.getByTestId("site-menu-toggle").click();
    const navEvents = page.getByTestId("site-drawer").getByTestId("site-nav-events");
    await expect(navEvents).toBeVisible();
    await expect(navEvents).toHaveAttribute("href", `/events/${SLUG}`);
    await navEvents.click();
    await expect(page).toHaveURL(new RegExp(`/events/${SLUG}$`));
    await expect(page.getByTestId("public-event")).toBeVisible();
    await expect(page.getByTestId("login-screen")).toHaveCount(0);
    // the /events index also lists it
    await page.goto("/events");
    await expect(page.getByTestId(`public-event-card-${SLUG}`)).toBeVisible();
    await page.getByTestId(`public-event-card-${SLUG}`).click();
    await expect(page.getByTestId("public-event")).toBeVisible();
    await expect(page.getByTestId("event-title")).toContainText(/trunk or treat/i);
    await expect(page.getByTestId("event-title")).toContainText(/costume contest/i);
    await expect(page.getByTestId("event-when")).toContainText(/October 24, 2026/);
    await expect(page.getByTestId("event-when")).toContainText(/2:00 PM/);
    await expect(page.getByTestId("event-admission")).toContainText(/free/i);
    await expect(page.getByTestId("event-where")).toContainText(/Sit Happens Dog Training/);
    for (const t of ["Doggy Trunk or Treat", "Dog Costume Contest", "Photo Booth", "Trick for a Treat", "Best Decorated Trunk", "Shop specials"]) {
      await expect(page.getByTestId("event-features")).toContainText(t);
    }
    await expect(page.getByTestId("event-rules")).toContainText(/retractable/i);
    expect((await page.locator("body").innerText()).toLowerCase()).not.toContain("adopt");
    await noOverflow(page);
    await H.snap(page, "40-event-hero");

    await page.getByTestId("event-hero-cta").click();
    await expect(page.getByTestId("event-form")).toBeVisible();
    await page.getByTestId("ev-name").fill(`Guest ${tag}`);
    await page.getByTestId("ev-email").fill(`guest-${tag}@example.com`);
    await page.getByTestId("ev-phone").fill("330-555-0142");
    await page.getByTestId("ev-adults-plus").click();      // 2 adults
    await page.getByTestId("ev-children-plus").click();    // 1 child
    await page.getByTestId("ev-dogs-plus").click();        // 2 dogs
    await page.getByTestId("ev-dog-0").fill("Waffles");
    await page.getByTestId("ev-dog-1").fill("Pickles");
    await page.getByTestId("ev-costume-yes").click();
    await page.getByTestId("ev-costume-enter-0").check();
    await page.getByTestId("ev-costume-theme-0").fill("Hot dog");
    await page.getByTestId("ev-costume-human-0-yes").click();
    await page.getByTestId("ev-heard-flyer").click();
    // the rules acknowledgment is required; marketing stays unticked unless chosen
    await expect(page.getByTestId("ev-marketing")).not.toBeChecked();
    await page.getByTestId("ev-rules").check();
    await noOverflow(page);
    await H.snap(page, "41-event-form-filled");
    const submit = page.getByTestId("event-submit");
    await H.expectNotCovered(page, submit, "preregister button");
    await submit.click();

    const conf = page.getByTestId("event-confirmation");
    await expect(conf).toBeVisible({ timeout: 15_000 });
    await expect(conf).toContainText(/you're registered/i);
    const number = (await page.getByTestId("event-confirmation-number").innerText()).trim();
    expect(number).toMatch(/^SH-TOT-\d{4}$/);
    await expect(page.getByTestId("event-confirmation-people")).toHaveText("3");
    await expect(page.getByTestId("event-confirmation-dogs")).toHaveText("2");
    await expect(page.getByTestId("event-confirmation-costume")).toContainText(/Contestant #\d{3}/);
    await expect(page.getByTestId("event-confirmation-costume")).toContainText("Waffles");
    // the card is brought to the top of the screen, not left where the form ended
    await expect.poll(async () => (await conf.boundingBox())?.y, { timeout: 5_000 }).toBeLessThan(200);
    await noOverflow(page);
    await H.snap(page, "42-event-confirmation");
    test.info().annotations.push({ type: "confirmation", description: number });

    // Nothing about anyone else is reachable without staff access.
    const pub = await (await request.get(`${H.API}/public/events/${SLUG}`)).json();
    expect(pub.event.registrations).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain(number);
    expect((await request.get(`${H.API}/admin/events`)).status()).toBe(401);
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("a signed-in client is prefilled, picks their own dog, and no client or dog record is duplicated", async ({ page, request }, testInfo) => {
    const errors = watchErrors(page);
    const client = H.clientFor(testInfo, 11);
    const token = await H.loginInBrowser(page, request, client);
    const api = H.apiFor(request, token);
    const dogsBefore = await api.get("/dogs");
    const myDogs = Array.isArray(dogsBefore) ? dogsBefore : dogsBefore.items || dogsBefore.dogs || [];
    expect(myDogs.length).toBeGreaterThan(0);

    // From the client portal Home: the event card
    await page.goto("/");
    const card = page.getByTestId("portal-upcoming-event");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("portal-upcoming-event-name")).toContainText(/trunk or treat/i);
    await card.scrollIntoViewIfNeeded();
    // The portal scrolls inside its own container, so a page shot can miss the
    // card: picture the card itself for the human report.
    if (process.env.E2E_SHOTS) {
      const vp = page.viewportSize() || {};
      fs.mkdirSync("e2e/results/shots", { recursive: true });
      await card.screenshot({ path: `e2e/results/shots/${vp.width}x${vp.height}-43a-portal-event-card.jpg`, type: "jpeg", quality: 80 });
    }
    await page.getByTestId("portal-upcoming-event-cta").click();
    await expect(page).toHaveURL(new RegExp(`/events/${SLUG}$`));
    await expect(page.getByTestId("public-event")).toBeVisible();
    await page.getByTestId("event-hero-cta").click();
    await expect(page.getByTestId("ev-email")).toHaveValue(client.email);
    await expect(page.getByTestId("ev-name")).not.toHaveValue("");
    const chip = page.getByTestId(`ev-existing-dog-${myDogs[0].id}`);
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByTestId("ev-dog-0")).toHaveValue(myDogs[0].name);
    await H.snap(page, "43-event-client-prefilled");
    await page.getByTestId("ev-costume-no").click();
    await page.getByTestId("ev-heard-client").click();
    await page.getByTestId("ev-rules").check();
    await page.getByTestId("event-submit").click();
    await expect(page.getByTestId("event-confirmation")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("event-confirmation-dogs")).toHaveText("1");
    await expect(page.getByTestId("event-confirmation-costume")).toContainText(/not entered/i);

    const dogsAfter = await api.get("/dogs");
    const after = Array.isArray(dogsAfter) ? dogsAfter : dogsAfter.items || dogsAfter.dogs || [];
    expect(after.length).toBe(myDogs.length);
    // linked to the client, with the real dog id, visible only to staff
    const admin = await adminToken(request);
    const rows = await (await request.get(`${H.API}/admin/events`, { headers: { Authorization: `Bearer ${admin.token}` } })).json();
    const ev = rows.events.find((e) => e.slug === SLUG);
    const found = await (await request.get(`${H.API}/admin/events/${ev.id}/registrations?q=${encodeURIComponent(client.email)}`, { headers: { Authorization: `Bearer ${admin.token}` } })).json();
    expect(found.registrations.length).toBe(1);
    expect(found.registrations[0].dogs[0].dog_id).toBe(myDogs[0].id);
    expect(found.registrations[0].client_id).toBeTruthy();
    // a client token cannot reach attendee data
    expect((await request.get(`${H.API}/admin/events/${ev.id}/registrations`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("staff run the door: totals, search, check in + undo, walk-in, costume roster, CSV", async ({ page, request }) => {
    const errors = watchErrors(page);
    const tag = `${Date.now()}-${test.info().project.name}`;
    // one fresh preregistration to find
    const reg = await (await request.post(`${H.API}/public/events/${SLUG}/register`, { data: {
      primary_contact: `Door Test ${tag}`, email: `door-${tag}@example.com`, phone: "330-555-7777", adults: 1, children: 0,
      dogs: [{ name: "Rex", costume_entered: true, costume_theme: "Pirate" }], costume_contest: true, heard_from: "facebook",
      rules_acknowledged: true, marketing_consent: false, idempotency_key: `e2e-${tag}`,
    } })).json();
    expect(reg.registration.confirmation_number).toMatch(/^SH-TOT-/);

    await adminInBrowser(page, request);
    // Today shows the event with its preregistration count and opens the dashboard
    await page.goto("/admin/today");
    const todayCard = page.getByTestId("today-events");
    await expect(todayCard).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`today-event-${SLUG}`)).toContainText(/trunk or treat/i);
    await expect(page.getByTestId(`today-event-${SLUG}-households`)).toContainText(/\d+ household/);
    await todayCard.scrollIntoViewIfNeeded();
    await H.snap(page, "43b-admin-today-events");
    await page.getByTestId("today-open-events").click();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/admin\/events$/);
    await expect(page.getByTestId("event-name")).toContainText(/trunk or treat/i);
    await expect(page.getByTestId("event-public-link")).toContainText(`/events/${SLUG}`);
    for (const k of ["households", "adults", "children", "people", "dogs", "costume_entries", "checked_in", "walk_ins"]) {
      await expect(page.getByTestId(`event-stat-${k}-value`)).not.toHaveText("—");
    }
    const stat = async (k) => Number(await page.getByTestId(`event-stat-${k}-value`).innerText());
    const households0 = await stat("households");
    const checked0 = await stat("checked_in");
    const walkins0 = await stat("walk_ins");
    // the flyer QR code renders and downloads print-size
    const qr = page.getByTestId("event-qr-image");
    await expect(qr).toBeVisible();
    expect(await qr.evaluate((img) => img.naturalWidth)).toBeGreaterThan(50);
    const [qrDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("event-qr-download").click()]);
    expect(qrDl.suggestedFilename()).toBe(`${SLUG}-qr.png`);
    expect(fs.statSync(await qrDl.path()).size).toBeGreaterThan(1000);
    await noOverflow(page);
    await H.snap(page, "44-admin-events-dashboard");

    // search by confirmation number, then by phone digits
    await page.getByTestId("event-search").fill(reg.registration.confirmation_number);
    const row = page.getByTestId(`event-reg-${reg.registration.id}`);
    await expect(row).toBeVisible();
    await expect(page.locator('[data-testid^="event-reg-"][data-checked-in]')).toHaveCount(1);
    await page.getByTestId("event-search").fill("5557777");
    await expect(row).toBeVisible();
    await noOverflow(page);
    await H.snap(page, "45-admin-events-search");

    // the plain registration table: every column, sideways scroll on a phone, no page overflow
    await page.getByTestId("event-layout-table").click();
    const table = page.getByTestId("event-attendees-table");
    await expect(table).toBeVisible();
    await expect(table.getByTestId(`event-table-row-${reg.registration.id}`)).toContainText(reg.registration.confirmation_number);
    await expect(table.getByTestId(`event-table-row-${reg.registration.id}`)).toContainText("Rex");
    for (const h of ["Confirmation #", "Primary contact", "Email", "Phone", "Adults", "Children", "Dogs", "Costume", "Source", "Status", "Check-in", "Registered"]) {
      await expect(table.locator("thead")).toContainText(h);
    }
    await noOverflow(page);
    await H.snap(page, "45b-admin-events-table");
    await page.getByTestId("event-layout-list").click();
    await expect(row).toBeVisible();

    // check in → pill + count; undo → back
    const btn = page.getByTestId(`event-checkin-${reg.registration.id}`);
    await H.expectNotCovered(page, btn, "check in button");
    await btn.click();
    await expect(page.getByTestId(`event-reg-checked-${reg.registration.id}`)).toBeVisible();
    await expect.poll(() => stat("checked_in")).toBe(checked0 + 1);
    await H.snap(page, "46-admin-events-checked-in");
    await page.getByTestId(`event-undo-${reg.registration.id}`).click();
    await expect(page.getByTestId(`event-reg-checked-${reg.registration.id}`)).toHaveCount(0);
    await expect.poll(() => stat("checked_in")).toBe(checked0);
    // open the registration → dog details
    await page.getByTestId(`event-reg-open-${reg.registration.id}`).click();
    await expect(page.getByTestId("event-reg-detail")).toBeVisible();
    await expect(page.getByTestId("event-reg-detail-dogs")).toContainText("Rex");
    await expect(page.getByTestId("event-reg-detail-dogs")).toContainText(/Contestant #\d{3}/);
    await expect(page.getByTestId("event-reg-detail-dogs")).toContainText("Pirate");
    await H.snap(page, "47-admin-events-detail");
    await page.getByTestId("event-reg-detail-close").click();

    // walk-in
    await page.getByTestId("event-add-walkin").click();
    await expect(page.getByTestId("event-walkin")).toBeVisible();
    await page.getByTestId("walkin-name").fill(`Walk In ${tag}`);
    await page.getByTestId("walkin-phone").fill("330-555-0001");
    await page.getByTestId("walkin-dog-0").fill("Biscuit");
    await page.getByTestId("walkin-costume").check();
    await page.getByTestId("walkin-dog-theme-0").fill("Dinosaur");
    await noOverflow(page);
    await H.snap(page, "48-admin-events-walkin");
    await page.getByTestId("walkin-submit").click();
    await expect(page.getByTestId("event-walkin")).toHaveCount(0);
    await expect.poll(() => stat("walk_ins")).toBe(walkins0 + 1);
    await expect.poll(() => stat("households")).toBe(households0 + 1);
    await expect.poll(() => stat("checked_in")).toBe(checked0 + 1); // walk-ins are checked in on arrival
    await page.getByTestId("event-search").fill("");
    await page.getByTestId("event-search").fill(`Walk In ${tag}`);
    await expect(page.locator('[data-testid^="event-reg-"][data-checked-in="1"]')).toHaveCount(1);

    // costume roster: unique three-digit numbers, both dogs present
    await page.getByTestId("event-view-costume").click();
    await expect(page.getByTestId("event-costume-table")).toBeVisible();
    const labels = await page.locator('[data-testid="event-costume-table"] tbody tr td:first-child').allInnerTexts();
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l).toMatch(/^#\d{3}$/);
    await expect(page.getByTestId("event-costume-table")).toContainText("Biscuit");
    await expect(page.getByTestId("event-costume-table")).toContainText("Dinosaur");
    await noOverflow(page);
    await H.snap(page, "49-admin-events-costume");

    // CSV exports download with the right shape
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("event-export-csv").click()]);
    expect(dl.suggestedFilename()).toBe(`${SLUG}-registrations.csv`);
    const csv = fs.readFileSync(await dl.path(), "utf8");
    expect(csv.split("\n")[0]).toContain("Confirmation #,Primary contact,Email,Phone");
    expect(csv).toContain(reg.registration.confirmation_number);
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("event-export-costume-csv").click()]);
    expect(dl2.suggestedFilename()).toBe(`${SLUG}-costume-contest.csv`);
    expect(fs.readFileSync(await dl2.path(), "utf8").split("\n")[0]).toContain("Contestant #,Dog name,Owner");
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("owner creates a second event in the editor, it shows up everywhere, edits it, then deletes it", async ({ page, request }) => {
    const errors = watchErrors(page);
    const tag = `${Date.now()}`;
    const slug = `e2e-spring-fling-${tag}`;
    await adminInBrowser(page, request);
    await page.goto("/admin/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("event-new").click();
    const ed = page.getByTestId("event-editor");
    await expect(ed).toBeVisible();
    await page.getByTestId("event-editor-name").fill(`Spring Fling ${tag}`);
    await expect(page.getByTestId("event-editor-slug")).toHaveValue(`spring-fling-${tag}`); // link name follows the title
    await page.getByTestId("event-editor-slug").fill(slug);
    await page.getByTestId("event-editor-line1").fill("Spring Fling");
    await page.getByTestId("event-editor-line2").fill("+ Agility try-it");
    await page.getByTestId("event-editor-description").fill("Sniff, play, treats.");
    await page.getByTestId("event-editor-start").fill("2027-04-10T13:00");
    await page.getByTestId("event-editor-end").fill("2027-04-10T15:00");
    await page.getByTestId("event-editor-prefix").fill("SH-SF");
    await page.getByTestId("event-editor-costume").uncheck();
    await page.getByTestId("event-editor-published").check();
    await expect(page.getByTestId("event-editor-notify")).toBeChecked(); // alerts on by default
    await page.getByTestId("event-editor-add-highlight").click();
    await page.getByTestId("event-editor-highlight-title-0").fill("Agility try-it");
    await page.getByTestId("event-editor-highlight-body-0").fill("Low jumps and a tunnel.");
    await page.getByTestId("event-editor-add-rule").click();
    await page.getByTestId(`event-editor-rule-${3}`).fill("Bring water for your dog.");
    await noOverflow(page);
    await H.snap(page, "52-admin-event-editor");
    await page.getByTestId("event-editor-save").click();
    await expect(ed).toHaveCount(0);
    // selected and shown on the dashboard
    await expect(page.getByTestId("event-name")).toContainText(`Spring Fling ${tag}`);
    await expect(page.getByTestId("event-public-link")).toContainText(`/events/${slug}`);
    await expect(page.getByTestId("event-select")).toBeVisible(); // two events now → a picker

    // the public page renders what was typed, with no costume questions
    const guest = await page.context().browser().newContext({ viewport: page.viewportSize() });
    const gp = await guest.newPage();
    await gp.addInitScript(() => { try { localStorage.setItem("sh_install_dismissed_at", String(Date.now())); } catch {} });
    await gp.goto(`/events/${slug}`);
    await expect(gp.getByTestId("event-title")).toContainText("Spring Fling");
    await expect(gp.getByTestId("event-title")).toContainText("Agility try-it");
    await expect(gp.getByTestId("event-features")).toContainText("Low jumps and a tunnel.");
    await expect(gp.getByTestId("event-rules")).toContainText("Bring water for your dog.");
    await gp.getByTestId("event-hero-cta").click();
    await gp.getByTestId("ev-dogs-plus").click();
    await expect(gp.getByTestId("event-form-costume")).toHaveCount(0);
    await H.snap(gp, "53-second-event-public");
    // and it is in the nav (two events → the index) and the homepage banner counts it
    await gp.goto("/");
    await expect(gp.getByTestId("site-event-banner-all")).toContainText(/2/);
    await gp.getByTestId("site-menu-toggle").click();
    await expect(gp.getByTestId("site-drawer").getByTestId("site-nav-events")).toHaveAttribute("href", "/events");
    await gp.goto("/events");
    await expect(gp.getByTestId(`public-event-card-${slug}`)).toBeVisible();
    await H.snap(gp, "54-events-index");
    await guest.close();

    // edit: unpublish it → gone from the site
    await page.getByTestId("event-edit").click();
    await expect(page.getByTestId("event-editor-name")).toHaveValue(`Spring Fling ${tag}`);
    await page.getByTestId("event-editor-published").uncheck();
    await page.getByTestId("event-editor-save").click();
    await expect(page.getByTestId("event-editor")).toHaveCount(0);
    await expect(page.getByTestId("event-reg-state")).toBeVisible();
    expect((await request.get(`${H.API}/public/events/${slug}`)).status()).toBe(404);
    // delete (nobody registered) → the picker goes back to one event
    await page.getByTestId("event-edit").click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("event-editor-delete").click();
    await expect(page.getByTestId("event-editor")).toHaveCount(0);
    await expect(page.getByTestId("event-name")).toContainText(/trunk or treat/i);
    await expect(page.getByTestId("event-select")).toHaveCount(0);
    expect(errors.filter((e) => !e.includes("404")), errors.join(" | ")).toEqual([]);
  });

  test("owner uploads a banner background picture; the homepage banner uses it; remove puts the colours back", async ({ page, request }) => {
    const errors = watchErrors(page);
    await adminInBrowser(page, request);
    await page.goto("/admin/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("event-edit").click();
    await expect(page.getByTestId("event-editor-banner")).toBeVisible();
    // a real (tiny) PNG, built here so the test owns it
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwHwyBBAOEAWMAAKeXCf3l5yW0AAAAAElFTkSuQmCC", "base64");
    await page.getByTestId("event-editor-banner-file").setInputFiles({ name: "pumpkins.png", mimeType: "image/png", buffer: png });
    await expect(page.getByTestId("event-editor-banner-preview")).toBeVisible({ timeout: 15_000 });
    // the flyer goes up the same way and lands on the event page
    await page.getByTestId("event-editor-flyer-file").setInputFiles({ name: "flyer.png", mimeType: "image/png", buffer: png });
    await expect(page.getByTestId("event-editor-flyer-preview")).toBeVisible({ timeout: 15_000 });
    await H.snap(page, "55-editor-banner-picture");
    await page.keyboard.press("Escape"); // toasts can sit over the X on a phone
    await expect(page.getByTestId("event-editor")).toHaveCount(0);

    const guest = await page.context().browser().newContext({ viewport: page.viewportSize() });
    const gp = await guest.newPage();
    await gp.addInitScript(() => { try { localStorage.setItem("sh_install_dismissed_at", String(Date.now())); } catch {} });
    await gp.goto("/");
    const banner = gp.getByTestId("site-event-banner");
    await expect(banner).toHaveAttribute("data-has-image", "1");
    const bgImage = await gp.getByTestId("site-event-banner-image").evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bgImage).toMatch(/\/api\/public\/events\/trunk-or-treat-2026\/images\/banner\?v=/);
    const img = await request.get(`${H.API}/public/events/${SLUG}/images/banner`);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toBe("image/png");
    // words and button are untouched
    await expect(gp.getByTestId("site-event-banner-name")).toContainText(/trunk or treat/i);
    await expect(gp.getByTestId("site-event-banner-cta")).toHaveAttribute("href", `/events/${SLUG}`);
    await H.snap(gp, "56-home-banner-with-picture");
    await gp.goto(`/events/${SLUG}`);
    await expect(gp.getByTestId("event-flyer-image")).toHaveAttribute("src", new RegExp(`/api/public/events/${SLUG}/images/flyer\\?v=`));
    await guest.close();

    await page.getByTestId("event-edit").click();
    await page.getByTestId("event-editor-banner-remove").click();
    await expect(page.getByTestId("event-editor-banner-empty")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("event-editor-flyer-remove").click();
    await expect(page.getByTestId("event-editor-flyer-empty")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape"); // toasts can sit over the X on a phone
    await expect(page.getByTestId("event-editor")).toHaveCount(0);
    expect((await request.get(`${H.API}/public/events/${SLUG}/images/banner`)).status()).toBe(404);
    expect((await request.get(`${H.API}/public/events/${SLUG}/images/flyer`)).status()).toBe(404);
    expect(errors.filter((e) => !e.includes("404")), errors.join(" | ")).toEqual([]);
  });

  test("desktop 1440×900: public page and admin dashboard", async ({ page, request }) => {
    test.skip(test.info().project.name !== "phone-390", "one desktop pass is enough");
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = watchErrors(page);
    await page.goto(`/events/${SLUG}`);
    await expect(page.getByTestId("public-event")).toBeVisible();
    await noOverflow(page);
    await H.snap(page, "50-event-desktop");
    await adminInBrowser(page, request);
    await page.goto("/admin/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 20_000 });
    await noOverflow(page);
    await H.snap(page, "51-admin-events-desktop");
    expect(errors, errors.join(" | ")).toEqual([]);
  });
});
