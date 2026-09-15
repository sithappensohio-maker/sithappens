/* Follow-up C (Playwright 320): the Today rail must keep its primary action
 * above the tab bar on a 320×568 phone. Structure is unchanged; only these
 * classes let the ≤359px stylesheet trim what LAST and the greeting show. */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "StudentHome.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.css"), "utf8");

test("the narrow-phone hooks exist on the greeting, LAST details, rail and primary action", () => {
  for (const cls of ["sh-today-greeting", "sh-today-sub", "sh-journey-last-detail", "sh-command-body", "sh-journey-rail", "sh-today-primary"]) {
    expect(src).toContain(`className="${cls} `);
  }
  expect(src).toContain("className={`sh-journey-step-body min-w-0 flex-1 ");
  // LAST keeps its title + eyebrow on every width; only the summary and timestamp carry the trim class
  expect(src).toMatch(/className="text-\[17px\] font-black text-shText leading-snug mt-0\.5 text-balance" data-testid="today-journey-last-title"/);
  expect((src.match(/sh-journey-last-detail /g) || []).length).toBe(2);
});

test("the trims live only under max-width 359px", () => {
  const at = css.indexOf(".sh-today-sub { display: none; }");
  expect(at).toBeGreaterThan(0);
  const before = css.slice(0, at);
  expect(before.lastIndexOf("@media (max-width: 359px)")).toBeGreaterThan(before.lastIndexOf(String.fromCharCode(10) + "}"));
  for (const rule of [".sh-journey-last-detail { display: none; }", ".sh-command-body { padding: 10px 12px 12px; }", ".sh-journey-rail { margin-top: 8px; }", ".sh-today-primary { margin-top: 8px; }"]) expect(css).toContain(rule);
});
