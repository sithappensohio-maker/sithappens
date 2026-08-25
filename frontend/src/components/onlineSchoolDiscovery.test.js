import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const publicShopSrc = read("..", "screens", "PublicShop.jsx");
const sidebarSrc = read("ClientSidebar.jsx");
const mobileNavSrc = read("ClientMobileNav.jsx");

test("public app shop gives Online School its own prominent hero and CTAs", () => {
  expect(publicShopSrc).toMatch(/data-testid="public-online-school-hero"/);
  expect(publicShopSrc).toMatch(/View Online Classes/);
  expect(publicShopSrc).toMatch(/Start Free Course/);
  expect(publicShopSrc).toMatch(/initialTab=\{shopTab\}/);
});

test("public app shop supports a direct Online School section link", () => {
  expect(publicShopSrc).toMatch(/params\.get\("section"\)/);
  expect(publicShopSrc).toMatch(/requested === "online_school"/);
  expect(publicShopSrc).toMatch(/params\.set\("section", "online_school"\)/);
});

test("free-course hero CTA discovers the real claimable program instead of hardcoding an id", () => {
  expect(publicShopSrc).toMatch(/api\.get\("\/public\/shop\/catalog"\)/);
  expect(publicShopSrc).toMatch(/isFreeClaimable\(item\)/);
  expect(publicShopSrc).toMatch(/freeCourse\.id/);
  expect(publicShopSrc).not.toMatch(/program_id\s*:\s*["'][^"']+["']/);
});

test("desktop client navigation exposes Online School as a primary destination", () => {
  const school = sidebarSrc.indexOf('label="Online School"');
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
