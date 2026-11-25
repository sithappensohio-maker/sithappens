/* Pay while booking — the offer on the booking wizard's Review step.

Shown ONLY when the server says this booking needs more credits than the
client holds and there is a pack they can buy online to cover it
(POST /portal/booking-pay-options, domains/bookings/pay_now.py). A client
whose credits cover the booking never sees it.

Paying is optional: the booking is saved either way. Picking a pack and
pressing "Book & pay now" saves the booking and then opens the Shop's own
card page for that pack — this component only lets them choose which pack. */

const credits = (n, kind = "") => {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${kind ? `${kind} ` : ""}credit${v === 1 ? "" : "s"}`;
};

function packSize(p) {
  if (p.display_quantity && p.display_unit) {
    const n = Number(p.display_quantity);
    const dogs = p.display_dog_count ? ` for ${p.display_dog_count} dog${p.display_dog_count === 1 ? "" : "s"}` : "";
    return `${n} ${p.display_unit}${n === 1 ? "" : "s"}${dogs}`;
  }
  return credits(p.qty);
}

export default function BookingPayNow({ options, selectedId, onSelect, disabled = false }) {
  if (!options?.offer || !(options.packs || []).length) return null;
  const have = Number(options.credits_available || 0);
  return (
    <div className="rounded-lg border border-shSecondary/40 p-4 space-y-3" style={{ background: "var(--sh-card-base)" }}
         data-testid="wiz-pay-now">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-black text-shSecondary uppercase tracking-widest">
          <i className="fas fa-credit-card mr-2"/>Pay now
        </p>
        <span className="text-[10px] text-shTextMuted font-black uppercase tracking-widest">Optional</span>
      </div>
      <p className="text-[14px] text-shTextMuted leading-snug" data-testid="wiz-pay-now-why">
        {Number(options.credits_promised || 0) > 0
          ? <>This booking needs {credits(options.credits_needed, options.pool_label)}. You have {credits(options.credits_on_account)}, but {Math.min(options.credits_promised, options.credits_on_account)} {Math.min(options.credits_promised, options.credits_on_account) === 1 ? "is" : "are"} already set aside for your other upcoming bookings.</>
          : <>This booking needs {credits(options.credits_needed, options.pool_label)} and you have {have > 0 ? credits(have) : "none"}.</>}
        {" "}Buy a pack now by card and it's taken care of — or book and pay at your visit.
      </p>
      <div className="space-y-2" role="radiogroup" aria-label="Credit pack to buy">
        {options.packs.map((p) => {
          const on = p.id === selectedId;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} disabled={disabled}
                    onClick={() => onSelect(on ? "" : p.id)} data-testid={`wiz-pay-pack-${p.id}`}
                    className={`w-full min-h-[44px] flex items-center gap-3 p-3 rounded-lg border text-left transition disabled:opacity-60 ${
                      on ? "border-shSecondary bg-shSecondary/10" : "border-shBorder hover:border-shSecondary/50"}`}>
              <i className={`${on ? "fas fa-circle-dot text-shSecondary" : "far fa-circle text-shTextMuted"} shrink-0`}/>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-black text-shText break-words">{p.name}</span>
                <span className="block text-[12px] text-shTextMuted">
                  {packSize(p)} · {p.covers ? "covers this booking" : "covers part of this booking"}
                </span>
              </span>
              <span className="text-[15px] font-black text-shPrimary whitespace-nowrap">${Number(p.price).toFixed(2)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
