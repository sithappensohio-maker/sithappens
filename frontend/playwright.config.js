// Client School — mobile regression suite (Chromium, 390×844 and 320×568).
//
// Runs against the SAME stack a developer uses: a disposable seeded database,
// the FastAPI backend on its own port, and the Vite dev server on its own
// port (see e2e/start-backend.mjs and e2e/start-frontend.mjs). Nothing here
// touches the real local dev database — the seed refuses any database name
// that does not contain "test".
//
//   yarn e2e            # headless, both phone projects
//   yarn e2e:headed     # visible browser, video on, slower motion
//
// Requires: Playwright's Chromium (`npx playwright install chromium`), a
// MongoDB on 127.0.0.1:27017, and the backend's Python environment
// (E2E_PYTHON overrides the interpreter; see start-backend.mjs).
// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8021);
const FRONT_PORT = Number(process.env.E2E_FRONT_PORT || 3100);
// `yarn e2e:headed` (or any --headed run) records video and slows actions so
// the motion can be watched; E2E_HEADED=1 does the same from the environment.
const headed = !!process.env.E2E_HEADED || process.argv.includes("--headed");

module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.js/,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],
  outputDir: "e2e/results",
  use: {
    baseURL: `http://127.0.0.1:${FRONT_PORT}`,
    browserName: "chromium",
    screenshot: headed ? "on" : "only-on-failure",
    video: headed ? "on" : "retain-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    launchOptions: headed ? { slowMo: Number(process.env.E2E_SLOWMO || 250) } : {},
  },
  projects: [
    {
      name: "phone-390",
      use: { ...devices["iPhone 12"], browserName: "chromium", defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "phone-320",
      use: { ...devices["iPhone 12"], browserName: "chromium", defaultBrowserType: "chromium", viewport: { width: 320, height: 568 } },
    },
  ],
  webServer: [
    {
      command: "node e2e/start-backend.mjs",
      url: `http://127.0.0.1:${BACKEND_PORT}/api/settings/public`,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "node e2e/start-frontend.mjs",
      url: `http://127.0.0.1:${FRONT_PORT}/`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
