/* Stage 5 follow-up — the five client destinations must fit a 320px phone
 * without clipping. Layout is CSS, so this pins the contract: full words (no
 * icon-only tabs), the responsive label class + its 320px rule, no truncation
 * class that would silently clip, and a >= 56px touch target. */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const SchoolNav = require("./SchoolNav.jsx").default;
const { NAV_ITEMS } = require("./SchoolNav.jsx");

const css = fs.readFileSync(path.join(__dirname, "../../../index.css"), "utf8");

test("client navigation is the five full words, in order", () => {
  expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Today", "Course", "Practice", "Progress", "Coach"]);
  const html = renderToStaticMarkup(React.createElement(SchoolNav, { active: "feedback", onNavigate: () => {} }));
  for (const w of ["Today", "Course", "Practice", "Progress", "Coach"]) expect(html).toContain(`>${w}</span>`);
});

test("mobile tabs step the label down below 360px instead of truncating it", () => {
  const html = renderToStaticMarkup(React.createElement(SchoolNav, { active: "practice", onNavigate: () => {} }));
  const mobile = html.slice(html.indexOf('data-testid="school-nav-mobile"'));
  const labels = mobile.match(/<span class="[^"]*">[A-Za-z]+<\/span>/g) || [];
  expect(labels).toHaveLength(5);
  for (const l of labels) {
    expect(l).toMatch(/sh-school-tab-label/);
    expect(l).toMatch(/whitespace-nowrap/);
    expect(l).not.toMatch(/\btruncate\b/);
  }
  // The rule that makes "PRACTICE"/"PROGRESS" fit a 64px tab at 320px wide.
  expect(css).toMatch(/@media \(max-width: 359px\) \{\s*\.sh-school-tab-label \{ font-size: 11px; letter-spacing: 0; \}/);
  // Touch target and active state are unchanged.
  expect(mobile).toMatch(/min-h-\[56px\]/);
  expect(mobile).toMatch(/aria-current="page"[^>]*data-testid="school-nav-m-practice"/);
});
