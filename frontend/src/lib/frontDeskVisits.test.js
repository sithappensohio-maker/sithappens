import { classifyVisit, visitStatusLabel, visitCounts, filterVisits, sortVisits } from "./frontDeskVisits";

const expected = { booking_id: "b1", dog_name: "Bolt", client_name: "Jane Doe", dropoff_time: "09:00", time: "", checked_in_at: null, checked_out_at: null };
const onSite = { booking_id: "b2", dog_name: "Lexi", client_name: "Jane Doe", pickup_time: "17:00", checked_in_at: "2026-08-01T13:00:00Z", checked_out_at: null, is_missed_checkout: false };
const missed = { booking_id: "b3", dog_name: "Rex", client_name: "Sam Lee", pickup_time: "16:00", checked_in_at: "2026-07-31T13:00:00Z", checked_out_at: null, is_missed_checkout: true };
const checkedOut = { booking_id: "b4", dog_name: "Milo", client_name: "Sam Lee", checked_in_at: "2026-08-01T09:00:00Z", checked_out_at: "2026-08-01T11:00:00Z" };

test("classifyVisit buckets by checked_in_at/checked_out_at only", () => {
  expect(classifyVisit(expected)).toBe("expected");
  expect(classifyVisit(onSite)).toBe("on_site");
  expect(classifyVisit(checkedOut)).toBe("checked_out");
});

test("visitStatusLabel distinguishes On-Site from Missed Checkout", () => {
  expect(visitStatusLabel(expected)).toBe("Expected");
  expect(visitStatusLabel(onSite)).toBe("On-Site");
  expect(visitStatusLabel(missed)).toBe("Missed Checkout");
  expect(visitStatusLabel(checkedOut)).toBe("Checked Out");
});

test("visitCounts tallies each bucket", () => {
  expect(visitCounts([expected, onSite, missed, checkedOut])).toEqual({ expected: 1, on_site: 2, checked_out: 1 });
});

test("filterVisits narrows to one tab and to a name search", () => {
  const roster = [expected, onSite, missed, checkedOut];
  expect(filterVisits(roster, "expected", "").map((r) => r.booking_id)).toEqual(["b1"]);
  expect(filterVisits(roster, "on_site", "").map((r) => r.booking_id).sort()).toEqual(["b2", "b3"]);
  expect(filterVisits(roster, "all", "rex").map((r) => r.booking_id)).toEqual(["b3"]);
  // search matches client name too
  expect(filterVisits(roster, "all", "sam lee").map((r) => r.booking_id).sort()).toEqual(["b3", "b4"]);
});

test("sortVisits (expected) orders by drop-off time, then appointment time, then dog name", () => {
  const early = { ...expected, booking_id: "e1", dog_name: "Zed", dropoff_time: "08:00" };
  const late = { ...expected, booking_id: "e2", dog_name: "Ann", dropoff_time: "10:00" };
  const noTime = { ...expected, booking_id: "e3", dog_name: "Bea", dropoff_time: "" };
  expect(sortVisits([late, noTime, early], "expected").map((r) => r.booking_id)).toEqual(["e1", "e2", "e3"]);
});

test("sortVisits (on_site) puts missed checkouts first, then by pickup time", () => {
  const soon = { ...onSite, booking_id: "o1", pickup_time: "14:00" };
  const later = { ...onSite, booking_id: "o2", pickup_time: "18:00" };
  const missedRow = { ...missed, booking_id: "o3" };
  expect(sortVisits([later, soon, missedRow], "on_site").map((r) => r.booking_id)).toEqual(["o3", "o1", "o2"]);
});

test("sortVisits (checked_out) puts the most recently checked-out first", () => {
  const first = { ...checkedOut, booking_id: "c1", checked_out_at: "2026-08-01T10:00:00Z" };
  const latest = { ...checkedOut, booking_id: "c2", checked_out_at: "2026-08-01T15:00:00Z" };
  expect(sortVisits([first, latest], "checked_out").map((r) => r.booking_id)).toEqual(["c2", "c1"]);
});

test("sortVisits (all) groups Expected before On-Site before Checked Out", () => {
  const result = sortVisits([checkedOut, onSite, expected, missed], "all").map((r) => r.booking_id);
  expect(result[0]).toBe("b1"); // expected
  expect(result.slice(1, 3).sort()).toEqual(["b2", "b3"]); // on-site (missed first internally, checked above)
  expect(result[3]).toBe("b4"); // checked out
});
