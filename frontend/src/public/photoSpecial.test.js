/* Photo Specials — the public mini-session page and its admin.
 *
 * Pins the parts a customer actually depends on: the page is driven entirely
 * by one configurable special (so Christmas is a new row, not a new build),
 * it tells the truth when a session is full or closed, the flow is four small
 * steps rather than one long form, a resubmit cannot take a second slot, and
 * the confirmation puts the date and time above everything else. */
const fs = require("fs");
const path = require("path");

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const pageSrc = read("PublicPhotoSpecial.jsx");
const adminSrc = read("..", "screens", "PhotoSpecials.jsx");
const appSrc = read("..", "App.js");
const routesSrc = read("..", "lib", "adminRoutes.js");

test("the page is driven by the special's own configuration, not by Halloween", () => {
  // Nothing about this page may be specific to one event.
  expect(pageSrc).not.toMatch(/halloween/i);
  expect(pageSrc).not.toMatch(/howl-?o-?ween/i);
  for (const field of ["special.name", "special.dates", "special.slot_minutes", "special.location_name", "special.headline"]) {
    expect(pageSrc).toContain(field);
  }
});

test("it reads the special and its availability from the public endpoints", () => {
  expect(pageSrc).toMatch(/api\.get\(`\/public\/photo-specials\/\$\{slug\}`\)/);
  expect(pageSrc).toMatch(/api\.get\(`\/public\/photo-specials\/\$\{slug\}\/availability`/);
  expect(pageSrc).toMatch(/api\.post\(`\/public\/photo-specials\/\$\{slug\}\/reserve`/);
});

test("the flow is date, then time, then details, then review", () => {
  expect(pageSrc).toMatch(/STEPS = \["date", "time", "details", "review"\]/);
  for (const step of ["photo-special-step-date", "photo-special-step-time", "photo-special-step-details", "photo-special-step-review"]) {
    expect(pageSrc).toContain(step);
  }
});

test("a resubmitted booking cannot quietly take a second slot", () => {
  // One key per visit, sent with the reservation.
  expect(pageSrc).toMatch(/const \[idemKey\] = useState/);
  expect(pageSrc).toMatch(/idempotency_key: idemKey/);
});

test("sold out and booking closed are real states, not an empty grid", () => {
  expect(pageSrc).toContain('data-testid="photo-special-sold-out"');
  expect(pageSrc).toContain('data-testid="photo-special-closed"');
  expect(pageSrc).toMatch(/Fully booked/);
  expect(pageSrc).toMatch(/Booking closed/);
});

test("losing a slot while the form is open puts the customer back on a fresh grid", () => {
  // Driven by the server's fix-it code, never by matching words in the
  // message (the old `includes("taken")` never fired: the message it read
  // was "AxiosError: Request failed with status code 409"). Behaviour is
  // mounted in photoSpecialErrors.test.js.
  expect(pageSrc).not.toMatch(/includes\("taken"\)/);
  expect(pageSrc).toMatch(/action === "pick_time"/);
  expect(pageSrc).toMatch(/setStep\("time"\); setTime\(""\); loadSlots\(day\)/);
});

test("an unavailable time cannot be tapped", () => {
  expect(pageSrc).toMatch(/disabled=\{!s\.available\}/);
});

test("the confirmation makes the date and time the loudest thing on the screen", () => {
  const conf = pageSrc.slice(pageSrc.indexOf('testid="photo-special-confirmed"'));
  expect(conf).toContain('data-testid="photo-special-when"');
  // the time is the largest type on the page
  expect(conf).toMatch(/text-\[30px\] sm:text-\[44px\][^>]*>\{fmtTime\(confirmed\.time\)\}/);
  expect(conf).toMatch(/\{fmtDay\(confirmed\.date\)\}/);
  expect(conf).toMatch(/\{confirmed\.dog_name\}/);
  expect(conf).toMatch(/Pay at your session/);
});

test("the page says plainly that nothing is charged to book", () => {
  expect(pageSrc).toMatch(/Nothing is charged now/);
  expect(pageSrc).toMatch(/you&apos;ll pay at your session|pay at your session/i);
  // and it never tries to be a checkout
  expect(pageSrc).not.toMatch(/stripe|card_number|deposit|payment_intent/i);
});

test("it asks only what is needed, including the one question about the dog", () => {
  for (const id of ["photo-special-first-name", "photo-special-phone", "photo-special-email", "photo-special-dog-name"]) {
    expect(pageSrc).toContain(id);
  }
  expect(pageSrc).toMatch(/Anything we should know about your dog before the session\?/);
  expect(pageSrc).toMatch(/Nervous around strangers/);
  // one dog per appointment is stated where the booking is made
  expect(pageSrc).toMatch(/One dog per appointment/);
});

test("tap targets on the slot and date grids are big enough for a phone", () => {
  const slotBtn = pageSrc.slice(pageSrc.indexOf('data-testid={`photo-special-slot-'));
  expect(slotBtn).toMatch(/min-h-\[52px\]/);
  const dateBtn = pageSrc.slice(pageSrc.indexOf('data-testid={`photo-special-date-'));
  expect(dateBtn).toMatch(/min-h-\[52px\]/);
});

test("the hero fits a portrait flyer as well as a wide one", () => {
  // The flyer sets its own shape. A tall poster must not be cropped to a
  // letterbox, and must not eat the whole screen on a short phone either.
  const hero = pageSrc.slice(pageSrc.indexOf('data-testid="photo-special-hero-image"') - 400,
                             pageSrc.indexOf('data-testid="photo-special-hero-image"'));
  expect(hero).toMatch(/object-contain/);
  expect(hero).not.toMatch(/object-cover/);
  expect(hero).toMatch(/w-auto max-w-full/);
  expect(hero).toMatch(/max-h-\[min\(70vh,560px\)\]/);
  expect(hero).toMatch(/mx-auto/);
});

test("the public page uses the site's own shell and styling", () => {
  expect(pageSrc).toMatch(/import PublicSiteShell from "\.\/PublicSiteShell"/);
  expect(pageSrc).toMatch(/import \{ Section, Title, Eyebrow, Cta \} from "\.\/PublicBits"/);
});

test("the public route is registered", () => {
  expect(appSrc).toMatch(/path="\/photo-specials\/:slug"/);
  expect(appSrc).toMatch(/import PublicPhotoSpecial from "\.\/public\/PublicPhotoSpecial"/);
});

// ------------------------------------------------------------------- admin

test("the admin tab is registered in all FOUR places a tab has to be registered", () => {
  // Four, not three. An earlier version of this test checked the first three
  // and passed while the tab was invisible in the running app, because the
  // sidebar renders from NAV_GROUPS and nothing had put the tab in a group.
  expect(appSrc).toMatch(/\{ id: "photo_specials", label: "Photo Specials", icon: "fa-[a-z-]+", perm: "manage_events" \}/);
  expect(appSrc).toMatch(/tab === "photo_specials" && navAllowed\("photo_specials"\) && <PhotoSpecials can=\{can\} \/>/);
  expect(routesSrc).toMatch(/photo_specials: "\/admin\/photo-specials"/);
  expect(routesSrc).toMatch(/"photo-specials": "photo_specials"/);

  const groups = appSrc.slice(appSrc.indexOf("const NAV_GROUPS = ["), appSrc.indexOf("];", appSrc.indexOf("const NAV_GROUPS = [")));
  expect(groups).toContain('"photo_specials"');
});

test("every sidebar-visible admin tab actually belongs to a nav group", () => {
  // The general version of the same bug: a tab defined but never grouped is
  // reachable only by typing its URL, which is indistinguishable from "the
  // feature was never deployed".
  const tabsBlock = appSrc.slice(appSrc.indexOf('{ id: "today", label: "Today"'));
  const tabsEnd = tabsBlock.indexOf("\n  ];");
  const tabs = [...tabsBlock.slice(0, tabsEnd).matchAll(/\{ id: "([a-z_]+)"[^}]*\}/g)]
    .filter((m) => !/sidebar: false/.test(m[0]))
    .map((m) => m[1]);
  const groups = appSrc.slice(appSrc.indexOf("const NAV_GROUPS = ["), appSrc.indexOf("];", appSrc.indexOf("const NAV_GROUPS = [")));
  const ungrouped = tabs.filter((id) => !groups.includes(`"${id}"`));
  expect(ungrouped).toEqual([]);
});

test("admin can configure everything the event needs without a code change", () => {
  for (const id of ["photo-special-name", "photo-special-dates", "photo-special-start", "photo-special-end",
                    "photo-special-slot-minutes", "photo-special-max", "photo-special-open",
                    "photo-special-published", "photo-special-packages"]) {
    expect(adminSrc).toContain(id);
  }
  expect(adminSrc).toMatch(/hero-image/);
});

test("the event-day list gives the desk the actions it needs", () => {
  const roster = adminSrc.slice(adminSrc.indexOf('data-testid="photo-special-roster"'));
  expect(roster).toMatch(/Client/);
  // Photo packages are rung up from the reservation itself (through the register).
  expect(roster).toMatch(/Photo order/);
  expect(roster).toMatch(/No show/);
  // and it is honest about the dog's real vaccine state
  expect(roster).toMatch(/Vaccine records: \{r\.vaccines_on_file \? "On file" : "Not on file"\}/);
});

test("the admin never implies the reservation priced anything", () => {
  expect(adminSrc).toMatch(/the Register still prices the sale/i);
  expect(adminSrc).not.toMatch(/total|subtotal|amount due/i);
});

// --------------------------------------------------- schedule configuration

test("a special can run on a date range with different hours by day of week", () => {
  // The Howl-O-Ween promotion runs six weeks with 4–7pm weekdays and
  // 7am–7pm weekends. Typing 46 dates by hand is not a schedule editor.
  for (const id of ["photo-special-start-date", "photo-special-end-date"]) {
    expect(adminSrc).toContain(id);
  }
  expect(adminSrc).toContain('data-testid={`photo-special-hours-${testid}`}');
  expect(adminSrc).toMatch(/days=\{WEEKDAYS\} testid="weekday"/);
  expect(adminSrc).toMatch(/days=\{WEEKEND\} testid="weekend"/);
  expect(adminSrc).toMatch(/const WEEKDAYS = DAY_KEYS\.slice\(0, 5\)/);
  expect(adminSrc).toMatch(/const WEEKEND = DAY_KEYS\.slice\(5\)/);
  // editing a group writes every day in it, so Mon–Fri is one action
  expect(adminSrc).toMatch(/for \(const d of days\) next\[d\] = \{ \.\.\.\(next\[d\] \|\| \{\}\), \.\.\.patch \}/);
});

test("the schedule controls still fit on a 320px phone", () => {
  // A native date or time input has a floor of roughly 90px, so three of them
  // on one line is an overflow, not a layout. They wrap instead.
  const sched = adminSrc.slice(adminSrc.indexOf('data-testid="photo-special-schedule"'));
  expect(sched).toMatch(/grid-cols-1 min-\[360px\]:grid-cols-2/);
  const group = adminSrc.slice(adminSrc.indexOf("function HoursGroup"));
  expect(group).toMatch(/flex flex-wrap items-center gap-2/);
  expect(group).toMatch(/flex-1 basis-\[190px\] min-w-0/);
  expect(sched).toMatch(/flex-1 basis-\[92px\] min-w-0/);
});

test("the group control admits when the days underneath it disagree", () => {
  // Otherwise one odd Wednesday silently shows as if it were all five days.
  expect(adminSrc).toContain('data-testid={`photo-special-${testid}-mixed`}');
  expect(adminSrc).toMatch(/These days currently differ/);
});

test("a single day can be skipped without dismantling the schedule", () => {
  expect(adminSrc).toContain('data-testid="photo-special-closed-dates"');
  expect(adminSrc).toMatch(/skip a day without changing the range/);
  // and per-day exceptions are still reachable
  expect(adminSrc).toContain('data-testid="photo-special-per-day"');
  expect(adminSrc).toContain('data-testid={`photo-special-closed-${d}`}');
  expect(adminSrc).toMatch(/const DAY_KEYS = \["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"\]/);
});

test("explicit dates remain available for a one-off event, and win", () => {
  expect(adminSrc).toContain('data-testid="photo-special-explicit-dates"');
  expect(adminSrc).toContain('data-testid="photo-special-dates"');
  expect(adminSrc).toMatch(/if you fill this in, it wins/i);
});

test("a new special starts on the rules, not on a list of dates", () => {
  const blank = adminSrc.slice(adminSrc.indexOf("const BLANK = {"), adminSrc.indexOf("};", adminSrc.indexOf("const BLANK = {")));
  expect(blank).toMatch(/start_date: null, end_date: null, day_hours: \{\}, closed_dates: \[\]/);
  expect(blank).toMatch(/slot_minutes: 15/);
});

test("a six-week run is described as a range, not as dozens of pills", () => {
  // Public page: the hero summarises, the picker offers a fortnight up front.
  expect(pageSrc).toContain('data-testid="photo-special-date-range"');
  expect(pageSrc).toMatch(/const DATE_PREVIEW = 14/);
  expect(pageSrc).toContain('data-testid="photo-special-more-dates"');
  expect(pageSrc).toMatch(/setAllDates\(true\)/);
  // every date stays reachable — nothing is dropped
  expect(pageSrc).toMatch(/allDates \? dates : dates\.slice\(0, DATE_PREVIEW\)/);
});

test("the event-day list opens on today when the special is running", () => {
  // A promotion that started in September must not open on its first date.
  expect(adminSrc).toMatch(/const running = data\.special\?\.dates \|\| sp\.running_dates \|\| sp\.dates \|\| \[\]/);
  expect(adminSrc).toMatch(/running\.includes\(today\) \? today : running\[0\]/);
  expect(adminSrc).toContain('data-testid="photo-special-roster-days"');
});

describe("photo orders on a special", () => {
  test("each special edits its own price list with the shared package editor", () => {
    expect(adminSrc).toMatch(/import PhotoPackagesEditor, \{ fromPackageRows, toPackageRows \} from "\.\.\/components\/PhotoPackagesEditor"/);
    expect(adminSrc).toMatch(/<PhotoPackagesEditor packages=\{editing\.photo_packages \|\| \[\]\} testid="photo-special"/);
    expect(adminSrc).toMatch(/photo_packages: fromPackageRows\(editing\.photo_packages\)/);
    for (const t of ["photo-special-photos-title", "photo-special-order-prefix"]) expect(adminSrc).toContain(`data-testid="${t}"`);
  });

  test("orders ride the same panel as the event photo booth, pointed at the special", () => {
    expect(adminSrc).toMatch(/import \{ PhotoOrdersPanel \} from "\.\.\/components\/EventPhotosPanel"/);
    expect(adminSrc).toMatch(/base=\{`\/admin\/photo-specials\/\$\{ordersFor\.id\}`\}/);
    expect(appSrc).toMatch(/<PhotoSpecials can=\{can\} \/>/);
  });

  test("a reservation starts a prefilled order tied to its booking, and shows what was bought", () => {
    expect(adminSrc).toMatch(/data-testid=\{`photo-special-order-\$\{r\.booking_id\}`\}/);
    expect(adminSrc).toMatch(/setStartOrder\(\{ booking_id: r\.booking_id/);
    expect(adminSrc).toMatch(/\(r\.photo_orders \|\| \[\]\)\.map/);
  });

  test("the public page shows the same price list the desk sells", () => {
    expect(pageSrc).toContain('data-testid="photo-special-price-list"');
    expect(pageSrc).toMatch(/special\.packages\.map/);
  });
});
