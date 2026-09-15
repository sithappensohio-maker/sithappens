/* Regression — segmented chip labels must stay inside their own chip.
 *
 * These selectors live inside narrow metric cards in the trainer session
 * workspace. They used to be laid out with VIEWPORT breakpoints
 * (`sm:grid-cols-5`), so on a wide screen a ~191px card was split into five
 * ~33px chips while a word like "MODERATE" needs ~71px. The label had no way
 * to fit and no way to break, so it spilled out of its button and landed on
 * top of the neighbouring chips' text.
 *
 * The contract these tests pin: chips are sized by the space the CARD has, a
 * chip may shrink, and a label that still cannot fit wraps rather than escapes.
 */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const SegmentedOptions = require("./SegmentedOptions.jsx").default;

const src = fs.readFileSync(path.join(__dirname, "SegmentedOptions.jsx"), "utf8");
const workspaceSrc = fs.readFileSync(path.join(__dirname, "..", "TrainingSessionWorkspaceBase.jsx"), "utf8");

const OPTIONS = [
  { value: "none", label: "None" },
  { value: "light", label: "Light" },
  { value: "moderate", label: "Moderate" },
  { value: "heavy", label: "Heavy" },
  { value: "full", label: "Full" },
];

test("chips are sized by the container, never by viewport breakpoints", () => {
  // auto-fit fits as many chips as the card can actually hold and wraps the
  // rest; a viewport breakpoint cannot see how wide the card is.
  expect(src).toMatch(/repeat\(auto-fit, minmax\(min\(\$\{minChipWidth\}px, 100%\), 1fr\)\)/);
  expect(src).not.toMatch(/sm:grid-cols-/);
  expect(src).not.toMatch(/\bcolumns\b/);
});

test("a chip can shrink and a long label can break, so text cannot escape the button", () => {
  // min-w-0 lets the grid item shrink below its longest word; without it a
  // `1fr` track is forced wider than the card and the row overflows.
  expect(src).toMatch(/min-w-0/);
  // break-words is the last-resort guard when a chip is narrower than a word
  // (a larger text-size setting, or a very narrow card).
  const labelSpans = src.match(/<span className="block break-words[^"]*"/g) || [];
  expect(labelSpans.length).toBe(2); // label and sublabel
});

test("the longest label these scales use still fits one line at the minimum chip width", () => {
  // "MODERATE" is the widest word across the distraction, handler-help and
  // leash scales. At 12px/0.02em bold it measures ~71px; the chip adds px-2
  // padding either side, so the default minimum must leave room for both.
  const minWidth = Number((src.match(/minChipWidth = (\d+)/) || [])[1]);
  const fontPx = Number((src.match(/text-\[(\d+(?:\.\d+)?)px\] font-black uppercase/) || [])[1]);
  expect(minWidth).toBeGreaterThanOrEqual(88);
  expect(fontPx).toBeLessThanOrEqual(12.5);
  // widest label ~71px at 12px + 16px horizontal padding = 87px
  expect(minWidth).toBeGreaterThanOrEqual(87);
});

test("the four workspace metric selectors no longer pass viewport column classes", () => {
  const calls = workspaceSrc.match(/<SegmentedOptions[\s\S]{0,400}?\/>/g) || [];
  expect(calls.length).toBe(4);
  for (const c of calls) {
    expect(c).not.toMatch(/columns=/);
    expect(c).not.toMatch(/grid-cols-/);
  }
});

test("every option still renders one tappable chip with its label", () => {
  const html = renderToStaticMarkup(
    React.createElement(SegmentedOptions, { options: OPTIONS, value: "moderate", onChange: () => {}, testid: "handler-level" }),
  );
  for (const o of OPTIONS) {
    expect(html).toContain(`data-testid="handler-level-${o.value}"`);
    expect(html).toContain(o.label);
  }
  // the selected chip is still the only highlighted one
  expect((html.match(/bg-shSecondary\/15/g) || []).length).toBe(1);
  // tap target floor is unchanged by the resize fix
  expect((html.match(/min-h-\[40px\]/g) || []).length).toBe(OPTIONS.length);
});
