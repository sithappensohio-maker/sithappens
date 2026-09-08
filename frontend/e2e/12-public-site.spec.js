// The app as the public website: a guest at `/` gets the homepage, a signed-in
// client at `/` gets their app, and every public page keeps the app's doors.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("public website", () => {
  test("guest at / sees the homepage; the seven answers are on it; nav and doors work", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("sh_install_dismissed_at", String(Date.now())); } catch {} });
    await page.goto("/");
    await expect(page.getByTestId("public-home")).toBeVisible();
    await expect(page.getByTestId("login-screen")).toHaveCount(0);

    // 1 what we do · 2 where we are
    await expect(page.getByTestId("site-hero-headline")).toContainText(/dog training/i);
    await expect(page.getByTestId("site-hero-contact")).toContainText(/Warren/);
    await expect(page.getByTestId("site-hero-contact")).toContainText(/\(330\) 978-5575/);
    await H.snap(page, "28-public-home-hero");
    // 3 training options
    await expect(page.getByTestId("site-programs")).toBeVisible();
    await expect(page.locator('[data-testid^="site-program-"]').first()).toBeVisible();
    // 4 how to book → the app's sign-in, and the Meet & Greet door
    await expect(page.getByTestId("site-book-now")).toHaveAttribute("href", "/login");
    await page.getByTestId("site-hero-book").click();
    await expect(page.getByTestId("meet-greet-modal")).toBeVisible();
    await page.getByTestId("meet-greet-close").click();
    // 5 free course → the existing Online School door
    await expect(page.getByTestId("site-hero-free-course")).toHaveAttribute("href", "/shop?section=online_school");
    // 6 client login
    await expect(page.getByTestId("site-hero-login")).toHaveAttribute("href", "/login");
    await expect(page.getByTestId("site-account-link")).toContainText(/client login/i);
    // 7 contact
    await expect(page.getByTestId("site-contact-details")).toContainText(/sithappensohio@gmail\.com/);
    await expect(page.getByTestId("site-footer-contact")).toContainText(/137 North St NW/);
    await page.getByTestId("site-how-inquiry").click();
    await expect(page.getByTestId("contact-inquiry-modal")).toBeVisible();
    await page.getByTestId("contact-inquiry-close").click();

    // Navigation (phone: through the drawer)
    await page.getByTestId("site-menu-toggle").click();
    await expect(page.getByTestId("site-drawer")).toBeVisible();
    await page.getByTestId("site-drawer").getByTestId("site-nav-training").click();
    await expect(page).toHaveURL(/\/training$/);
    await expect(page.getByTestId("public-training")).toBeVisible();
    await expect(page.locator('[data-testid^="site-training-group-"]').first()).toBeVisible();
    await H.snap(page, "29-public-training");
    for (const [key, url, testid] of [["about", /\/about$/, "public-about"], ["photography", /\/photography$/, "public-photography"], ["contact", /\/contact$/, "public-contact"]]) {
      await page.getByTestId("site-menu-toggle").click();
      await page.getByTestId("site-drawer").getByTestId(`site-nav-${key}`).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByTestId(testid)).toBeVisible();
    }
    await expect(page.getByTestId("site-contact-phone")).toContainText(/\(330\) 978-5575/);
    await H.snap(page, "30-public-contact");

    // Client login → the focused sign-in screen, with a way back
    await page.getByTestId("site-account-link").click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("login-screen")).toHaveAttribute("data-focus", "true");
    await expect(page.getByTestId("login-email-input")).toBeVisible();
    await expect(page.getByTestId("login-back-site")).toHaveAttribute("href", "/");
    await H.snap(page, "31-public-login");
  });

  test("deep links: referral code and the old sign-in anchor still reach the sign-in screen", async ({ page }) => {
    await page.goto("/?ref=7KTUMQ");
    await expect(page).toHaveURL(/\/login\?ref=7KTUMQ$/);
    await expect(page.getByTestId("register-refcode-input")).toHaveValue("7KTUMQ");
    await page.goto("/#landing-auth");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("login-email-input")).toBeVisible();
    // PWA start URL for a guest is the homepage
    await page.goto("/?source=pwa");
    await expect(page.getByTestId("public-home")).toBeVisible();
  });

  test("signed-in client: / is still their app, public pages show My portal, /login bounces home", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 0);
    await H.loginInBrowser(page, request, client);
    await page.goto("/");
    await expect(page.getByTestId("public-home")).toHaveCount(0);
    await expect(page.getByTestId("client-mobile-nav")).toBeVisible();
    await page.goto("/training");
    await expect(page.getByTestId("public-training")).toBeVisible();
    await expect(page.getByTestId("site-account-link")).toContainText(/my portal/i);
    await expect(page.getByTestId("site-account-link")).toHaveAttribute("href", "/");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.getByTestId("client-mobile-nav")).toBeVisible();
    // existing deep links keep working
    await page.goto("/school");
    await expect(page.getByTestId("school-app")).toBeVisible();
  });
});
