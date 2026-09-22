/* Stage 1 — the four customer-blocking contradictions, pinned.
 *
 * Each block below fails if the specific bug the audit found comes back. They
 * are written against the shared modules rather than against rendered strings,
 * because the whole point of Stage 1 was to make several screens read from one
 * source instead of each deciding for itself.
 */
import { vaccineState, vaccineSummary, dogVaccineRollup, VACCINE_STATES, humanDate } from "./vaccineStatus";
import { outcomeForService, outcomeForBooking, reviewPromise, successHeadline, CONFIRMED, REQUESTED } from "./bookingOutcome";
import { humanizeValidationMessage } from "./api";
import { blockerHeadline, blockerNextLine, blockingSteps } from "../components/PortalBookingBlockedModal";
import { buildNeedsAttention } from "../components/PortalNeedsAttentionCard";
import { portalGreeting, portalGreetingSubtitle, isEstablishedClient } from "./portalGreeting";

const TODAY = "2026-09-22";
const pendingCert = { status: "pending_review", pending_expires_on: "2027-06-30" };

describe("a vaccine the client already uploaded is never called Missing", () => {
  test("an uploaded-but-unreviewed certificate reads as pending, not missing", () => {
    const dog = { name: "Maple", vaccines: { rabies: "" }, vaccine_certs: { rabies: pendingCert } };
    expect(vaccineState(dog, "rabies", TODAY).state).toBe(VACCINE_STATES.PENDING);
    // The exact regression: the old card read `vaccines.rabies || "Missing"`.
    expect(vaccineSummary(dog, "rabies", TODAY).text).not.toMatch(/missing/i);
    expect(vaccineSummary(dog, "rabies", TODAY).text).toMatch(/pending review/i);
  });

  test("the other three states stay distinct", () => {
    const approved = { vaccines: { rabies: "2027-06-30" } };
    const expired = { vaccines: { rabies: "2020-01-01" } };
    const missing = { vaccines: {} };
    expect(vaccineState(approved, "rabies", TODAY).state).toBe(VACCINE_STATES.APPROVED);
    expect(vaccineState(expired, "rabies", TODAY).state).toBe(VACCINE_STATES.EXPIRED);
    expect(vaccineState(missing, "rabies", TODAY).state).toBe(VACCINE_STATES.MISSING);
  });

  test("an approved record wins over a stale pending cert for the same vaccine", () => {
    const dog = { vaccines: { rabies: "2027-06-30" }, vaccine_certs: { rabies: pendingCert } };
    expect(vaccineState(dog, "rabies", TODAY).state).toBe(VACCINE_STATES.APPROVED);
  });

  test("the photo-free flag from GET /dogs is honoured, not just the full cert", () => {
    // The list endpoint never sends vaccine_certs (a certificate carries a
    // base64 photo). Without this the card could not tell "never received"
    // from "received, not looked at yet" — which is the whole bug.
    const listRow = { name: "Rosie", vaccines: { rabies: "" }, vaccines_pending_review: { rabies: true } };
    expect(vaccineState(listRow, "rabies", TODAY).state).toBe(VACCINE_STATES.PENDING);
    expect(vaccineSummary(listRow, "rabies", TODAY).text).not.toMatch(/missing/i);
  });

  test("an admin-entered cert is not treated as a client upload awaiting review", () => {
    const dog = { vaccines: {}, vaccine_certs: { rabies: { ...pendingCert, uploaded_by_admin: true } } };
    expect(vaccineState(dog, "rabies", TODAY).state).toBe(VACCINE_STATES.MISSING);
  });

  test("the card rollup reports 'with us' rather than 'needs vaccines' once everything is in", () => {
    const dog = {
      vaccines: {},
      vaccine_certs: { rabies: pendingCert, bordetella: pendingCert, dhpp: pendingCert },
    };
    expect(dogVaccineRollup(dog, ["rabies", "bordetella", "dhpp"], TODAY)).toBe(VACCINE_STATES.PENDING);
  });

  test("dates are shown to humans, never as raw ISO", () => {
    expect(humanDate("2027-06-30")).not.toBe("2027-06-30");
    expect(humanDate("2027-06-30")).toMatch(/2027/);
  });
});

