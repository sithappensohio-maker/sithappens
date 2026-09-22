/* The price a training program shows on the website — mirror of
 * backend/domains/program_pricing.py.
 *
 * The public endpoint already returns a formatted `pricing.display`, and every
 * customer-facing surface should print that rather than formatting a number
 * itself. This module exists for the two places that cannot read the endpoint:
 * the admin editor, which needs a live preview of what the website will say
 * before the program is saved, and any card rendering a program object that
 * predates the endpoint's projection.
 *
 * Nothing here derives a price. A program with no configured price reads as
 * "Contact us for pricing", which is a deliberate invitation rather than the
 * missing-data smell of the old "Ask for pricing".
 */

export const CONTACT = "contact";
export const PACKAGE = "package";
export const PER_UNIT = "per_unit";
export const FROM = "from";

export const CONTACT_COPY = "Contact us for pricing";

const UNITS = {
  session: "session",
  private_lesson: "private lesson",
  lesson: "lesson",
  week: "week",
  day: "day",
  night: "night",
  visit: "visit",
  month: "month",
};

/** $1,500 — not $1500 and not $1,500.00 when it's round. */
export function money(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  return Math.abs(value - Math.round(value)) < 0.005
    ? `$${Math.round(value).toLocaleString()}`
    : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * What the public site will print for this program.
 *
 * Zero is not a price — it is the resting value of an untouched number input,
 * and it is how "$0" reached a customer-facing page before.
 */
export function publicPriceDisplay(program) {
  const mode = [CONTACT, PACKAGE, PER_UNIT, FROM].includes(program?.public_price_mode)
    ? program.public_price_mode
    : CONTACT;
  const raw = Number(program?.public_price_amount);
  const amount = Number.isFinite(raw) && raw > 0 ? raw : null;
  if (mode === CONTACT || amount === null) return CONTACT_COPY;
  if (mode === PACKAGE) return `${money(amount)} program`;
  if (mode === PER_UNIT) return `${money(amount)} / ${UNITS[program?.public_price_unit] || UNITS.session}`;
  return `From ${money(amount)}`;
}

/**
 * Prefer the server's own formatting when a program came from the public
 * endpoint; fall back to computing it. One string, whoever is asking.
 */
export function pricingLine(program) {
  const display = program?.pricing?.display;
  return typeof display === "string" && display ? display : publicPriceDisplay(program);
}

const UNIT_KEYS = Object.keys(UNITS);

/**
 * Why this pricing config can't be published, or null if it's fine.
 *
 * Mirrors backend/domains/program_pricing.assert_valid. Deliberately strict
 * about a priced mode with no amount: silently degrading to "Contact us" hides
 * the admin's own mistake, and they'd never know the website wasn't showing
 * the price they thought they'd set.
 */
export function publicPriceProblem(program) {
  const mode = program?.public_price_mode;
  if (!mode || mode === CONTACT) return null;
  if (![PACKAGE, PER_UNIT, FROM].includes(mode)) return `"${mode}" is not a pricing mode.`;
  const raw = program?.public_price_amount;
  if (raw === null || raw === undefined || raw === "") {
    return "Enter a price, or choose Contact us for pricing.";
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return "Enter the price as a number.";
  if (amount <= 0) return "Enter a price above zero, or choose Contact us for pricing.";
  if (mode === PER_UNIT && !UNIT_KEYS.includes(program?.public_price_unit)) {
    return "Choose what the rate is per (session, week, and so on).";
  }
  return null;
}

/**
 * The field changes that must accompany a pricing-mode switch.
 *
 * Switching to "Contact us" has to clear the amount, not just stop rendering
 * it: a stale number left on the record is one accidental mode-switch away
 * from being published as a price nobody agreed to. Likewise a unit only
 * means something for a per-unit rate.
 *
 * Returned as a patch rather than applied in the editor so the rule has one
 * definition and can be tested without mounting the studio.
 */
export function priceModePatch(mode, program) {
  const patch = { public_price_mode: mode };
  if (mode === CONTACT) {
    patch.public_price_amount = null;
    patch.public_price_unit = null;
    return patch;
  }
  if (mode !== PER_UNIT) {
    patch.public_price_unit = null;
  } else if (!UNIT_KEYS.includes(program?.public_price_unit)) {
    patch.public_price_unit = "session";
  }
  return patch;
}
