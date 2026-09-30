/* Guard for audit #47: a date is never read off toISOString() (the UTC
 * date, which is tomorrow from 8 PM Eastern) and "today" is never a private
 * copy of the device's date. Screens use lib/date's todayISO(), addDaysISO(),
 * businessDateOf() and localISOFromDate(). The mounted tests in
 * businessDateScreens / portalBusinessDate / businessDateComponents prove the
 * behaviour; this keeps the next screen from bringing the pattern back. */
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "..");
// Calendar arithmetic on a date that is already UTC-anchored; not "now".
const ALLOWED = { "screens/Schedule.jsx": 1, "components/PortalBookWizard.jsx": 1 };

function sources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "test") sources(p, out); }
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(SRC, p).split(path.sep).join("/");

test("no date is sliced off toISOString()", () => {
  const found = {};
  for (const file of sources(SRC)) {
    if (rel(file) === "lib/date.js") continue;   // the helper documents the old pattern
    const code = fs.readFileSync(file, "utf8");
    const n = (code.match(/toISOString\(\)\)?\s*\.\s*(slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|split\(\s*["']T["']\s*\)\s*\[\s*0\s*\])/g) || []).length;
    if (n) found[rel(file)] = n;
  }
  expect(found).toEqual(ALLOWED);
});

test("no screen keeps its own device-date copy of todayISO", () => {
  const copies = sources(SRC)
    .filter((f) => rel(f) !== "lib/date.js")
    .filter((f) => /(function\s+todayISO\s*\(|const\s+todayISO\s*=|const\s+isoDay\s*=)/.test(fs.readFileSync(f, "utf8")))
    .map(rel);
  expect(copies).toEqual([]);
});
