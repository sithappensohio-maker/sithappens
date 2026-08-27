import { adminPathForTab, parseAdminLocation } from "./adminRoutes";

test("major admin destinations have durable canonical URLs", () => {
  expect(adminPathForTab("today")).toBe("/admin/today");
  expect(adminPathForTab("clients")).toBe("/admin/clients");
  expect(adminPathForTab("dogs")).toBe("/admin/dogs");
  expect(adminPathForTab("settings")).toBe("/admin/settings");
  expect(adminPathForTab("income")).toBe("/admin/finance");
});

test("Schedule and Training child destinations get nested URLs while retaining legacy tab ids", () => {
  expect(adminPathForTab("bookings")).toBe("/admin/schedule/bookings");
  expect(adminPathForTab("waitlist")).toBe("/admin/schedule/waitlist");
  expect(adminPathForTab("school_hq")).toBe("/admin/training/school");
  expect(adminPathForTab("homework")).toBe("/admin/training/practice");

  expect(parseAdminLocation("/admin/schedule/waitlist").tab).toBe("waitlist");
  expect(parseAdminLocation("/admin/training/practice").tab).toBe("homework");
});

test("client and dog records round-trip through direct URLs", () => {
  const dogPath = adminPathForTab("dogs", { kind: "dog", id: "dog 123", mode: "open" });
  expect(dogPath).toBe("/admin/dogs/dog%20123");
  expect(parseAdminLocation(dogPath)).toMatchObject({
    tab: "dogs",
    target: { kind: "dog", id: "dog 123", mode: "open" },
  });

  const clientPath = adminPathForTab("clients", { kind: "client", id: "client/42", mode: "scroll" });
  expect(clientPath).toBe("/admin/clients/client%2F42?focus=scroll");
  expect(parseAdminLocation("/admin/clients/client%2F42", "?focus=scroll")).toMatchObject({
    tab: "clients",
    target: { kind: "client", id: "client/42", clientId: "client/42", mode: "scroll" },
  });
});

test("booking and invoice deep links reopen the correct Client Hub record", () => {
  const booking = adminPathForTab("clients", { kind: "booking", id: "b1", clientId: "c1", mode: "open" });
  expect(booking).toBe("/admin/clients/c1/bookings/b1");
  expect(parseAdminLocation(booking).target).toEqual({ kind: "booking", id: "b1", clientId: "c1", mode: "open" });

  const invoice = adminPathForTab("clients", { kind: "invoice", id: "i1", clientId: "c1", mode: "open" });
  expect(invoice).toBe("/admin/clients/c1/invoices/i1");
  expect(parseAdminLocation(invoice).target).toEqual({ kind: "invoice", id: "i1", clientId: "c1", mode: "open" });
});

test("Settings subsections and category overviews have bookmarkable URLs", () => {
  expect(adminPathForTab("settings", { kind: "settings", section: "services" })).toBe("/admin/settings/services");
  expect(parseAdminLocation("/admin/settings/services").target).toEqual({ kind: "settings", section: "services" });
  expect(adminPathForTab("settings", { kind: "settings", section: "__overview__money" })).toBe("/admin/settings/category/money");
  expect(parseAdminLocation("/admin/settings/category/money").target).toEqual({ kind: "settings", section: "__overview__money" });
});

test("legacy and invalid admin URLs canonicalize safely to supported routes", () => {
  expect(parseAdminLocation("/admin/dashboard")).toMatchObject({ tab: "today", canonicalPath: "/admin/today", needsCanonicalRedirect: true });
  expect(parseAdminLocation("/admin/bookings")).toMatchObject({ tab: "bookings", canonicalPath: "/admin/schedule/bookings", needsCanonicalRedirect: true });
  expect(parseAdminLocation("/admin/not-a-screen")).toMatchObject({ tab: "today", canonicalPath: "/admin/today", needsCanonicalRedirect: true });
});
