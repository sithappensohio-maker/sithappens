/**
 * Awards reworked into the School system:
 *  - School Progress "Achievements" shows the owner's client trophies
 *    (Practice streaks / completions / visit tiers) next to the dog's.
 *  - Settings → Trophies speaks School Practice and can re-run auto awards.
 */
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const progress = read("school", "student", "ProgressScreen.jsx");
const trophies = read("..", "screens", "Trophies.jsx");

test("School Progress merges client trophies into Achievements", () => {
  expect(progress).toMatch(/\.\.\.\(t\.data\?\.client_trophies \|\| \[\]\)/);
  expect(progress).toMatch(/t\.recipient_type === "client" \|\|/);
});

test("Trophy catalog labels describe School Practice and archived-visit counting", () => {
  expect(trophies).toMatch(/homework_streak_days", label: "Client: School Practice streak/);
  expect(trophies).toMatch(/homework_completed", label: "Client: School Practice assignments completed"/);
  expect(trophies).toMatch(/visit_count", label: "Client: Total visits \(all dogs, incl\. archived bookings\)"/);
  expect(trophies).not.toMatch(/Homework total completed/);
});

test("Trophy catalog exposes the admin re-check sweep", () => {
  expect(trophies).toMatch(/api\.post\("\/admin\/trophies\/recheck"\)/);
  expect(trophies).toMatch(/data-testid="recheck-awards-button"/);
  expect(trophies).toMatch(/data-testid="recheck-awards-result"/);
});
