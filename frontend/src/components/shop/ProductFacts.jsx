import { useId, useState } from "react";
import { singularUnit, isInternalPhysical, creditPackDisplayInfo } from "../../lib/shopPolish";
import { packValue } from "../../lib/shopDepartments";

/**
 * The part of a product page that answers questions, department by department.
 *
 * A merchandise page and a $950 training programme need to say completely
 * different things, and the old detail view said the same thing for both:
 * a Description heading and whatever prose happened to be in the field.
 *
 * Two rules hold this together.
 *
 * ONE: every fact comes from the item. `format.count`, `helps_with`,
 * `estimated_weeks`, `qty`, `requires_dog`, `track_inventory` — all of it is
 * already on the catalog document. Nothing here writes a training promise on
 * the trainer's behalf.
 *
 * TWO: a section with nothing to say is not rendered. That is what keeps
 * this from becoming a row of empty accordions, which is the usual way this
 * pattern goes wrong.
 */

/** A catalog value as displayable text, or nothing. Numbers count; objects,
 *  arrays and blank strings do not. */
function asText(v) {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}


function Disclosure({ title, children, defaultOpen = false, testId }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="border-t border-shBorder first:border-t-0" data-testid={testId}>
      <h3>
        <button type="button" onClick={() => setOpen((o) => !o)}
                aria-expanded={open} aria-controls={id}
                className="w-full flex items-center justify-between gap-3 py-3.5 text-left
                           focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shPrimary rounded">
          <span className="text-[13px] font-black uppercase tracking-[0.12em] text-shText">{title}</span>
          <i className={`fas fa-chevron-down text-[11px] text-shTextMuted transition-transform
                         motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </h3>
      <div id={id} hidden={!open} className="pb-4 text-[13.5px] text-shTextMuted leading-relaxed space-y-2">
        {children}
      </div>
    </div>
  );
}

/**
 * Only ever renders strings.
 *
 * `school_support` arrives from the catalog as `{}` rather than the string
 * the field name suggests, and `{}` is truthy — so it sailed past the guard
 * that pushed it, reached React as a child object, and took the whole
 * product page down with it. Every field here comes from a document nobody
 * validates on the way out, so the list refuses anything that is not text
 * rather than trusting each caller to have checked.
 */
function Bullets({ items, testId }) {
  const safe = (items || []).map(asText).filter(Boolean);
  if (!safe.length) return null;
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {safe.map((t) => (
        <li key={t} className="flex gap-2.5">
          <i className="fas fa-check text-shPrimary text-[11px] mt-1 shrink-0" aria-hidden="true" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The quick facts strip that sits directly under the price — the three or
 * four things somebody wants before they scroll.
 */
export function KeyFacts({ item }) {
  const facts = [];
  if (item.kind === "training_program") {
    const count = item.format_count ?? item.format?.count;
    const unit = item.format_unit || item.format?.unit;
    if (count) facts.push([`${count}`, count === 1 ? singularUnit(unit) : unit || "sessions"]);
    if (item.estimated_weeks) facts.push([`${item.estimated_weeks}`, "weeks, about"]);
    if (item.min_age_months) facts.push([`${item.min_age_months}m+`, "minimum age"]);
  }
  if (item.kind === "credit_pack") {
    const v = packValue(item);
    if (v) {
      facts.push([`${v.quantity}`, v.unit]);
      facts.push([`$${v.each.toFixed(2)}`, `per ${singularUnit(v.unit)}`]);
    }
  }
  if (item.kind === "product" && item.track_inventory && item.stock_on_hand > 0) {
    facts.push([`${item.stock_on_hand}`, "in stock"]);
  }
  if (!facts.length) return null;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 mt-4" data-testid="pdp-key-facts">
      {facts.map(([value, label]) => (
        <div key={label}>
          <dt className="sr-only">{label}</dt>
          <dd>
            <span className="block text-[20px] font-black text-shText leading-none tabular-nums">{value}</span>
            <span className="block text-[11px] uppercase tracking-wider text-shTextMuted mt-1">{label}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ProductFacts({ item, mode }) {
  if (!item) return null;
  const sections = [];
  const isGuest = mode === "guest";

  // ── what it helps with — training's most useful answer ──
  const helps = (item.helps_with || []).map(asText).filter(Boolean);
  if (helps.length) {
    sections.push(
      <Disclosure key="helps" title="What this helps with" defaultOpen testId="pdp-helps">
        <Bullets items={helps} testId="pdp-helps-list" />
      </Disclosure>,
    );
  }

  // ── what you get ──
  const included = [];
  if (item.kind === "training_program") {
    const count = item.format_count ?? item.format?.count;
    const unit = item.format_unit || item.format?.unit;
    if (count) {
      included.push(`${count} ${count === 1 ? singularUnit(unit) : unit || "sessions"} with a Sit Happens trainer`);
    }
    if (item.purchase_fulfillment === "online_school") {
      if (item.lesson_count) included.push(`${item.lesson_count} guided lessons you work through at home`);
      if (item.module_count) included.push(`${item.module_count} modules, unlocked as you go`);
      // asText, not a truthiness check: this field is {} in practice.
      const support = asText(item.school_support);
      if (support) included.push(support);
    }
    if (item.estimated_weeks) included.push(`Around ${item.estimated_weeks} weeks from start to finish`);
  }
  if (item.kind === "credit_pack") {
    const info = creditPackDisplayInfo(item);
    const v = packValue(item);
    if (v) included.push(`${v.quantity} ${v.unit}, used whenever you like`);
    included.push("They do not expire");
    included.push("Taken off your balance automatically at check-in");
    if (info.serviceType === "training") included.push("Redeemable against training sessions");
  }
  if (item.kind === "gift_card") {
    included.push("A code emailed the moment the payment clears");
    included.push("Spendable on anything we sell — gear, training or visits");
    included.push("No expiry date");
  }
  if (included.length) {
    sections.push(
      <Disclosure key="included" title="What's included" defaultOpen={helps.length === 0} testId="pdp-included">
        <Bullets items={included} testId="pdp-included-list" />
      </Disclosure>,
    );
  }

  // ── requirements — the things that will stop a purchase ──
  const requirements = [];
  if (item.requires_dog) requirements.push("You'll choose which dog this is for.");
  if (item.min_age_months) requirements.push(`Your dog needs to be at least ${item.min_age_months} months old.`);
  if (item.requires_approval) requirements.push("We check this one over with you before it starts.");
  if (item.requires_completed_onboarding) requirements.push("Your account setup needs to be finished first.");
  if (item.account_required && isGuest) {
    requirements.push("This is booked to your account, so you'll need to be signed in.");
  }
  if (requirements.length) {
    sections.push(
      <Disclosure key="reqs" title="Before you buy" defaultOpen testId="pdp-requirements">
        <Bullets items={requirements} testId="pdp-requirements-list" />
      </Disclosure>,
    );
  }

  // ── how it reaches you ──
  const fulfilment = [];
  if (isInternalPhysical(item)) {
    fulfilment.push("Collect at Sit Happens — we'll email you when it's ready.");
    fulfilment.push("We don't post orders, so there's no postage to pay.");
  }
  if (item.kind === "gift_card") {
    fulfilment.push("Emailed straight through — there's nothing to collect.");
    fulfilment.push("Buying it for somebody else? Add their email at the cart and it goes to them.");
  }
  if (item.kind === "credit_pack") {
    fulfilment.push("Added to your balance as soon as the payment clears.");
  }
  if (item.kind === "training_program") {
    fulfilment.push(item.purchase_fulfillment === "online_school"
      ? "Your course appears in Online School straight after checkout."
      : "We'll be in touch to get the first session in the diary.");
  }
  if (fulfilment.length) {
    sections.push(
      <Disclosure key="fulfil" title={isInternalPhysical(item) ? "Collection" : "What happens next"}
                  testId="pdp-fulfilment">
        <Bullets items={fulfilment} testId="pdp-fulfilment-list" />
      </Disclosure>,
    );
  }

  if (!sections.length) return null;
  return (
    <section className="mt-5 rounded-xl border border-shBorder px-4"
             style={{ background: "var(--sh-card-base)" }}
             aria-label="Product details" data-testid="pdp-facts">
      {sections}
    </section>
  );
}
