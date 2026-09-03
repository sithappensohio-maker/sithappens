// Outside School: the install prompt must clear the Portal tab bar and the Shop tray too.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const PROMPT = '[data-testid="install-ios-hint"], [data-testid="install-app-prompt"]';

async function promptClearsEveryDock(page, label) {
  const prompt = page.locator(PROMPT).first();
  await expect(prompt, `${label}: prompt visible`).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const p = document.querySelector('[data-testid="install-ios-hint"], [data-testid="install-app-prompt"]');
    if (!p) return "no prompt";
    const pr = p.getBoundingClientRect();
    const docks = [...document.querySelectorAll("[data-bottom-dock]")].map((d) => ({ id: d.dataset.testid, r: d.getBoundingClientRect() })).filter((d) => d.r.height > 0);
    if (!docks.length) return "no dock mounted";
    const bad = docks.filter((d) => pr.bottom > d.r.top + 1);
    return bad.length ? `overlaps ${bad.map((d) => `${d.id}@${Math.round(d.r.top)} (prompt bottom ${Math.round(pr.bottom)})`).join(", ")}` : "clear";
  }), { timeout: 8_000, message: `${label}: prompt clears every bottom dock` }).toBe("clear");
}

test.describe("install prompt outside School", () => {
  test("Portal home and Shop: the prompt sits above the tab bar and the checkout tray", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 11);
    await H.loginInBrowser(page, request, client, { keepInstallPrompt: true });
    await page.goto("/portal");
    await expect(page.getByTestId("client-mobile-nav")).toBeVisible();
    await promptClearsEveryDock(page, "Portal home");
    await H.snap(page, "23-portal-home-install-prompt");
    await page.goto("/shop");
    await page.waitForLoadState("networkidle");
    const docks = await page.locator("[data-bottom-dock]").count();
    test.info().annotations.push({ type: "shop docks mounted", description: String(docks) });
    if (docks > 0) await promptClearsEveryDock(page, "Shop");
    else await expect(page.locator(PROMPT).first()).toBeVisible();
    await H.snap(page, "24-shop-install-prompt");
  });
});
