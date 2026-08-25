import fs from "fs";
import path from "path";

const source = fs.readFileSync(path.join(__dirname, "Login.jsx"), "utf8");

test("public landing hero exposes Online School as a primary start path", () => {
  expect(source).toContain('data-testid="landing-online-school-card"');
  expect(source).toContain('data-testid="landing-hero-online-school-cta"');
  expect(source).toContain("Train from home");
  expect(source).toContain("Free starter course available");
});

test("Online School CTA routes directly to the public Online School catalog", () => {
  expect(source).toMatch(/window\.location\.href\s*=\s*"\/shop\?section=online_school"/);
});

test("Meet and Greet is scoped to local services instead of falsely gating Online School", () => {
  expect(source).toContain("For daycare, boarding and in-person training");
  expect(source).toContain('data-testid="landing-hero-meet-greet-cta"');
});

test("Online School also appears in the What we do category grid", () => {
  expect(source).toContain('key: "online_school"');
  expect(source).toContain('label: "Online School"');
  expect(source).toContain('data-testid={c.key === "online_school" ? "landing-category-online-school-cta" : undefined}');
  expect(source).toContain("Five ways we help your pup.");
});
