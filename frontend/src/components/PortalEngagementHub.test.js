import { buildPortalActivity, buildPortalPriority, getDogPortalSnapshot, isActiveOnPremisesBooking, scopeBookingsToDogs } from "./PortalEngagementHub";

const dog = { id: "dog-1", name: "Lexi", vaccines: { rabies: "2099-01-01", bordetella: "2099-01-01", dhpp: "2099-01-01" } };
const today = new Date().toISOString().slice(0, 10);

test("setup lock always wins the priority card", () => {
  const priority = buildPortalPriority({
    dogs: [dog],
    messagesUnread: 3,
    setupStatus: { booking_locked: true },
  });
  expect(priority.kind).toBe("setup");
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
    date: yesterday.toISOString().slice(0, 10), end_date: tomorrow.toISOString().slice(0, 10),
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
