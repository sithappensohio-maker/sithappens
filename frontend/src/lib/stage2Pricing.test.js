/* Stage 2 — the program price a customer sees.
 *
 * Mirrors backend/domains/program_pricing.py. If these two ever disagree the
 * admin's live preview promises one thing and the website prints another, so
 * the same cases are asserted on both sides.
 */
import { publicPriceDisplay, pricingLine, money, CONTACT_COPY, publicPriceProblem, priceModePatch } from "./programPricing";

describe("an unpriced program invites contact rather than looking broken", () => {
  test("nothing configured", () => {
    expect(publicPriceDisplay({})).toBe(CONTACT_COPY);
    expect(publicPriceDisplay({ public_price_mode: "contact" })).toBe(CONTACT_COPY);
  });

  test("a priced mode with no amount does not fall through to $0", () => {
    // The old page printed "Ask for pricing"; an earlier draft of this could
    // have printed "$0 program", which is worse.
    expect(publicPriceDisplay({ public_price_mode: "package" })).toBe(CONTACT_COPY);
    expect(publicPriceDisplay({ public_price_mode: "package", public_price_amount: 0 })).toBe(CONTACT_COPY);
    expect(publicPriceDisplay({ public_price_mode: "from", public_price_amount: -5 })).toBe(CONTACT_COPY);
  });

  test("the words are an offer, not a shrug", () => {
    expect(CONTACT_COPY).toMatch(/contact us/i);
    expect(CONTACT_COPY).not.toMatch(/ask for pricing/i);
  });
});

describe("configured prices read in human units", () => {
  test("per-unit rates name the unit", () => {
    expect(publicPriceDisplay({ public_price_mode: "per_unit", public_price_amount: 90, public_price_unit: "private_lesson" }))
      .toBe("$90 / private lesson");
    expect(publicPriceDisplay({ public_price_mode: "per_unit", public_price_amount: 1500, public_price_unit: "week" }))
      .toBe("$1,500 / week");
  });

  test("package and from", () => {
    expect(publicPriceDisplay({ public_price_mode: "package", public_price_amount: 1200 })).toBe("$1,200 program");
    expect(publicPriceDisplay({ public_price_mode: "from", public_price_amount: 450 })).toBe("From $450");
  });

  test("an unknown unit falls back rather than printing undefined", () => {
    expect(publicPriceDisplay({ public_price_mode: "per_unit", public_price_amount: 60, public_price_unit: "fortnight" }))
      .toBe("$60 / session");
  });

  test("money formats for people", () => {
    expect(money(1500)).toBe("$1,500");
    expect(money(90)).toBe("$90");
    expect(money(99.5)).toBe("$99.50");
  });
});

describe("nothing is inferred from the program's shape", () => {
  test("session counts and legacy price fields are ignored", () => {
    // Level 1 is "5 sessions" and a private lesson is $90. $450 must not appear.
    const program = { name: "Level 1", format: { count: 5, unit: "sessions" }, price: 0 };
    expect(publicPriceDisplay(program)).toBe(CONTACT_COPY);
    expect(publicPriceDisplay(program)).not.toMatch(/450/);
  });
});

describe("the server's own formatting wins when it is present", () => {
  test("pricingLine prefers pricing.display", () => {
    expect(pricingLine({ pricing: { display: "$90 / private lesson", has_price: true } }))
      .toBe("$90 / private lesson");
  });

  test("and falls back for objects that never went through the endpoint", () => {
    expect(pricingLine({ public_price_mode: "package", public_price_amount: 800 })).toBe("$800 program");
    expect(pricingLine({})).toBe(CONTACT_COPY);
  });
});

describe("incoherent pricing is flagged, not silently degraded", () => {
  test("a priced mode with no amount is reported", () => {
    // Degrading to "Contact us" would hide the admin's own mistake — they'd
    // believe the website was showing a price it never showed.
    expect(publicPriceProblem({ public_price_mode: "package" })).toMatch(/enter a price/i);
    expect(publicPriceProblem({ public_price_mode: "package", public_price_amount: "" })).toMatch(/enter a price/i);
    expect(publicPriceProblem({ public_price_mode: "from", public_price_amount: 0 })).toMatch(/above zero/i);
    expect(publicPriceProblem({ public_price_mode: "package", public_price_amount: "abc" })).toMatch(/as a number/i);
  });

  test("per-unit with no unit is reported", () => {
    expect(publicPriceProblem({ public_price_mode: "per_unit", public_price_amount: 90 })).toMatch(/per/i);
    expect(publicPriceProblem({ public_price_mode: "per_unit", public_price_amount: 90, public_price_unit: "week" })).toBeNull();
  });

  test("contact and valid configs are fine", () => {
    expect(publicPriceProblem({})).toBeNull();
    expect(publicPriceProblem({ public_price_mode: "contact" })).toBeNull();
    expect(publicPriceProblem({ public_price_mode: "package", public_price_amount: 500 })).toBeNull();
  });

  test("a stale amount left on contact mode never reaches the website", () => {
    // Belt and braces for the mode-switch: even if an old amount survives in
    // the record, contact mode prints the invitation, not the number.
    const stale = { public_price_mode: "contact", public_price_amount: 450, public_price_unit: "week" };
    expect(publicPriceDisplay(stale)).toBe(CONTACT_COPY);
    expect(publicPriceDisplay(stale)).not.toMatch(/450/);
    expect(publicPriceProblem(stale)).toBeNull();
  });
});

describe("switching pricing mode never leaves a number behind", () => {
  const priced = { public_price_mode: "package", public_price_amount: 1200, public_price_unit: "week" };

  test("moving to Contact us clears the amount from the record", () => {
    // Not merely hidden: an amount that survives on the record is one
    // accidental switch back away from publishing a price nobody agreed to.
    const patch = priceModePatch("contact", priced);
    expect(patch).toEqual({ public_price_mode: "contact", public_price_amount: null, public_price_unit: null });
    expect(publicPriceDisplay({ ...priced, ...patch })).toBe(CONTACT_COPY);
    expect(publicPriceDisplay({ ...priced, ...patch })).not.toMatch(/1,?200/);
  });

  test("leaving per-unit drops the unit so no '$1,200 / week' can survive as a package", () => {
    const patch = priceModePatch("package", { public_price_mode: "per_unit", public_price_amount: 90, public_price_unit: "week" });
    expect(patch.public_price_unit).toBeNull();
    expect(publicPriceDisplay({ public_price_amount: 90, ...patch })).toBe("$90 program");
  });

  test("entering per-unit gets a usable default unit rather than an invalid config", () => {
    expect(priceModePatch("per_unit", { public_price_mode: "package", public_price_amount: 90 }).public_price_unit).toBe("session");
    // A unit the admin already chose is kept.
    expect(priceModePatch("per_unit", { public_price_unit: "night" }).public_price_unit).toBeUndefined();
    // A junk unit is replaced, not trusted.
    expect(priceModePatch("per_unit", { public_price_unit: "fortnight" }).public_price_unit).toBe("session");
  });

  test("every mode switch lands on a config that validates", () => {
    for (const mode of ["contact", "package", "per_unit", "from"]) {
      const next = { ...priced, ...priceModePatch(mode, priced) };
      if (mode === "contact") expect(publicPriceProblem(next)).toBeNull();
      else expect(publicPriceProblem(next)).toBeNull();
    }
  });
});
