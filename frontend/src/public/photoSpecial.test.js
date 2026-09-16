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
  expect(pageSrc).toMatch(/includes\("taken"\)/);
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

test("the public page uses the site's own shell and styling", () => {
  expect(pageSrc).toMatch(/import PublicSiteShell from "\.\/PublicSiteShell"/);
  expect(pageSrc).toMatch(/import \{ Section, Title, Eyebrow, Cta \} from "\.\/PublicBits"/);
});

test("the public route is registered", () => {
  expect(appSrc).toMatch(/path="\/photo-specials\/:slug"/);
  expect(appSrc).toMatch(/import PublicPhotoSpecial from "\.\/public\/PublicPhotoSpecial"/);
});

// ------------------------------------------------------------------- admin

test("the admin tab is registered everywhere a tab has to be registered", () => {
  expect(appSrc).toMatch(/\{ id: "photo_specials", label: "Photo Specials", icon: "fa-[a-z-]+", perm: "manage_events" \}/);
  expect(appSrc).toMatch(/tab === "photo_specials" && navAllowed\("photo_specials"\) && <PhotoSpecials \/>/);
  expect(routesSrc).toMatch(/photo_specials: "\/admin\/photo-specials"/);
  expect(routesSrc).toMatch(/"photo-specials": "photo_specials"/);
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
  expect(roster).toMatch(/Register/);
  expect(roster).toMatch(/No show/);
  // and it is honest about the dog's real vaccine state
  expect(roster).toMatch(/Vaccine records: \{r\.vaccines_on_file \? "On file" : "Not on file"\}/);
});

test("the admin never implies the reservation priced anything", () => {
  expect(adminSrc).toMatch(/the Register still prices the sale/i);
  expect(adminSrc).not.toMatch(/total|subtotal|amount due/i);
});
