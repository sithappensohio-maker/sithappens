import { buildPortalActivity, buildPortalPriority, getDogPortalSnapshot, isActiveOnPremisesBooking, scopeBookingsToDogs } from "./PortalEngagementHub";
import { localISOFromDate, todayISO } from "../lib/date";

const dog = { id: "dog-1", name: "Lexi", vaccines: { rabies: "2099-01-01", bordetella: "2099-01-01", dhpp: "2099-01-01" } };
// Booking `date` is a LOCAL calendar business date — derive it exactly the
// way the component does (lib/date's local-part helpers), never via
// toISOString(), which is UTC: between 8 p.m. and midnight Eastern the UTC
// date is already tomorrow, and this suite used to fail every evening.
// checked_in_at & friends stay UTC ISO strings — those are instants.
const today = todayISO();

test("setup lock never duplicates a card here — the separate Action Needed banner owns that message", () => {
  // buildPortalPriority intentionally ignores setupStatus entirely (see its
  // own comment): PortalNeedsAttentionCard's buildNeedsAttention is the real
  // component that shows "Finish your setup" first when setup is locked
  // (see PortalNeedsAttentionCard.test.js). This card falls through to its
  // own normal priority order regardless of booking_locked, so the two
  // never show the same "finish setup" copy twice on Home.
  const priority = buildPortalPriority({
    dogs: [dog],
    messagesUnread: 3,
    setupStatus: { booking_locked: true },
  });
  expect(priority.kind).toBe("messages");
});

test("checked-in visit is prioritized before homework and upcoming visits", () => {
  const priority = buildPortalPriority({
    dogs: [dog],
    bookings: [{ id: "b1", dog_id: dog.id, dog_name: dog.name, service_type: "daycare", checked_in_at: new Date().toISOString(), checked_out_at: null, status: "approved", date: today }],
    homework: [{ id: "h1", dog_id: dog.id, dog_name: dog.name, title: "Place", status: "assigned" }],
    setupStatus: { booking_locked: false },
  });
  expect(priority.kind).toBe("bookings");
  expect(priority.title).toContain("checked in");
});

test("dog snapshot surfaces missing vaccine records", () => {
  const snapshot = getDogPortalSnapshot({ id: "dog-2", name: "Charlie", vaccines: {} }, [], []);
  expect(snapshot.missingVaccines).toHaveLength(3);
  expect(snapshot.tone).toBe("orange");
});

test("activity feed sorts newest events first", () => {
  const activity = buildPortalActivity({
    bookings: [{ id: "b1", dog_name: "Lexi", service_type: "daycare", status: "approved", date: "2026-07-08", created_at: "2026-07-01T12:00:00Z" }],
    homework: [{ id: "h1", dog_name: "Lexi", title: "Place", status: "completed", created_at: "2026-07-01T12:00:00Z", completed_at: "2026-07-06T12:00:00Z" }],
    trophies: { client_trophies: [], dog_trophies: [] },
  });
  expect(activity[0].id).toBe("homework-h1");
});


test("recent report card does not create a duplicate checkout activity row", () => {
  const activity = buildPortalActivity({
    bookings: [{
      id: "b-report", dog_name: "Lexi", service_type: "daycare", status: "completed",
      date: "2026-07-06", checked_out_at: "2026-07-06T18:00:00Z",
      report_card: { created_at: "2026-07-06T18:05:00Z", photos: ["photo"] },
    }],
    homework: [],
    trophies: { client_trophies: [], dog_trophies: [] },
  });
  expect(activity.filter((item) => item.id.includes("b-report"))).toHaveLength(1);
  expect(activity[0].kind).toBe("report");
});

test("priority falls back to a direct booking action when nothing needs attention", () => {
  const priority = buildPortalPriority({
    dogs: [dog], bookings: [], homework: [], setupStatus: { booking_locked: false },
    credits: 5, trainingCredits: 5, boardingCredits: 5,
  });
  expect(priority.kind).toBe("book");
  expect(priority.title).toContain("Lexi");
});


