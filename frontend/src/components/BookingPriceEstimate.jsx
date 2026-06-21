/* Sprint 110di-26 — Booking Price Estimate.

Client-facing live estimate that appears at the bottom of the booking
wizard Step 3, just above the Confirm button. STRICT GUARANTEES:

  • Uses the existing services catalog as the source of truth — no second
    pricing system, no new defaults to maintain.
  • Reads the client's existing credit balances (daycare/training/boarding)
    from /api/portal/me. Does NOT consume them; this is informational.
  • Honors an optional `additional_dog_rate` field on the service doc if
    the admin has set it; otherwise falls back to multiplying the base
    rate by the number of dogs. (The current wizard is single-dog so this
    path is dormant today but ready for a future multi-dog picker.)
  • Calculation per service type:
       daycare       → base_price × #dates × #dogs
       boarding      → base_price × #nights × #dogs
       training      → base_price × #dogs (single session)
       grooming      → base_price × #dogs (single session)
       photography   → base_price × #dogs (single session)
  • If multiple base services exist for the same service_type, we pick
    the cheapest as the displayed estimate and let the standard
    disclaimer cover the variance.
  • Gated by the new `show_price_estimate` toggle under Booking Flow
    Controls — parent should render this component only when the toggle
    is on. */
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

const DISCLAIMER =
  "Price shown is an estimate. Final charges may vary based on credits, " +
  "discounts, package adjustments, added services, or administrative review.";

const fmtUSD = (n) =>
  `$${(Math.max(0, Number(n) || 0)).toFixed(2)}`;

function nightsBetween(start, end) {
  if (!start || !end || end <= start) return 0;
  const ms = new Date(end + "T12:00:00") - new Date(start + "T12:00:00");
  return Math.max(0, Math.round(ms / 86400000));
}

