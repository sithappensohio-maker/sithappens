// Installation promotion never competes with School's current instruction:
// while the primary CTA is on screen the install pill stays away; scroll past
// it and the pill may appear above the tab bar; scroll back and it hides again.
// None of that is a dismissal.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const PROMPT = '[data-testid="install-ios-hint"], [data-testid="install-app-prompt"]';

async function dismissalKey(page) {
  return page.evaluate(() => localStorage.getItem("sh_install_dismissed_at"));
}

/** Wheel the School container until the primary CTA is fully above the usable window. */
async function scrollPrimaryOut(page) {
  const cta = page.getByTestId("today-primary-action");
  for (let i = 0; i < 12; i += 1) {
    const box = await cta.boundingBox();
    const u = await H.usableWindow(page);
    if (box && box.y + box.height <= u.top) return;
    await H.humanScroll(page, 400);
  }
  throw new Error("could not scroll the primary action out of view");
}

async function scrollPrimaryBack(page) {
  for (let i = 0; i < 12; i += 1) {
    await H.humanScroll(page, -400);
    if ((await H.scrollRootTop(page)) === 0) return;
  }
}

test.describe("primary-action guard", () => {
  test("Today: pill hidden while the CTA is on screen, shown past it, hidden again, never dismissed", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 14);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    await H.loginInBrowser(page, request, client, { keepInstallPrompt: true });
    await H.markWelcomeSeen(page, client);

    // 1. Today loads with the primary School CTA visible.
    await page.goto("/school");
    const cta = page.getByTestId("today-primary-action");
    await H.expectInUsable(page, cta, "Today primary action");
    await expect(cta).toHaveAttribute("data-school-primary", "true");

    // 2. Eligible (nothing dismissed, iPhone hint conditions met) but not shown.
    expect(await dismissalKey(page)).toBeNull();
    await page.waitForTimeout(400); // give the observer a beat: the pill must NOT appear
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await H.snap(page, "25-guard-cta-visible-no-pill");

    // 3–4. Scroll past the CTA → the pill appears above the tab bar.
    await scrollPrimaryOut(page);
    const pill = page.locator(PROMPT).first();
    await expect(pill).toBeVisible();
    const p = await pill.boundingBox();
    const nav = await page.getByTestId("school-nav-mobile").boundingBox();
    expect(p.y + p.height, "pill bottom above the tab bar").toBeLessThanOrEqual(nav.y + 1);
    await H.snap(page, "26-guard-scrolled-pill-shown");

    // 5–6. Scroll the CTA back into view → the pill hides again.
    await scrollPrimaryBack(page);
    await H.expectInUsable(page, cta, "Today primary action after scrolling back");
    await expect(page.locator(PROMPT)).toHaveCount(0);

    // 7. Dismissal storage untouched throughout.
    expect(await dismissalKey(page)).toBeNull();

    // Round trip once more to prove it is a live signal, not a one-shot.
    await scrollPrimaryOut(page);
    await expect(page.locator(PROMPT).first()).toBeVisible();
    expect(await dismissalKey(page)).toBeNull();
  });

  test("immersive suppression still applies on top of the guard", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 14);
    await H.loginInBrowser(page, request, client, { keepInstallPrompt: true });
    await H.markWelcomeSeen(page, client);

    // A fresh lesson: no primary CTA on screen, but the New-lesson dialog is an
    // immersive workflow → hidden; start the lesson → Part 1 has no primary
    // marker → the pill shows; nothing was dismissed.
    await page.goto(H.lessonUrl(client, client.current_lesson_id));
    await expect(page.getByTestId("fresh-lesson-start")).toBeVisible();
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await page.getByTestId("fresh-lesson-start-button").click();
    await expect(page.locator(PROMPT).first()).toBeVisible();
    expect(await dismissalKey(page)).toBeNull();

    // Back on Today the CTA is on screen → guard hides it; "How School works"
    // on top of that keeps it hidden; closing the dialog leaves the guard in charge.
    await page.getByTestId("school-nav-m-today").click();
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action");
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await page.getByTestId("school-how-it-works").click();
    await expect(page.getByTestId("school-orientation")).toBeVisible();
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await page.getByTestId("school-orientation-start").click();
    await expect(page.getByTestId("school-orientation")).toHaveCount(0);
    await expect(page.locator(PROMPT)).toHaveCount(0);
    expect(await dismissalKey(page)).toBeNull();
  });
});