test("stale or off-schedule check-in timestamps never show a dog as checked in", () => {
  expect(isActiveOnPremisesBooking({
    checked_in_at: new Date().toISOString(), checked_out_at: null,
    status: "approved", date: "2020-01-01",
  }, today)).toBe(false);

  expect(isActiveOnPremisesBooking({
    checked_in_at: new Date().toISOString(), checked_out_at: null,
    status: "cancelled", date: today,
  }, today)).toBe(false);

  const priority = buildPortalPriority({
    dogs: [dog],
    bookings: [{
      id: "stale", dog_id: dog.id, dog_name: dog.name, service_type: "daycare",
      checked_in_at: new Date().toISOString(), checked_out_at: null,
      status: "approved", date: "2020-01-01",
    }],
    setupStatus: { booking_locked: false },
  });
  expect(priority.title).not.toContain("checked in");
});

test("boarding is active when today falls inside the scheduled stay", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  expect(isActiveOnPremisesBooking({
    checked_in_at: new Date().toISOString(), checked_out_at: null, status: "approved",
    date: localISOFromDate(yesterday), end_date: localISOFromDate(tomorrow),
  }, today)).toBe(true);
});


test("portal status ignores active bookings that belong to a different dog", () => {
  const otherBooking = {
    id: "other-active", dog_id: "dog-someone-else", dog_name: "Not Lexi",
    service_type: "daycare", checked_in_at: new Date().toISOString(),
    checked_out_at: null, status: "approved", date: today,
  };
  expect(scopeBookingsToDogs([otherBooking], [dog])).toEqual([]);

  const priority = buildPortalPriority({
    dogs: [dog], bookings: [otherBooking], homework: [],
    setupStatus: { booking_locked: false }, credits: 5,
  });
  expect(priority.kind).toBe("book");
  expect(priority.title).not.toContain("checked in");
});

test("recent activity excludes bookings for dogs outside the portal account", () => {
  const activity = buildPortalActivity({
    dogs: [dog],
    bookings: [{
      id: "other-active", dog_id: "dog-someone-else", dog_name: "Not Lexi",
      service_type: "daycare", checked_in_at: new Date().toISOString(),
      checked_out_at: null, status: "approved", date: today,
    }],
    homework: [], trophies: { client_trophies: [], dog_trophies: [] },
  });
  expect(activity).toEqual([]);
});

test("pending booking with a check-in timestamp is not treated as on premises", () => {
  expect(isActiveOnPremisesBooking({
    checked_in_at: new Date().toISOString(), checked_out_at: null,
    status: "pending", date: today,
  }, today)).toBe(false);
});

// ── Business-date boundary regression (the 8 p.m.–midnight Eastern window) ──
// These freeze the clock at instants where the UTC calendar date has rolled
// over but America/New_York has not (on an Eastern-timezone machine — this
// project's dev/CI machines run US Eastern; on a UTC machine the instants are
// non-divergent and the tests still pass by fixture/component consistency).
// One summer (EDT, UTC-4) and one winter (EST, UTC-5) instant prove the
// derivation is timezone-aware rather than a hard-coded offset.
describe.each([
  ["EDT boundary", "2026-08-17T01:30:00Z"],   // Aug 16, 9:30 p.m. Eastern
  ["EST boundary", "2026-01-15T01:30:00Z"],   // Jan 14, 8:30 p.m. Eastern
])("checked-in priority at the %s", (_label, instant) => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date(instant)); });
  afterEach(() => { jest.useRealTimers(); });

  test("local-date fixture and component agree — booking still wins", () => {
    const frozenToday = todayISO(); // local calendar date at the frozen instant
    const priority = buildPortalPriority({
      dogs: [dog],
      bookings: [{ id: "b-b", dog_id: dog.id, dog_name: dog.name, service_type: "daycare",
                   checked_in_at: new Date().toISOString(), checked_out_at: null,
                   status: "approved", date: frozenToday }],
      homework: [{ id: "h-b", dog_id: dog.id, dog_name: dog.name, title: "Place", status: "assigned" }],
      setupStatus: { booking_locked: false },
    });
    expect(priority.kind).toBe("bookings");
    // And the old UTC derivation really is a DIFFERENT day at this instant on
    // an Eastern machine — the exact bug this suite used to have.
    const utcDate = new Date().toISOString().slice(0, 10);
    if (new Date().getTimezoneOffset() > 0) {
      expect(utcDate).not.toBe(frozenToday);
    }
  });
});
