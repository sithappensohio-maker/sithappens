import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const publicShopSrc = read("..", "screens", "PublicShop.jsx");
const landingSrc = read("shop", "ShopLanding.jsx");
const deptsSrc = read("..", "lib", "shopDepartments.js");
const sidebarSrc = read("ClientSidebar.jsx");
const mobileNavSrc = read("ClientMobileNav.jsx");

test("Online School keeps a prominent spotlight of its own on the storefront", () => {
  // It used to be a full hero ABOVE the Shop, which meant a guest scrolled
  // past a second page header and a second <h1> before reaching a single
  // product. The Shop redesign moved it INTO the storefront as its own
  // spotlight section — still prominent, still its own presentation, but
  // no longer ahead of everything the shop sells.
  expect(landingSrc).toMatch(/data-testid="shop-school-spotlight"/);
  expect(landingSrc).toMatch(/Train your dog, anywhere/);
  expect(landingSrc).toMatch(/onSelectDepartment\("online_school"\)/);
  // And the guest page must not put a second hero above it again.
  expect(publicShopSrc).not.toMatch(/public-online-school-hero/);
});

test("a direct Online School link still works, including the old ?section= form", () => {
  // Links in the wild — emails, the public site, bookmarks — use the old
  // section vocabulary. The redesign moved to ?dept=, so the old names have
  // to keep resolving or somebody's bookmark quietly stops working.
  const { resolveDepartmentParam } = require("../lib/shopDepartments");
  expect(resolveDepartmentParam(new URLSearchParams("?dept=online_school"))).toBe("online_school");
  expect(resolveDepartmentParam(new URLSearchParams("?section=online_school"))).toBe("online_school");
  expect(resolveDepartmentParam(new URLSearchParams("?section=merch"))).toBe("gear");
  expect(resolveDepartmentParam(new URLSearchParams("?section=prepaid_visits"))).toBe("prepaid");
  expect(resolveDepartmentParam(new URLSearchParams("?section=nonsense"))).toBeNull();
  expect(resolveDepartmentParam(new URLSearchParams(""))).toBeNull();
  // The alias table is in the library, not sprinkled through screens.
  expect(deptsSrc).toMatch(/SECTION_ALIASES/);
});

test("free-course hero CTA discovers the real claimable program instead of hardcoding an id", () => {
  // Pinned to the RULE, not to the fetch: the hero must find the program in
  // the real catalog and must not hardcode one. PublicShop no longer fetches
  // that catalog itself — it receives the list PortalShop already loaded,
  // which is the same source of truth without a second download of it.
  expect(publicShopSrc).toMatch(/onItemsLoaded=\{onCatalogLoaded\}/);
  expect(publicShopSrc).toMatch(/isFreeClaimable\(item\)/);
  expect(publicShopSrc).toMatch(/freeCourse\.id/);
  expect(publicShopSrc).not.toMatch(/program_id\s*:\s*["'][^"']+["']/);
});

test("desktop client navigation exposes School as a primary destination (one name, matching the mobile bar and in-app header)", () => {
  const school = sidebarSrc.indexOf('label="School"');
  expect(sidebarSrc).not.toContain('label="Online School"');
  const shop = sidebarSrc.indexOf('label="Shop"');
  expect(school).toBeGreaterThan(-1);
  expect(shop).toBeGreaterThan(-1);
  expect(school).toBeLessThan(shop);
  expect(sidebarSrc).toMatch(/window\.location\.href = "\/school"/);
});

test("mobile client navigation keeps School in the permanent five-button bar", () => {
  expect(mobileNavSrc).toMatch(/testid="mobile-nav-school"/);
  expect(mobileNavSrc).toMatch(/label="School"/);
  expect(mobileNavSrc).toMatch(/showPhotography \? \[\{ icon: "fa-camera-retro", label: "Photography"/);
});