describe("the dashboard cannot say 'all caught up' while booking is locked", () => {
  const base = { client: { account_balance: 0 }, dogs: [{ id: "d1", name: "Maple" }], bookings: [], messagesUnread: 0 };

  test("uploaded-and-waiting produces a 'we're reviewing' card, not the welcome state", () => {
    // This is the exact payload that used to fall through every branch: no
    // `missing` entries, so nothing matched, so the card said "You're all
    // caught up" while the booking gate said locked.
    const setupStatus = {
      booking_locked: true, ready_to_book: false, completed_count: 4, total_count: 6,
      steps: [
        { id: "client_info", status: "complete" },
        { id: "emergency", status: "complete" },
        { id: "dog_info", status: "complete" },
        { id: "waiver", status: "complete" },
        { id: "vaccines", status: "pending_review", missing: [], awaiting_review: ["Maple: rabies"], action_label: "Upload Vaccine Records" },
        { id: "intake_forms", status: "complete", optional: true },
      ],
    };
    const item = buildNeedsAttention({ setupStatus, ...base });
    expect(item.title).not.toMatch(/all caught up/i);
    expect(item.title).toMatch(/reviewing/i);
    expect(item.text).toMatch(/Maple: rabies/);
  });

  test("any unhandled locked state still refuses to claim the client is done", () => {
    // A step id this card has no branch for. The old fallback said "You're all
    // caught up"; the gate must now have the last word.
    const setupStatus = {
      booking_locked: true, ready_to_book: false, completed_count: 5, total_count: 6,
      steps: [{ id: "something_new", status: "in_progress", label: "New requirement", action_label: "Do it", action_target: "profile" }],
    };
    const item = buildNeedsAttention({ setupStatus, ...base });
    expect(item.title).not.toMatch(/all caught up/i);
    expect(item.title).toMatch(/unlock booking/i);
  });

  test("a genuinely ready client still gets the welcome state", () => {
    const setupStatus = { booking_locked: false, ready_to_book: true, completed_count: 6, total_count: 6, steps: [] };
    expect(buildNeedsAttention({ setupStatus, ...base }).title).toMatch(/all caught up/i);
  });
});

describe("booking status is whatever the service is actually configured to do", () => {
  test("an instant-book service promises a held slot", () => {
    expect(outcomeForService({ books_as: "approved" })).toBe(CONFIRMED);
    expect(reviewPromise(CONFIRMED)).toMatch(/held for you/i);
    expect(reviewPromise(CONFIRMED)).not.toMatch(/review/i);
  });

  test("an approval-required service promises a request", () => {
    expect(outcomeForService({ books_as: "pending" })).toBe(REQUESTED);
    expect(reviewPromise(REQUESTED)).toMatch(/request/i);
  });

  test("nothing is promised when the server hasn't said", () => {
    expect(outcomeForService({})).toBeNull();
    expect(reviewPromise(null)).toBeNull();
  });

  test("the success headline follows the created booking, not a guess", () => {
    expect(successHeadline(outcomeForBooking({ status: "approved" }))).toMatch(/booked/i);
    expect(successHeadline(outcomeForBooking({ status: "pending" }))).toMatch(/request/i);
    // The precise old bug: daycare auto-approved, yet the screen said
    // "Booking submitted! We'll review and confirm your spot shortly."
    expect(successHeadline(CONFIRMED)).not.toMatch(/submitted/i);
  });

  test("waitlisting outranks either outcome", () => {
    expect(successHeadline(CONFIRMED, { waitlisted: true })).toMatch(/waitlist/i);
  });
});

