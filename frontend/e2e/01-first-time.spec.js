// A brand-new customer: setup → the one welcome → first lesson → Part 1 → Part 2.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("first-time customer", () => {
  test("setup, one orientation, then straight into Part 1 and on to Part 2", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 0);
    await H.loginInBrowser(page, request, client);
    await page.goto("/school");

    // Step 0: the setup is the one thing to do, and it is right here.
    const step0 = page.getByTestId("student-home-setup-first");
    await expect(step0).toBeVisible();
    await H.expectInUsable(page, step0.locator("h1"), "Step 0 headline");
    await H.snap(page, "01-step0-setup");
    await expect(page.getByTestId("student-home-open-course-fallback")).toHaveCount(0);
    const form = page.getByTestId("school-onboarding");
    await expect(form).toBeVisible();
    await form.locator("textarea").first().fill("Come when called and stop jumping on guests");
    await form.locator("textarea").nth(3).fill("Flat collar and a 6 ft leash");
    await page.getByRole("button", { name: /Save & Start My First Lesson/i }).click();

    // ONE orientation: the Program Welcome page, with its button on screen.
    await expect(page).toHaveURL(/\/welcome$/);
    const start = page.getByTestId("welcome-start");
    await H.expectInUsable(page, start, "welcome start button");
    await expect(start).toHaveText(/Start lesson/i);
    await expect(page.getByTestId("welcome-how-it-works")).toBeVisible();
    await expect(page.getByTestId("school-orientation")).toHaveCount(0);
    await H.snap(page, "02-welcome");
    await start.click();

    // The lesson opens with the New-lesson dialog at its title.
    await expect(page).toHaveURL(/\/lesson\//);
    const dialog = page.getByTestId("fresh-lesson-start");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#fresh-lesson-title")).toBeInViewport();
    expect(await dialog.locator("section").evaluate((el) => el.scrollTop)).toBe(0);
    await expect(dialog.getByTestId("fresh-lesson-journey")).toContainText("Read");
    await H.snap(page, "03-new-lesson-dialog");
    await dialog.getByTestId("fresh-lesson-start-button").click();

    // Part 1 lands under the header; the strip says where we are and what follows.
    await H.expectAtTop(page, page.getByTestId("lesson-section-coach-learn"), "Part 1 coaching card");
    await expect(page.getByTestId("lesson-journey-part")).toHaveText(/Part 1 of 5/);
    await expect(page.getByTestId("lesson-journey-then")).toContainText("Then: Practice");
    await expect(page.getByTestId("lesson-journey-map")).toHaveCount(0);
    await H.snap(page, "04-part1-landed");

    // Read down and tap Next → Part 2 is current and revealed.
    const next1 = page.getByTestId("lesson-section-continue-learn");
    await next1.scrollIntoViewIfNeeded();
    await H.expectInUsable(page, next1, "Part 1 Next button");
    await next1.click();
    await H.expectAtTop(page, page.getByTestId("lesson-section-coach-get_ready"), "Part 2 coaching card");
    await expect(page.getByTestId("lesson-journey-part")).toHaveText(/Part 2 of 5/);
    await expect(page.getByTestId("lesson-section-guided-learn")).toHaveCount(0);
    await H.snap(page, "05-part2-landed");

    // The full map is there for anyone who wants it, and completed parts stay reviewable.
    await page.getByTestId("lesson-journey-toggle").click();
    const map = page.getByTestId("lesson-journey-map");
    await expect(map).toBeVisible();
    await expect(map.getByTestId("lesson-guide-section-learn")).toHaveAttribute("data-state", "completed");
    await expect(map.getByTestId("lesson-guide-section-get_ready")).toHaveAttribute("data-state", "current");
    await H.snap(page, "06-all-parts-map");
    await map.getByTestId("lesson-guide-section-learn").click();
    await H.expectAtTop(page, page.getByTestId("lesson-section-guided-learn"), "reviewed Part 1");
    await expect(page.getByTestId("lesson-section-review-learn")).toBeVisible();
  });
});
