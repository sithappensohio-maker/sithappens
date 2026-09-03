// A lesson opens on its CURRENT part — after a reload, and when coming back later.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("reload and return", () => {
  test("halfway through a lesson, reload and return both land on the current part", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 1);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    const lessonId = client.current_lesson_id;
    await api.completeParts(client.enrollment_id, lessonId, 2);

    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);

    // Reload halfway: Part 3 is current and revealed; no fresh-start dialog.
    await page.goto(H.lessonUrl(client, lessonId));
    await expect(page.getByTestId("fresh-lesson-start")).toHaveCount(0);
    await expect(page.getByTestId("lesson-journey-part")).toHaveText(/Part 3 of 5/);
    await H.expectInUsable(page, page.getByTestId("lesson-section-coach-train"), "Part 3 coaching card");
    await page.reload();
    await expect(page.getByTestId("lesson-journey-part")).toHaveText(/Part 3 of 5/);
    await H.expectInUsable(page, page.getByTestId("lesson-section-coach-train"), "Part 3 coaching card after reload");
    await H.snap(page, "07-reload-part3");

    // Leave via the tab bar, come back through Today's button.
    await page.getByTestId("school-nav-m-today").click();
    await expect(page).toHaveURL(/\/school$/);
    const primary = page.getByTestId("today-primary-action");
    await H.expectInUsable(page, primary, "Today primary action");
    await H.snap(page, "08-today-lesson-action");
    await primary.click();
    await expect(page).toHaveURL(/\/lesson\//);
    await H.expectInUsable(page, page.getByTestId("lesson-section-coach-train"), "Part 3 coaching card on return");
    await expect(page.getByTestId("lesson-journey-part")).toHaveText(/Part 3 of 5/);

    // And through the Course trail.
    await page.getByTestId("school-nav-m-course").click();
    await expect(page.getByTestId("course-roadmap")).toBeVisible();
    await page.getByTestId(`course-lesson-${lessonId}`).click();
    await H.expectInUsable(page, page.getByTestId("lesson-section-coach-train"), "Part 3 coaching card from Course");
  });
});