export default function BookingPriceEstimate({
  serviceType,
  dogCount = 1,
  date,
  endDate,
  multiDates = [],
  isMultiDate = false,
  isWaitlist = false,
  addons = [],
  // Sprint 110di-38 — when true, each addon in the `addons` array represents
  // a SPECIFIC dog's selection (not a shared selection that should be
  // multiplied by dogCount). Used by the multi-dog group flow which passes
  // the union of all per-dog addons as a flat list.
  addonsPerDog = false,
  dropoffTime = "",
  pickupTime = "",
}) {
  const [services, setServices] = useState([]);
  const [credits, setCredits] = useState({ daycare: 0, training: 0, boarding: 0 });
  const [rules, setRules] = useState({});
  // Sprint 110di-49 — Multi-dog discount config, surfaced upfront in the
  // estimate (matches what the checkout flow applies — single source of
  // truth via /settings/public).
  const [mdDiscount, setMdDiscount] = useState({ enabled: false, by_service: {}, label: "Multi-dog discount" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get("/services"),
      api.get("/portal/me"),
      // Sprint 110di-31 — pull booking_rules so we can mirror the server's
      // half-day formula client-side. `/settings/public` is unauthenticated
      // and small, and de-duplicated via the api-layer in-flight cache.
      api.get("/settings/public").catch(() => ({ data: {} })),
    ])
      .then(([sRes, mRes, settRes]) => {
        if (cancelled) return;
        setServices(Array.isArray(sRes.data) ? sRes.data : []);
        const c = mRes.data?.client || {};
        setCredits({
          daycare: Number(c.credits || 0),
          training: Number(c.training_credits || 0),
          boarding: Number(c.boarding_credits || 0),
        });
        setRules(settRes.data?.booking_rules || {});
        setMdDiscount({
          enabled: !!settRes.data?.multi_dog_discount_enabled,
          mode: settRes.data?.multi_dog_discount_mode || "percent",
          value: Number(settRes.data?.multi_dog_discount_value || 0),
          label: settRes.data?.multi_dog_discount_label || "Multi-dog discount",
          by_service: settRes.data?.multi_dog_discount_by_service || {},
        });
      })
      .catch(() => {
        if (!cancelled) {
          setServices([]); setCredits({ daycare: 0, training: 0, boarding: 0 }); setRules({});
          setMdDiscount({ enabled: false, by_service: {} });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Find the cheapest non-addon service matching this service_type — this is
  // the "headline" price we quote. If the operator has multiple variants
  // (e.g. half-day vs full-day daycare) we go conservative on the estimate
  // and let the disclaimer cover the variance.
  const headlineService = useMemo(() => {
    const candidates = services.filter(
      (s) => s.service_type === serviceType && !s.is_addon && s.active !== false
    );
    if (candidates.length === 0) return null;
    return candidates.reduce(
      (lo, s) => (Number(s.base_price || 0) < Number(lo.base_price || 0) ? s : lo),
      candidates[0]
    );
  }, [services, serviceType]);

  const calc = useMemo(() => {
    if (!headlineService) return null;
    const base = Number(headlineService.base_price || 0);
    // Sprint 110di-26 — honor optional additional_dog_rate if the admin
    // has configured it. Otherwise the 2nd+ dog is billed at the base rate.
    const extraDogRate = Number(headlineService.additional_dog_rate ?? base);

    const dogs = Math.max(1, Number(dogCount) || 1);
    const additionalDogs = Math.max(0, dogs - 1);

    let units = 1; // dates / nights / sessions
    let unitLabel = "session";
    let unitsValid = true;
    let halfDay = false;
    if (serviceType === "daycare") {
      units = isMultiDate ? Math.max(1, multiDates.length) : 1;
      unitLabel = units === 1 ? "day" : "days";
    } else if (serviceType === "boarding") {
      // Sprint 110di-31 — Mirror the server's half-day rule when the
      // client picks drop-off + pickup times. Total hours come from the
      // two datetimes; boarding_half_day_max_hours (default 12) decides
      // whether the trailing partial day is full or half.
      const totalHours = (date && endDate && dropoffTime && pickupTime)
        ? Math.max(0, (
            new Date(`${endDate}T${pickupTime}:00`).getTime() -
            new Date(`${date}T${dropoffTime}:00`).getTime()
          ) / 3600000)
        : null;
      const maxHalfH = Number(rules.boarding_half_day_max_hours ?? 12);
      const halfPct  = Number(rules.half_day_pct ?? 50) / 100;
      if (totalHours !== null && totalHours > 0) {
        const wholeNights = Math.floor(totalHours / 24);
        const remainder   = totalHours - wholeNights * 24;
        if (remainder > maxHalfH) {
          units = wholeNights + 1;
        } else if (remainder > 0.1) {
          // Half-day surcharge applies to the trailing partial day.
          units = wholeNights + halfPct;
          halfDay = true;
        } else {
          units = wholeNights;
        }
        if (units < 1) unitsValid = false;
      } else {
        // No times yet — fall back to calendar-night count so the panel
        // is still informative on the first render before the time
        // pickers have settled.
        units = nightsBetween(date, endDate);
        if (units < 1) unitsValid = false;
      }
      unitLabel = units === 1 ? "night" : "nights";
    }

    const basePrice = base * units;
    // Sprint 110di-49 — Multi-dog discount applied UPFRONT (mirrors what
    // the checkout flow will charge, so the customer + admin both see the
    // accurate group total before they confirm). Per-service config wins;
    // otherwise the global value is used.
    const mdSvc = (mdDiscount?.by_service || {})[serviceType] || {};
    const mdEligibleSvc = (serviceType === "daycare" || serviceType === "boarding"); // pre-existing scope
    const mdActiveForSvc = mdSvc.enabled !== undefined ? !!mdSvc.enabled : !!mdDiscount?.enabled;
    const mdMode  = mdSvc.mode || mdDiscount?.mode || "percent";
    const mdValue = Number(mdSvc.value ?? mdDiscount?.value ?? 0);
    const applyMd = mdEligibleSvc && mdActiveForSvc && mdValue > 0 && additionalDogs > 0;
    // Compute the additional-dog price WITHOUT the discount first, then
    // subtract — that way the breakdown still shows the raw line and the
    // discount as its own savings line (matches the receipt convention).
    const rawAdditionalDogPrice = additionalDogs * extraDogRate * units;
    const mdDiscountAmount = applyMd
      ? (mdMode === "percent"
          ? rawAdditionalDogPrice * (mdValue / 100)
          : Math.min(rawAdditionalDogPrice, mdValue * additionalDogs))
      : 0;
    const additionalDogPrice = rawAdditionalDogPrice - mdDiscountAmount;
    // Sprint 110di-28 — sum selected add-ons. Each addon row carries its
    // own `base_price` from the catalog (uses /services/addons output)
    // so the math reuses the existing pricing surface — no new system.
    // Sprint 110di-38 — `addonsPerDog` flag: when the caller passes the
    // union of per-dog selections, we DO NOT multiply by dog count
    // (each entry already represents a single dog's choice).
    const addonMultiplier = addonsPerDog ? 1 : Math.max(1, dogs);
    const addonTotal = (addons || []).reduce(
      (sum, a) => sum + Number(a?.base_price || 0) * addonMultiplier,
      0
    );
    const total = basePrice + additionalDogPrice + addonTotal;

    // Credit pool that applies to this service.
    const poolKey = ({
      daycare: "daycare",
      boarding: "boarding",
      training: "training",
    })[serviceType];
    const creditsAvailable = poolKey ? credits[poolKey] : 0;
    // Credits cover dogs × units (capped by what the client has).
    const creditUnits = poolKey
      ? Math.min(creditsAvailable, units * dogs)
      : 0;
    // Per-credit value = base rate (mirrors how check-out consumes them).
    const creditValue = creditUnits * base;
    const balanceDue = Math.max(0, total - creditValue);

    return {
      base, base_price: basePrice, extraDogRate,
      additional_dogs: additionalDogs,
      additional_dog_price: additionalDogPrice,
      addon_total: addonTotal,
      addon_lines: (addons || []).map(a => ({
        id: a.id, name: a.name, price: Number(a?.base_price || 0) * addonMultiplier,
      })),
      units, unitLabel, unitsValid, halfDay,
      total,
      credits_available: creditsAvailable,
      credits_applied: creditUnits,
      credit_value: creditValue,
      balance_due: balanceDue,
      pool_key: poolKey,
      service_name: headlineService.name,
      // Sprint 110di-49 — Expose the upfront multi-dog discount so the
      // breakdown UI can render it as its own "you save" line.
      md_discount_amount: mdDiscountAmount,
      md_discount_label: mdDiscount?.label || "Multi-dog discount",
      md_discount_applied: applyMd,
    };
  }, [headlineService, serviceType, dogCount, date, endDate, multiDates, isMultiDate, credits, addons, addonsPerDog, dropoffTime, pickupTime, rules, mdDiscount]);

  // Empty-state: nothing to estimate. Stay quiet rather than show $0 —
  // the operator might not have set up a service for this type yet.
  if (loading) {
    return (
      <div className="bg-bgBase border border-bgHover rounded-lg p-4 text-[14px] text-gray-500 font-black uppercase tracking-widest text-center" data-testid="booking-estimate-loading">
        <i className="fas fa-circle-notch fa-spin mr-2"/>Calculating estimate…
      </div>
    );
  }
  if (!calc) {
    return (
      <div className="bg-bgBase border border-bgHover rounded-lg p-3 text-[12px] text-gray-500 text-center" data-testid="booking-estimate-unavailable">
        Pricing not configured for this service. {DISCLAIMER}
      </div>
    );
  }
  // Sprint 110di-28 — boarding with zero nights (drop-off == pickup) is a
  // half-built selection. Show a polite prompt rather than $0, which would
  // mis-suggest "free overnight boarding". Same-day drop-off is fine; the
  // only invalid case is pickup ON or BEFORE drop-off.
  if (!calc.unitsValid && serviceType === "boarding") {
    return (
      <div className="bg-bgBase border border-shOrange/40 rounded-lg p-3 text-[13px] text-shOrange text-center" data-testid="booking-estimate-incomplete">
        <i className="fas fa-bed mr-1.5"/>Pick a pickup date <span className="font-black">at least one day after</span> your drop-off to see your boarding estimate.
      </div>
    );
  }

  const hasCredits = calc.pool_key && calc.credits_available > 0;
  const fullyCovered = hasCredits && calc.balance_due <= 0;

  return (
    <div className="bg-bgBase border border-shGreen/30 rounded-lg p-4 space-y-3" data-testid="booking-estimate">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-black text-shGreen uppercase tracking-widest">
          <i className="fas fa-receipt mr-2"/>Estimated Price
        </span>
        <span className="text-[11px] text-gray-500 font-black uppercase tracking-widest">
          {calc.service_name}
        </span>
      </div>

      <div className="space-y-1.5 text-[14px]">
        {/* Base line — quantified by units (days/nights/session) */}
        <div className="flex justify-between" data-testid="booking-estimate-base">
          <span className="text-gray-400">
            Base price
            {(calc.units > 1 || calc.halfDay) && (
              <span className="text-gray-500 ml-1">
                ({calc.halfDay
                  ? `${calc.units.toFixed(1).replace(/\.0$/,'')} ${calc.unitLabel} (early pickup)`
                  : `${calc.units} ${calc.unitLabel}`} × {fmtUSD(calc.base)})
              </span>
            )}
          </span>
          <span className="text-white font-black">{fmtUSD(calc.base_price)}</span>
        </div>

        {/* Additional dog charges — only when 2+ dogs selected */}
        {calc.additional_dogs > 0 && (
          <div className="flex justify-between" data-testid="booking-estimate-extra-dogs">
            <span className="text-gray-400">
              Additional dog{calc.additional_dogs === 1 ? "" : "s"}
              <span className="text-gray-500 ml-1">
                ({calc.additional_dogs} × {fmtUSD(calc.extraDogRate)}{calc.units > 1 ? ` × ${calc.units}` : ""})
              </span>
            </span>
            <span className="text-white font-black">{fmtUSD(calc.additional_dog_price + (calc.md_discount_amount || 0))}</span>
          </div>
        )}

        {/* Sprint 110di-49 — Multi-dog discount surfaced UPFRONT so client
            + admin see the savings line before checkout. The number is
            negative-styled (green minus) and pulls its label from the
            same settings doc the checkout flow reads from. */}
        {calc.md_discount_applied && calc.md_discount_amount > 0 && (
          <div className="flex justify-between" data-testid="booking-estimate-multi-dog-discount">
            <span className="text-shGreen">
              <i className="fas fa-tag mr-1.5"/>{calc.md_discount_label}
            </span>
            <span className="text-shGreen font-black">-{fmtUSD(calc.md_discount_amount)}</span>
          </div>
        )}

        {/* Sprint 110di-28 — Add-ons. Each selected add-on shows its name
            + line price. Uses the catalog's existing base_price; no new
            pricing system. */}
        {calc.addon_lines.length > 0 && (
          <div className="space-y-1" data-testid="booking-estimate-addons">
            {calc.addon_lines.map(line => (
              <div key={line.id} className="flex justify-between" data-testid={`booking-estimate-addon-${line.id}`}>
                <span className="text-gray-400">
                  <i className="fas fa-plus-circle text-shGreen mr-1.5 opacity-60"/>{line.name}
                </span>
                <span className="text-white font-black">{fmtUSD(line.price)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Subtotal line — only when credits or extras matter */}
        {(hasCredits || calc.additional_dogs > 0 || calc.addon_lines.length > 0) && (
          <div className="flex justify-between border-t border-bgHover pt-1.5" data-testid="booking-estimate-subtotal">
            <span className="text-gray-300 font-black uppercase tracking-widest text-[12px]">Standard Price</span>
            <span className="text-white font-black">{fmtUSD(calc.total)}</span>
          </div>
        )}

        {/* Credits available + applied */}
        {hasCredits && (
          <>
            <div className="flex justify-between" data-testid="booking-estimate-credits">
              <span className="text-gray-400">Credits available</span>
              <span className="text-shBlue font-black">
                {calc.credits_available} {calc.credits_available === 1 ? calc.unitLabel.replace(/s$/, "") : calc.unitLabel}
              </span>
            </div>
            {calc.credits_applied > 0 && (
              <div className="flex justify-between text-shGreen" data-testid="booking-estimate-credits-applied">
                <span>Credits applied (est.)</span>
                <span className="font-black">−{fmtUSD(calc.credit_value)}</span>
              </div>
            )}
          </>
        )}

        {/* Final balance due */}
        <div className="flex justify-between border-t border-bgHover pt-2" data-testid="booking-estimate-balance">
          <span className="text-white font-black uppercase tracking-widest text-[13px]">
            {fullyCovered ? "Estimated balance after credits" : (hasCredits ? "Estimated balance due" : "Estimated total")}
          </span>
          <span className={`font-black text-[18px] ${fullyCovered ? "text-shGreen" : "text-white"}`} data-testid="booking-estimate-total">
            {fmtUSD(calc.balance_due)}
          </span>
        </div>
      </div>

      {/* Waitlist note — only shows when this booking will land on a waitlist */}
      {isWaitlist && (
        <div className="bg-shOrange/10 border border-shOrange/40 rounded px-3 py-2 text-[12px] text-shOrange flex items-start gap-2" data-testid="booking-estimate-waitlist-note">
          <i className="fas fa-hourglass-half mt-0.5 shrink-0"/>
          <span>This is an estimated price only. Waitlisted bookings are not guaranteed.</span>
        </div>
      )}

      {/* Disclaimer — required per spec, identical copy across all screens */}
      <p className="text-[11px] text-gray-500 leading-relaxed" data-testid="booking-estimate-disclaimer">
        {DISCLAIMER}
      </p>
    </div>
  );
}
