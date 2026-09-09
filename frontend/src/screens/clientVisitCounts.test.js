// Clients directory cards show lifetime visits from one batch call per page.
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "Clients.jsx"), "utf8");

test("one batch request per page of cards, never one per client, never counted in the browser", () => {
  expect(src).toMatch(/api\.get\("\/admin\/client-visit-counts", \{ params: \{ client_ids: ids\.join\(","\) \} \}\)/);
  expect(src).toMatch(/await loadTrophies\(rows\);\s*loadVisits\(rows\);/);
  expect((src.match(/\/admin\/client-visit-counts/g) || []).length).toBe(1);
  expect(src).not.toMatch(/\/clients\/\$\{c\.id\}\/visits/);
});

test("the Visits stat sits first in the card's stats row with the award tier under it", () => {
  const row = src.indexOf('flex flex-wrap gap-x-4 gap-y-3 border-t border-shBorder pt-3');
  const visits = src.indexOf('tracking-widest">Visits</p>');
  const daycare = src.indexOf('tracking-widest">Daycare</p>');
  expect(row).toBeGreaterThan(-1);
  expect(visits).toBeGreaterThan(row);
  expect(daycare).toBeGreaterThan(visits);
  expect(src).toMatch(/data-testid=\{`visit-count-\$\{c\.id\}`\}>\{visitMap\[c\.id\] \? visitMap\[c\.id\]\.visits : "—"\}/);
  expect(src).toMatch(/data-testid=\{`visit-tier-\$\{c\.id\}`\}/);
  expect(src).toMatch(/\$\{visitMap\[c\.id\]\.next\.remaining\} to \$\{visitMap\[c\.id\]\.next\.name\}/);
});
