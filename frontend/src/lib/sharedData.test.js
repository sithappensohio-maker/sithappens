import fs from "fs";
import path from "path";

const apiSrc = fs.readFileSync(path.join(__dirname, "api.js"), "utf8");
const sharedSrc = fs.readFileSync(path.join(__dirname, "sharedData.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "App.js"), "utf8");
const servicesSrc = fs.readFileSync(path.join(__dirname, "..", "components", "ServicesSettings.jsx"), "utf8");
const programsSrc = fs.readFileSync(path.join(__dirname, "..", "components", "Programs.jsx"), "utf8");

test("Phase 3 caches only shared reference resources, not every GET", () => {
  for (const pathName of ["/clients", "/dogs", "/services", "/programs", "/settings"]) {
    expect(apiSrc).toContain(`"${pathName}"`);
  }
  expect(apiSrc).toContain("SHARED_GET_POLICIES");
  expect(apiSrc).toContain("_sharedPolicyFor(url)");
  expect(apiSrc).not.toContain('resource: "bookings"');
  expect(apiSrc).not.toContain('resource: "ledger"');
});

test("shared cache is token scoped, query-param aware, bounded, and mutation invalidated", () => {
  expect(apiSrc).toContain('localStorage.getItem("sh_token")');
  expect(apiSrc).toContain("_stableValue(config.params)");
  expect(apiSrc).toContain("while (_sharedResponseCache.size > 120)");
  expect(apiSrc).toContain('for (const method of ["post", "put", "patch", "delete"])');
  expect(apiSrc).toContain("invalidateSharedApiData(resources)");
});

test("shared data hook vocabulary exists for core reference data", () => {
  for (const hook of ["useClientsData", "useDogsData", "useServicesData", "useProgramsData", "useSettingsData"]) {
    expect(sharedSrc).toContain(`export const ${hook}`);
  }
  expect(sharedSrc).toContain("subscribeSharedApiCache");
  expect(sharedSrc).toContain("getSharedData");
});

test("App shell uses one shared navigation-count owner instead of four local pollers", () => {
  expect(appSrc).toContain('import { useAdminNavCounts } from "./lib/sharedData"');
  expect(appSrc).toContain("useAdminNavCounts({");
  expect(appSrc).not.toContain('api.get("/admin/messages/unread-count")');
  expect(appSrc).not.toContain('api.get("/admin/shop-orders/unseen-count")');
  expect(appSrc).not.toContain('api.get("/admin/school/hq/attention-count")');
  expect(appSrc).not.toContain('api.get("/admin/pending-actions/count")');
});

test("Services and Programs establish the hook migration pattern", () => {
  expect(servicesSrc).toContain("useServicesData");
  expect(servicesSrc).toContain("useProgramsData");
  expect(programsSrc).toContain("useProgramsData");
  expect(programsSrc).toContain('useSharedData("programs", { url: "/programs/meta"');
});