describe("a refused booking explains itself before the wizard opens", () => {
  const vaccinesPending = {
    id: "vaccines", status: "pending_review", label: "Vaccine Records",
    missing: [], awaiting_review: ["Maple: rabies"], action_label: "Upload Vaccine Records", action_target: "vaccines",
  };

  test("it names what is blocking, in the client's own terms", () => {
    expect(blockerHeadline(vaccinesPending)).toMatch(/Maple: rabies/);
    expect(blockerHeadline(vaccinesPending)).toMatch(/waiting for our review/i);
    expect(blockerHeadline(vaccinesPending)).not.toMatch(/missing/i);
  });

  test("it says what happens next without inventing a turnaround time", () => {
    const next = blockerNextLine(vaccinesPending);
    expect(next).toMatch(/unlocks automatically/i);
    // No business rule configures a review SLA, so none may be claimed.
    expect(next).not.toMatch(/\b\d+\s*(hour|day|business day|minute)/i);
  });

  test("a genuinely missing record asks the client to act instead", () => {
    const missing = { ...vaccinesPending, status: "in_progress", missing: ["Maple: rabies"], awaiting_review: [] };
    expect(blockerHeadline(missing)).toMatch(/we still need/i);
  });

  test("completed and unassigned-optional steps are not presented as blockers", () => {
    const status = { steps: [
      { id: "client_info", status: "complete" },
      { id: "intake_forms", status: "complete", optional: true },
      vaccinesPending,
    ] };
    expect(blockingSteps(status).map((s) => s.id)).toEqual(["vaccines"]);
  });
});

describe("validator messages are written for customers", () => {
  test("the registration message that shipped is rewritten", () => {
    const out = humanizeValidationMessage("password", "String should have at least 8 characters");
    expect(out).toBe("Password needs at least 8 characters.");
    expect(out).not.toMatch(/string/i);
  });

  test("required-field and email messages are plain", () => {
    expect(humanizeValidationMessage("vet_name", "Field required")).toMatch(/is required/i);
    expect(humanizeValidationMessage("email", "value is not a valid email address")).toMatch(/valid email/i);
  });

  test("an unrecognised message is passed through rather than swallowed", () => {
    expect(humanizeValidationMessage("", "Kennel is already booked for that night")).toBe("Kennel is already booked for that night");
  });
});


describe("a brand-new account is not greeted like a regular", () => {
  const brandNew = { ready_to_book: false, booking_locked: true, steps: [], completed_count: 0, total_count: 6 };
  const setupDone = { ready_to_book: true, booking_locked: false, steps: [], completed_count: 6, total_count: 6 };
  const aBooking = [{ id: "b1", status: "approved", date: "2026-09-22" }];

  test("seconds-old account gets Welcome, not Welcome back", () => {
    // The bug: the portal header said "Welcome back, Alex!" to an account
    // created three seconds earlier.
    expect(portalGreeting("Alex Moreno", brandNew, [])).toBe("Welcome, Alex!");
    expect(portalGreeting("Alex Moreno", brandNew, [])).not.toMatch(/welcome back/i);
  });

  test("an established client — setup done AND history — gets Welcome back", () => {
    expect(portalGreeting("Alex Moreno", setupDone, aBooking)).toBe("Welcome back, Alex!");
    expect(isEstablishedClient(setupDone, aBooking)).toBe(true);
  });

  test("finishing setup does not by itself make someone a returning customer", () => {
    // Otherwise the greeting flips to "Welcome back" seconds after signup,
    // which is the same lie with an extra step.
    expect(portalGreeting("Alex Moreno", setupDone, [])).toBe("Welcome, Alex!");
    expect(isEstablishedClient(setupDone, [])).toBe(false);
  });

  test("an established client who re-opens the setup gate is still greeted as established", () => {
    // Adding a second dog re-locks booking until its vaccines are in. A
    // client of two years should not be welcomed like a stranger for it.
    const reLocked = { ready_to_book: false, booking_locked: true, steps: [], completed_count: 4, total_count: 6 };
    expect(portalGreeting("Alex Moreno", reLocked, aBooking)).toBe("Welcome back, Alex!");
    // ...but the subtitle still tells them what needs doing.
    expect(portalGreetingSubtitle(reLocked, aBooking, [{ id: "d1" }])).toMatch(/finish setting up/i);
  });

  test("while status is still loading we assume first visit", () => {
    expect(portalGreeting("Alex Moreno", null, [])).toBe("Welcome, Alex!");
  });

  test("the subtitle never mentions a pup the client has not added", () => {
    expect(portalGreetingSubtitle(brandNew, [], [])).not.toMatch(/your pup/i);
    expect(portalGreetingSubtitle(setupDone, [], [])).toMatch(/add your dog/i);
    expect(portalGreetingSubtitle(setupDone, aBooking, [{ id: "d1" }])).toMatch(/your pup/i);
  });
});
