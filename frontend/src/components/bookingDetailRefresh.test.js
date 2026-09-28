/**
 * Every screen that opens the booking details refreshes itself after a dog is
 * added to or taken out of a booking, or its bill is made there (friends &
 * family, owner request 2026-09-28) — otherwise the dogs on the board are
 * stale (a removed dog still offered for check-in, an added one missing).
 */
const fs = require("fs");
const path = require("path");
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

test.each([
  ["components/TodayOperations.jsx", "onChanged={reloadAll}"],
  ["screens/Bookings.jsx", "onChanged={load}"],
  ["screens/Dashboard.jsx", "onChanged={load}"],
  ["screens/RunSheet.jsx", "onChanged={() => load(date)}"],
  ["screens/Schedule.jsx", "onChanged={() => load()}"],
])("%s passes a refresh to the booking details", (file, wiring) => {
  const src = read("..", ...file.split("/"));
  const at = src.indexOf("<BookingDetailModal");
  expect(at).toBeGreaterThan(-1);
  expect(src.slice(at, at + 300)).toContain(wiring);
});
