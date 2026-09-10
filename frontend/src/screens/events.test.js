/**
 * @jest-environment jsdom
 */
// Public event preregistration — the wiring that must not drift: the public
// route is permanent and login-free, the admin tab is registered in all three
// places (nav, render, adminRoutes), the permission has labels, and the
// screens keep the door-day essentials.
import fs from "fs";
import path from "path";
import { padContestant, SUMMARY_CARDS } from "./Events";
import { fmtEventWhen, eventsNavItem, eventHref } from "../public/publicEvents";
import { adminPathForTab, parseAdminLocation } from "../lib/adminRoutes";
import { isoToLocalInput, localInputToIso, slugify, formFromEvent, payloadFromForm } from "../components/EventEditor";
import { upcomingEvents, isEventDay } from "../components/TodayEventsCard";
import { bannerImageUrl, flyerImageUrl } from "../public/publicEvents";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const app = read("..", "App.js");
const publicEvent = read("..", "public", "PublicEvent.jsx");
const events = read("Events.jsx");

describe("public event page", () => {
  test("/events/:slug is a public route, outside every auth gate", () => {
    expect(app).toMatch(/<Route path="\/events\/:slug" element=\{<AppProviders><PublicEvent \/><\/AppProviders>\} \/>/);
    const idx = app.indexOf('path="/events/:slug"');
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(app.indexOf('path="*"'));
  });
  test("preregistering never needs an account; a signed-in client is only prefilled", () => {
    expect(publicEvent).toMatch(/api\.post\(`\/public\/events\/\$\{slug\}\/register`/);
    expect(publicEvent).toMatch(/if \(!user \|\| user\.role !== "client"\) return undefined;/);
    expect(publicEvent).toMatch(/api\.get\("\/portal\/events\/prefill"\)/);
    expect(publicEvent).not.toMatch(/navigate\("\/login"\)/);
  });
  test("the form carries the required rules acknowledgment and a separate, unchecked marketing consent", () => {
    expect(publicEvent).toMatch(/data-testid="ev-rules" required/);
    expect(publicEvent).toMatch(/marketing_consent: false/);
    expect(publicEvent).toMatch(/data-testid="ev-marketing"/);
    expect(publicEvent).toMatch(/retractable leashes are not permitted/);
  });
  test("no adoption language anywhere on the event page", () => {
    expect(publicEvent.toLowerCase()).not.toMatch(/adopt/);
  });
  test("every 'how did you hear' option the owner asked for is offered", () => {
    for (const key of ["client", "facebook", "instagram", "local_business", "friend", "flyer", "other"]) {
      expect(publicEvent).toContain(`["${key}",`);
    }
  });
  test("fmtEventWhen splits a start/end into a day and a time range", () => {
    const r = fmtEventWhen({ start_at: "2026-10-24T14:00:00-04:00", end_at: "2026-10-24T17:00:00-04:00" });
    expect(r.day).toMatch(/2026/);
    expect(r.time).toMatch(/–/);
    expect(fmtEventWhen(null)).toBe("");
  });
});

describe("admin Events tab", () => {
  test("registered in nav, render and adminRoutes (the three places a tab needs)", () => {
    expect(app).toMatch(/\{ id: "events", label: "Events", icon: "fa-[a-z-]+", perm: "manage_events" \}/);
    expect(app).toMatch(/\{tab === "events" && navAllowed\("events"\) && <Events can=\{can\} \/>\}/);
    expect(app).toMatch(/ids: \["schedule", "bookings", "waitlist", "recurring", "events"\]/);
    expect(adminPathForTab("events")).toBe("/admin/events");
    expect(parseAdminLocation("/admin/events").tab).toBe("events");
  });
  test("the permission has labels in both places staff permissions are edited", () => {
    expect(read("..", "components", "RolesPanel.jsx")).toMatch(/manage_events: "/);
    expect(read("Settings.jsx")).toMatch(/\{ key: "manage_events",/);
  });
  test("summary cards are the eight the owner asked for, in order", () => {
    expect(SUMMARY_CARDS.map(([k]) => k)).toEqual(["households", "adults", "children", "people", "dogs", "costume_entries", "checked_in", "walk_ins"]);
  });
  test("contestant numbers are their own three-digit series, not the confirmation number", () => {
    expect(padContestant(14)).toBe("#014");
    expect(padContestant(null)).toBe("");
  });
  test("the door essentials: big check-in with undo, walk-in, costume roster, both CSVs", () => {
    expect(events).toMatch(/data-testid=\{`event-checkin-\$\{reg\.id\}`\}/);
    expect(events).toMatch(/data-testid=\{`event-undo-\$\{reg\.id\}`\}/);
    expect(events).toMatch(/api\.post\(`\/admin\/events\/\$\{event\.id\}\/walk-in`/);
    expect(events).toMatch(/\/admin\/events\/\$\{id\}\/costume-contest`/);
    expect(events).toMatch(/costume-contest\.csv/);
    expect(events).toMatch(/export\.csv/);
    // search is debounced, not per keystroke
    expect(events).toMatch(/setTimeout\(\(\) => loadRegs\(eventId, q\.trim\(\), statusFilter\), q \? 200 : 0\)/);
  });
});

describe("how people reach an event", () => {
  const shell = read("..", "public", "PublicSiteShell.jsx");
  const home = read("..", "public", "PublicHome.jsx");
  const portal = read("Portal.jsx");
  test("the site nav, drawer and footer grow an Events item only while something is on the calendar", () => {
    expect(eventsNavItem(null)).toBeNull();
    expect(eventsNavItem([])).toBeNull();
    expect(eventsNavItem([{ slug: "trunk-or-treat-2026" }])).toEqual({ key: "events", label: "Events", to: "/events/trunk-or-treat-2026" });
    expect(eventsNavItem([{ slug: "a" }, { slug: "b" }]).to).toBe("/events");
    expect(eventHref({ slug: "x" })).toBe("/events/x");
    expect(shell).toMatch(/const navItems = eventsItem \? \[\.\.\.PUBLIC_NAV, eventsItem\] : PUBLIC_NAV;/);
    expect(shell.match(/navItems\./g).length).toBe(3); // header, drawer, footer
    expect(shell).not.toMatch(/\{PUBLIC_NAV\.map/);
  });
  test("the homepage banner is the first thing on the page (above the hero) and the portal card sits under the quick actions", () => {
    expect(home).toMatch(/<UpcomingEventBanner \/>/);
    expect(home.indexOf("<UpcomingEventBanner />")).toBeLessThan(home.indexOf('data-testid="site-hero"'));
    expect(portal).toMatch(/<PortalEventCard \/>/);
    expect(portal.indexOf("<PortalEventCard />")).toBeGreaterThan(portal.indexOf('data-testid="portal-top-quick-actions"'));
    expect(app).toMatch(/<Route path="\/events" element=\{<AppProviders><PublicEvents \/><\/AppProviders>\} \/>/);
  });
  test("every surface reads the one shared upcoming-events list", () => {
    for (const f of [read("..", "public", "PublicEventBits.jsx"), read("..", "components", "PortalEventCard.jsx"), shell]) {
      expect(f).toMatch(/usePublicEvents\(\)/);
    }
  });
});

describe("event editor — every event is editable and reusable", () => {
  test("the editor round-trips an event: form ← event → payload keeps every field", () => {
    const ev = {
      name: "Sit Happens Doggy Trunk or Treat + Dog Costume Contest", slug: "trunk-or-treat-2026", name_line_1: "A", name_line_2: "B",
      description: "d", start_at: "2026-10-24T14:00:00-04:00", end_at: "2026-10-24T17:00:00-04:00", location_name: "L", location_address: "",
      admission: "free", capacity: null, registration_open: true, registration_closes_at: null, published: true, walk_ins_allowed: true,
      confirmation_prefix: "SH-TOT", features: { costume_contest: true, walk_ins: true },
      highlights: [{ icon: "fa-car-side", color: "#f26522", title: "Doggy Trunk or Treat", body: "x" }], rules: ["Leashed dogs only."],
      rules_acknowledgment: "I understand…", hero_image_url: "",
    };
    const f = formFromEvent(ev);
    expect(f.costume_contest).toBe(true);
    expect(f.highlights).toHaveLength(1);
    const out = payloadFromForm(f);
    expect(out.slug).toBe("trunk-or-treat-2026");
    expect(new Date(out.start_at).getTime()).toBe(new Date(ev.start_at).getTime());
    expect(new Date(out.end_at).getTime()).toBe(new Date(ev.end_at).getTime());
    expect(out.confirmation_prefix).toBe("SH-TOT");
    expect(out.highlights[0].title).toBe("Doggy Trunk or Treat");
    expect(out.rules).toEqual(["Leashed dogs only."]);
    expect(out.capacity).toBeNull();
    expect(out.registration_closes_at).toBeNull();
  });
  test("a new event starts unpublished with sensible defaults and a link name from its title", () => {
    const f = formFromEvent(null);
    expect(f.published).toBe(false);
    expect(f.rules.length).toBeGreaterThan(0);
    expect(slugify("Spring Fling 2027!")).toBe("spring-fling-2027");
    expect(payloadFromForm({ ...f, name: "Spring Fling 2027", start_at: "2027-04-10T13:00" }).slug).toBe("spring-fling-2027");
    expect(isoToLocalInput(null)).toBe("");
    expect(localInputToIso("")).toBeNull();
    expect(isoToLocalInput(localInputToIso("2027-04-10T13:00"))).toBe("2027-04-10T13:00");
  });
  test("the Events screen offers New / Edit only with edit_events, and reuses one editor for both", () => {
    expect(events).toMatch(/const canEdit = !!can\?\.\("edit_events"\);/);
    expect(events).toMatch(/\{canEdit && \([\s\S]*?data-testid="event-new"/);
    expect(events).toMatch(/\{canEdit && \([\s\S]*?data-testid="event-edit"/);
    expect(events).toMatch(/<EventEditor event=\{editor === "new" \? null : editor\}/);
    const editor = read("..", "components", "EventEditor.jsx");
    for (const t of ["event-editor-name", "event-editor-slug", "event-editor-start", "event-editor-end", "event-editor-published", "event-editor-open", "event-editor-costume", "event-editor-walkins", "event-editor-prefix", "event-editor-add-highlight", "event-editor-add-rule", "event-editor-ack", "event-editor-hero", "event-editor-capacity", "event-editor-closes", "event-editor-delete"]) {
      expect(editor).toContain(`testid="${t}"`); // plain inputs carry data-testid, Toggle/Field take a testid prop
    }
    expect(editor).toMatch(/api\.post\("\/admin\/events", body\)/);
    expect(editor).toMatch(/api\.put\(`\/admin\/events\/\$\{event\.id\}`, body\)/);
    expect(editor).toMatch(/api\.delete\(`\/admin\/events\/\$\{event\.id\}`\)/);
    expect(read("..", "components", "RolesPanel.jsx")).toMatch(/edit_events: "/);
    expect(read("Settings.jsx")).toMatch(/\{ key: "edit_events",/);
  });
});

describe("flyer QR code", () => {
  test("the dashboard shows the code for the event's public address and offers a print-size download", () => {
    expect(events).toMatch(/api\.get\(`\/admin\/events\/\$\{event\.id\}\/qr`, \{ params: \{ origin, size: 6 \}, responseType: "blob" \}\)/);
    // never an image-looking API path: production nginx would serve it statically (404)
    expect(events).not.toMatch(/\/qr\.png`/);
    expect(events).toMatch(/params: \{ origin, size: 30 \}/);
    expect(events).toMatch(/a\.download = `\$\{event\.slug\}-qr\.png`/);
    expect(events).toMatch(/<div className="mt-3"><EventQr event=\{event\} \/><\/div>/);
  });
});

describe("event page load states", () => {
  test("only a real 404 says the event isn't here; any other failure offers a retry", () => {
    expect(publicEvent).toMatch(/if \(e\.response\?\.status === 404\) setEv\(null\); else \{ setLoadFailed\(true\); setEv\(null\); \}/);
    expect(publicEvent).toMatch(/data-testid="event-load-failed"/);
    expect(publicEvent).toMatch(/testid="event-retry"/);
    expect(publicEvent.indexOf("ev === null && loadFailed")).toBeLessThan(publicEvent.indexOf('data-testid="event-not-found"'));
  });
});

describe("admin Today shows upcoming events", () => {
  test("the card is wired under the snapshot, gated on manage_events, and opens the Events tab", () => {
    const today = read("Today.jsx");
    expect(today).toMatch(/<TodayEventsCard can=\{can\} onNavigate=\{onNavigate\} refreshSignal=\{refreshSignal\} \/>/);
    expect(today.indexOf("<TodayEventsCard")).toBeGreaterThan(today.indexOf('data-testid="today-snapshot"'));
    expect(today.indexOf("<TodayEventsCard")).toBeLessThan(today.indexOf('data-testid="today-do-this-now"'));
    const card = read("..", "components", "TodayEventsCard.jsx");
    expect(card).toMatch(/const allowed = can\("manage_events"\);/);
    expect(card).toMatch(/onNavigate\("events"\)/);
    expect(card).toMatch(/api\.get\("\/admin\/events"\)/);
  });
  test("only events that haven't ended are listed, soonest first; event day is recognised", () => {
    const now = new Date("2026-10-24T15:00:00-04:00");
    const list = [
      { slug: "later", start_at: "2027-04-10T13:00:00-04:00", end_at: "2027-04-10T15:00:00-04:00" },
      { slug: "past", start_at: "2026-09-01T13:00:00-04:00", end_at: "2026-09-01T15:00:00-04:00" },
      { slug: "tot", start_at: "2026-10-24T14:00:00-04:00", end_at: "2026-10-24T17:00:00-04:00" },
    ];
    expect(upcomingEvents(list, now.getTime()).map((e) => e.slug)).toEqual(["tot", "later"]);
    expect(isEventDay(list[2], now)).toBe(true);
    expect(isEventDay(list[0], now)).toBe(false);
  });
});

describe("banner background picture", () => {
  test("the banner points at the public image route (no file extension) only when a picture exists", () => {
    expect(bannerImageUrl({ slug: "trunk-or-treat-2026", banner_image_version: "ab12cd34" })).toMatch(/\/api\/public\/events\/trunk-or-treat-2026\/images\/banner\?v=ab12cd34$/);
    expect(flyerImageUrl({ slug: "trunk-or-treat-2026", flyer_image_version: "ff00ff00" })).toMatch(/\/images\/flyer\?v=ff00ff00$/);
    expect(flyerImageUrl({ slug: "x", banner_image_version: "ab12cd34" })).toBeNull();
    expect(bannerImageUrl({ slug: "x", banner_image_version: null })).toBeNull();
    const bits = read("..", "public", "PublicEventBits.jsx");
    expect(bits).toMatch(/data-testid="site-event-banner-image"/);
    expect(bits).toMatch(/rgba\(3,7,30,\.62\)/); // the dark wash that keeps the words readable
  });
  test("the editor uploads/removes through the admin routes and refreshes without closing", () => {
    const editor = read("..", "components", "EventEditor.jsx");
    expect(editor).toMatch(/api\.post\(`\/admin\/events\/\$\{event\.id\}\/images\/\$\{kind\}`, \{ data, filename: file\.name \}\)/);
    expect(editor).toMatch(/api\.delete\(`\/admin\/events\/\$\{event\.id\}\/images\/\$\{kind\}`\)/);
    expect(editor).toMatch(/accept="image\/jpeg,image\/png,image\/webp"/);
    // both pictures use the one upload field
    expect(editor).toMatch(/<EventImageField kind="flyer"/);
    expect(editor).toMatch(/<EventImageField kind="banner"/);
    // the event page prefers the uploaded flyer, then a pasted link, then the logo card
    expect(publicEvent).toMatch(/\(flyerImageUrl\(ev\) \|\| ev\.hero_image_url\)/);
    expect(events).toMatch(/onChanged=\{\(data\) => \{/);
  });
});
