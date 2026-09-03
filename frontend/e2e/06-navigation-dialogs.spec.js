// Screen changes get a fresh viewport; dialogs open at their title; reduced motion still lands.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("navigation and dialogs", () => {
  test("bottom-tab screen changes never inherit the previous screen's scroll", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 8);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);
    await page.goto("/school");
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action on entry");

    await page.getByTestId("school-nav-m-course").click();
    await expect(page.getByTestId("course-roadmap")).toBeVisible();
    await H.humanScroll(page, 700);
    expect(await H.scrollRootTop(page)).toBeGreaterThan(200);

    await page.getByTestId("school-nav-m-today").click();
    await expect(page).toHaveURL(/\/school$/);
    await expect.poll(() => H.scrollRootTop(page)).toBe(0);
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action after tab change");
    await H.snap(page, "18-today-after-tab-change");

    await H.humanScroll(page, 700);
    await page.getByTestId("school-nav-m-progress").click();
    await expect.poll(() => H.scrollRootTop(page)).toBe(0);
    await page.getByTestId("school-nav-m-practice").click();
    await expect.poll(() => H.scrollRootTop(page)).toBe(0);
    await page.getByTestId("school-nav-m-course").click();
    await expect.poll(() => H.scrollRootTop(page)).toBe(0);
  });

  test("dialogs open at their title, not scrolled to their button", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 8);
    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);
    await page.goto("/school");
    await page.getByTestId("school-how-it-works").click();
    const overlay = page.getByTestId("school-orientation");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("#school-orientation-title")).toBeInViewport();
    expect(await overlay.locator("> div").evaluate((el) => el.scrollTop)).toBe(0);
    await H.snap(page, "19-how-school-works-dialog");
    await overlay.getByTestId("school-orientation-start").click();
    await expect(overlay).toHaveCount(0);

    await page.goto(H.lessonUrl(client, client.current_lesson_id));
    const dialog = page.getByTestId("fresh-lesson-start");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#fresh-lesson-title")).toBeInViewport();
    expect(await dialog.locator("section").evaluate((el) => el.scrollTop)).toBe(0);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("Part 1 → Part 2 still lands under the header with animations off", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 9);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);
    await page.goto(H.lessonUrl(client, client.current_lesson_id));
    await page.getByTestId("fresh-lesson-start-button").click();
    await H.expectAtTop(page, page.getByTestId("lesson-section-coach-learn"), "Part 1 (reduced motion)");
    const next1 = page.getByTestId("lesson-section-continue-learn");
    await next1.scrollIntoViewIfNeeded();
    await next1.click();
    await H.expectAtTop(page, page.getByTestId("lesson-section-coach-get_ready"), "Part 2 (reduced motion)");
  });
});
