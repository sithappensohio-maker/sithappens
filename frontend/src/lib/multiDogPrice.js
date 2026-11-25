// What one day / night / session of a service costs for the dogs picked.
//
// Used by the booking wizard's service cards so the price shown follows the
// dogs ticked on the same step (owner: "when both dogs are selected this
// should show the actual price for the two dogs").
//
// It is the SAME rule the Review step's estimate uses
// (components/BookingPriceEstimate.jsx, itself a mirror of the server's
// /pricing/quote): for daycare and boarding the first dog pays the full
// rate and each additional dog gets the multi-dog discount from Settings
// (50% unless changed); every other service charges each additional dog its
// "additional dog rate", or the full rate when none is set. The Review
// estimate and the bill stay the authority — this is the same sum, shown
// earlier.
const DISCOUNTED = new Set(["daycare", "boarding"]);

export function priceForDogs(service, dogCount, settings) {
  const base = Number(service?.base_price || 0);
  const dogs = Math.max(1, Number(dogCount) || 1);
  const extra = dogs - 1;
  if (extra === 0) return { total: base, dogs, discount: 0 };
  const type = service?.service_type;
  if (!DISCOUNTED.has(type)) {
    const rate = Number(service?.additional_dog_rate ?? base);
    return { total: round2(base + extra * rate), dogs, discount: 0 };
  }
  const s = settings || {};
  const core = (s.multi_dog_discount_core || {})[type] || {};
  const on = s.multi_dog_discount_enabled !== false && core.enabled !== false;
  const mode = core.mode === "flat" ? "flat" : "percent";
  const value = Number(core.value ?? 50);
  const raw = extra * base;
  const discount = !on || !(value > 0) ? 0
    : mode === "percent" ? raw * (value / 100) : Math.min(raw, value * extra);
  return { total: round2(base + raw - discount), dogs, discount: round2(discount) };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
